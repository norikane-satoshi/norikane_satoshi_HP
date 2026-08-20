import {
  ChatbotLlmError,
  type ChatbotLlmGenerateOptions,
  type ChatbotLlmRequest,
  type ChatbotLlmResponse,
} from "@/lib/chatbot/server/llm-client"
import { createHash } from "node:crypto"
import { appendFile, mkdir } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import {
  createHostedNotionAiBrowserClient,
  hostedNotionAiBrowserDefaults,
  type ChatbotStageTimingSpan,
  type HostedNotionAiCdpConnectionState,
  type HostedNotionAiInferenceAttemptStageTiming,
  type HostedNotionAiStageTimings,
  type HostedNotionAiThreadRotationOutcome,
} from "@/lib/chatbot/hosted-worker/notion-ai-browser-client"
import {
  readNotionAiConversationThread,
  toNotionAiConversationScopeHash,
  writeNotionAiConversationThread,
  type NotionAiConversationThreadLifecycle,
} from "@/lib/chatbot/hosted-worker/notion-ai-conversation-thread-store"
import { getChatbotBuildSha } from "@/lib/chatbot/server/build-info"
import {
  isNotionAiThreadRotationEnabled,
  resolveEffectiveNotionAiThreadUrl,
  toNotionAiThreadId,
} from "@/lib/chatbot/hosted-worker/notion-ai-thread-store"
import {
  hostedWorkerTier,
  type HostedWorkerGenerateResponse,
} from "@/lib/chatbot/hosted-worker/types"
import {
  recordHostedWorkerGenerateFailure,
  recordHostedWorkerGenerateSuccess,
  type HostedWorkerRuntimeState,
  type HostedWorkerThreadRotationState,
} from "@/lib/chatbot/hosted-worker/health"

type GenerateOptions = {
  timeoutMs?: number
  now?: () => number
  clientFactory?: () => {
    generate(request: ChatbotLlmRequest, options?: ChatbotLlmGenerateOptions): Promise<ChatbotLlmResponse>
  }
  signal?: AbortSignal
  diagnosticsPath?: string
}

const defaultWorkerGenerateTimeoutMs = 72000
const timeoutTag = "timeout"
const abortTag = "request_aborted"
const diagnosticsEventName = "hosted_worker_generate"
const stateDir = path.join(homedir(), ".local", "state", "norikane_satoshi_hp")
const defaultDiagnosticsPath = path.join(stateDir, "hosted-worker-generate.jsonl")
const stageTimingBoundary = "hosted-notion-ai-stage-timings"

type HostedWorkerStageTimings = HostedNotionAiStageTimings & {
  workerQueueWait: ChatbotStageTimingSpan
}

type HostedWorkerQueueSnapshot = Pick<HostedWorkerRuntimeState["queue"], "inFlight" | "queueLength">
type HostedWorkerQueueSnapshotPhase = "enqueued" | "started" | "completed" | "aborted"
type HostedWorkerQueueSnapshots = Partial<Record<HostedWorkerQueueSnapshotPhase, HostedWorkerQueueSnapshot>>
type HostedWorkerConversationThreadDiagnostic = {
  mode: "provisioned" | "reused" | "reprovisioned"
  threadIdHash: string
  threadVersion: number
  visibilityStatus: "hidden"
  alive: false
  deletedAt: string
  estimatedRetentionDeadline?: string
  hiddenFromChatList: true
  hideAttemptCount: number
  hideVerificationResult: "verified"
  postHideInferenceVerified: boolean
  threadRecordMissing: boolean
  retentionPurgeDetected: boolean
  threadReprovisioned: boolean
  contextRebuiltFromHpDb: boolean
  scopeHash?: string
}

export class HostedWorkerSingleFlightQueue {
  private tail: Promise<void> = Promise.resolve()

  constructor(private readonly state: HostedWorkerRuntimeState) {}

  run<T>(
    task: (context: {
      queueWaitMs: number
      queuedAtEpochMs: number
      startedAtEpochMs: number
    }) => Promise<T>,
    options: {
      signal?: AbortSignal
      now?: () => number
      onStateChange?: (phase: HostedWorkerQueueSnapshotPhase, snapshot: HostedWorkerQueueSnapshot) => void
    } = {},
  ): Promise<T> {
    const queuedAt = options.now?.() ?? Date.now()
    if (options.signal?.aborted) return Promise.reject(createAbortError())

    const recordState = (phase: HostedWorkerQueueSnapshotPhase) => {
      try {
        options.onStateChange?.(phase, snapshotQueueState(this.state))
      } catch {
        // Diagnostics must not make the hosted worker path fail.
      }
    }

    this.state.queue.queueLength += 1
    recordState("enqueued")
    let queued = true

    const previous = this.tail.catch(() => undefined)
    const current = previous.then(async () => {
      if (!queued || options.signal?.aborted) throw createAbortError()
      queued = false
      this.state.queue.queueLength = Math.max(0, this.state.queue.queueLength - 1)
      this.state.queue.inFlight = true
      recordState("started")
      try {
        const taskStartedAt = options.now?.() ?? Date.now()
        return await task({
          queueWaitMs: taskStartedAt - queuedAt,
          queuedAtEpochMs: queuedAt,
          startedAtEpochMs: taskStartedAt,
        })
      } finally {
        this.state.queue.inFlight = false
        recordState("completed")
      }
    })
    this.tail = current.then(
      () => undefined,
      () => undefined,
    )

    if (!options.signal) return current

    let cleanup: () => void = () => undefined
    const aborted = new Promise<never>((_resolve, reject) => {
      const abort = () => {
        if (queued) {
          queued = false
          this.state.queue.queueLength = Math.max(0, this.state.queue.queueLength - 1)
          recordState("aborted")
        }
        reject(createAbortError())
      }
      options.signal?.addEventListener("abort", abort, { once: true })
      cleanup = () => options.signal?.removeEventListener("abort", abort)
    })

    return Promise.race([current, aborted]).finally(cleanup)
  }
}

export function createHostedWorkerQueue(state: HostedWorkerRuntimeState): HostedWorkerSingleFlightQueue {
  return new HostedWorkerSingleFlightQueue(state)
}

export async function generateHostedWorkerResponse(
  request: ChatbotLlmRequest,
  state: HostedWorkerRuntimeState,
  queue: HostedWorkerSingleFlightQueue,
  options: GenerateOptions = {},
): Promise<HostedWorkerGenerateResponse> {
  const startedAt = options.now?.() ?? Date.now()
  const timeoutMs = options.timeoutMs ?? parsePositiveInteger(process.env.CHATBOT_HOSTED_WORKER_TIMEOUT_MS, defaultWorkerGenerateTimeoutMs)
  const diagnosticsPath =
    options.diagnosticsPath ??
    process.env.CHATBOT_HOSTED_WORKER_GENERATE_DIAGNOSTICS_PATH ??
    (process.env.NODE_ENV === "test" ? undefined : defaultDiagnosticsPath)
  let queueWaitMs = 0
  let generateDurationMs = 0
  let outcome: "success" | "error" = "error"
  let errorCode: string | undefined
  let aborted = false
  let workerQueueWait: ChatbotStageTimingSpan | undefined
  let stageTimings: HostedWorkerStageTimings | undefined
  let threadRotation: HostedWorkerThreadRotationState | undefined
  let threadRotationOutcome: { ok: boolean; stage?: string; detail?: string; durationMs: number } | undefined
  let threadLifecycleFailure: {
    lifecycleFailureCode: string
    lifecycleStage?: string
    visibilityStatus?: string
    hideVerificationResult?: string
  } | undefined
  const conversationId = requireConversationId(request.conversationId)
  const conversationScopeHash = toNotionAiConversationScopeHash(conversationId).slice(0, 12)
  let conversationThread: HostedWorkerConversationThreadDiagnostic | undefined

  const onThreadRotated = async (rotation: {
    threadUrl: string
    previousThreadUrl?: string
    retried: boolean
    reason: "conversation-provisioned" | "capacity-rotation"
  }): Promise<{ threadVersion?: number } | void> => {
    const threadId = toNotionAiThreadId(rotation.threadUrl)
    if (!threadId) return
    const saved = await writeNotionAiConversationThread({
      conversationId,
      threadUrl: rotation.threadUrl,
    })
    threadRotation = {
      threadId: saved.threadId,
      rotatedAt: saved.updatedAt,
      previousThreadId: rotation.previousThreadUrl ? toNotionAiThreadId(rotation.previousThreadUrl) : undefined,
      rotationCount: saved.threadVersion,
      retried: rotation.retried,
      reason: rotation.reason,
    }
    if (rotation.reason === "capacity-rotation") state.threadRotation = threadRotation
    return { threadVersion: saved.threadVersion }
  }
  const onThreadLifecycleUpdated = async (input: {
    threadUrl: string
    lifecycle: NotionAiConversationThreadLifecycle
  }): Promise<void> => {
    await writeNotionAiConversationThread({
      conversationId,
      threadUrl: input.threadUrl,
      lifecycle: input.lifecycle,
    })
  }
  let cdpConnectionState: HostedNotionAiCdpConnectionState | undefined
  const queueSnapshots: HostedWorkerQueueSnapshots = {}

  try {
    throwIfAborted(options.signal)
    const response = await queue.run(
      async (queueContext) => {
        queueWaitMs = queueContext.queueWaitMs
        workerQueueWait = createStageTimingSpan(
          queueContext.queuedAtEpochMs,
          queueContext.startedAtEpochMs,
        )
        const generateStartedAt = options.now?.() ?? Date.now()
        const activeAbort = createLinkedAbortController(options.signal)
        try {
          return await withTimeout(
            createHostedNotionAiResponse(
              request,
              options.clientFactory,
              activeAbort.signal,
              onThreadRotated,
              onThreadLifecycleUpdated,
              (outcome) => {
                threadRotationOutcome = outcome.ok
                  ? { ok: true, durationMs: outcome.durationMs }
                  : { ok: false, stage: outcome.stage, detail: outcome.detail, durationMs: outcome.durationMs }
              },
            ),
            timeoutMs,
            timeoutTag,
            options.signal,
            () => activeAbort.abort(),
          )
        } finally {
          activeAbort.cleanup()
          generateDurationMs = (options.now?.() ?? Date.now()) - generateStartedAt
        }
      },
      {
        signal: options.signal,
        now: options.now,
        onStateChange: (phase, snapshot) => {
          queueSnapshots[phase] = snapshot
        },
      },
    )
    const latencyMs = (options.now?.() ?? Date.now()) - startedAt
    outcome = "success"
    recordHostedWorkerGenerateSuccess(state, {
      at: new Date(options.now?.() ?? Date.now()).toISOString(),
      latencyMs,
    })
    cdpConnectionState = safeHostedNotionAiCdpConnectionState(response.diagnostics?.cdpConnectionState)
    conversationThread = safeHostedWorkerConversationThreadDiagnostic(response.diagnostics?.conversationThread)
    const hostedNotionAiStageTimings = safeHostedNotionAiStageTimings(response.diagnostics?.stageTimings)
    stageTimings = workerQueueWait && hostedNotionAiStageTimings
      ? { workerQueueWait, ...hostedNotionAiStageTimings }
      : undefined

    return {
      ...response,
      tier: hostedWorkerTier,
      latencyMs,
      diagnostics: safeDiagnostics(
        response.diagnostics,
        stageTimings,
        cdpConnectionState,
        conversationThread,
        conversationScopeHash,
      ),
    }
  } catch (error) {
    const normalized = normalizeGenerateError(error)
    errorCode =
      normalized.cause && typeof normalized.cause === "object" && "errorCode" in normalized.cause
        ? String(normalized.cause.errorCode)
        : normalized.code
    threadLifecycleFailure = safeThreadLifecycleFailure(normalized.cause)
    aborted = isAbortError(error) || errorCode === abortTag
    const failureRecordedAt = options.now?.() ?? Date.now()
    recordHostedWorkerGenerateFailure(state, {
      code: normalized.code,
      at: new Date(failureRecordedAt).toISOString(),
      latencyMs: failureRecordedAt - startedAt,
    })
    throw normalized
  } finally {
    if (diagnosticsPath) {
      await writeGenerateDiagnostics({
        path: diagnosticsPath,
        event: diagnosticsEventName,
        requestId: safeRequestId(request.requestId),
        buildSha: getChatbotBuildSha(),
        tier: hostedWorkerTier,
        boundary: stageTimingBoundary,
        outcome,
        queueWaitMs,
        generateDurationMs,
        timeoutMs,
        aborted: aborted || Boolean(options.signal?.aborted),
        timedOut: errorCode === "timeout",
        errorCode,
        pid: process.pid,
        workerStartedAtEpochMs: state.workerStartedAtEpochMs,
        uptimeMs: Math.round(process.uptime() * 1000),
        cdpConnectionState,
        stageTimings,
        threadRotation,
        threadRotationOutcome,
        conversationScopeHash,
        conversationThread,
        threadLifecycleFailure,
        queueSnapshots: Object.keys(queueSnapshots).length > 0 ? queueSnapshots : undefined,
      })
    }
  }
}

async function createHostedNotionAiResponse(
  request: ChatbotLlmRequest,
  clientFactory: GenerateOptions["clientFactory"],
  signal?: AbortSignal,
  onThreadRotated?: (rotation: {
    threadUrl: string
    previousThreadUrl?: string
    retried: boolean
    reason: "conversation-provisioned" | "capacity-rotation"
  }) => Promise<{ threadVersion?: number } | void>,
  onThreadLifecycleUpdated?: (input: {
    threadUrl: string
    lifecycle: NotionAiConversationThreadLifecycle
  }) => Promise<void>,
  onThreadRotationOutcome?: (outcome: HostedNotionAiThreadRotationOutcome) => void,
): Promise<ChatbotLlmResponse> {
  const conversationId = requireConversationId(request.conversationId)
  if (clientFactory) return clientFactory().generate(request, { signal })

  const conversationThread = await readNotionAiConversationThread(conversationId)
  const client = createHostedNotionAiBrowserClient({
      cdpBaseUrl: process.env.CHATBOT_HOSTED_WORKER_CDP_BASE_URL ?? hostedNotionAiBrowserDefaults.cdpBaseUrl,
      targetUrlIncludes: conversationThread?.threadUrl ?? resolveEffectiveNotionAiThreadUrl().threadUrl,
      requestTimeoutMs: parsePositiveInteger(
        process.env.CHATBOT_HOSTED_WORKER_GENERATE_TIMEOUT_MS,
        hostedNotionAiBrowserDefaults.requestTimeoutMs,
      ),
      threadRotationEnabled: isNotionAiThreadRotationEnabled(),
      conversationThreadRequired: true,
      ...(conversationThread
        ? {
            conversationThreadUrl: conversationThread.threadUrl,
            conversationThreadVersion: conversationThread.threadVersion,
            conversationThreadDeletedAt: conversationThread.deletedAt,
          }
        : {}),
      ...(onThreadRotated ? { onThreadRotated } : {}),
      ...(onThreadLifecycleUpdated ? { onThreadLifecycleUpdated } : {}),
      ...(onThreadRotationOutcome ? { onThreadRotationOutcome } : {}),
    })

  return client.generate(request, { signal })
}

function normalizeGenerateError(error: unknown): ChatbotLlmError {
  if (error instanceof ChatbotLlmError) {
    return new ChatbotLlmError({
      message: error.message,
      code: error.code,
      tier: hostedWorkerTier,
      isRetryable: error.isRetryable,
      cause: error.cause,
    })
  }

  if (isAbortError(error)) {
    return new ChatbotLlmError({
      message: "Hosted Notion AI worker generation was aborted.",
      code: "timeout",
      tier: hostedWorkerTier,
      isRetryable: true,
      cause: { errorCode: abortTag, aborted: true },
    })
  }

  if (error === timeoutTag) {
    return new ChatbotLlmError({
      message: "Hosted Notion AI worker generation timed out.",
      code: "timeout",
      tier: hostedWorkerTier,
      isRetryable: true,
    })
  }

  return new ChatbotLlmError({
    message: "Hosted Notion AI worker generation failed.",
    code: "unknown",
    tier: hostedWorkerTier,
    isRetryable: false,
    cause: error,
  })
}

function createAbortError(): ChatbotLlmError {
  return new ChatbotLlmError({
    message: "Hosted Notion AI worker request was aborted.",
    code: "timeout",
    tier: hostedWorkerTier,
    isRetryable: true,
    cause: { errorCode: abortTag, aborted: true },
  })
}

function safeDiagnostics(
  diagnostics: ChatbotLlmResponse["diagnostics"],
  stageTimings: HostedWorkerStageTimings | undefined,
  cdpConnectionState: HostedNotionAiCdpConnectionState | undefined,
  conversationThread: HostedWorkerConversationThreadDiagnostic | undefined,
  conversationScopeHash: string | undefined,
): Record<string, unknown> {
  return {
    endpoint: diagnostics?.endpoint,
    contentType: diagnostics?.contentType,
    responseBytes: diagnostics?.responseBytes,
    ndjsonPartialParsed: diagnostics?.ndjsonPartialParsed,
    ndjsonFinalParsed: diagnostics?.ndjsonFinalParsed,
    chunkCount: diagnostics?.chunkCount,
    cdpConnectionState,
    stageTimings,
    conversationThread: conversationThread
      ? { ...conversationThread, scopeHash: conversationScopeHash }
      : undefined,
  }
}

function createStageTimingSpan(
  startedAtEpochMs: number,
  completedAtEpochMs: number,
): ChatbotStageTimingSpan {
  const safeStartedAtEpochMs = Number.isFinite(startedAtEpochMs) ? startedAtEpochMs : completedAtEpochMs
  const safeCompletedAtEpochMs = Math.max(
    safeStartedAtEpochMs,
    Number.isFinite(completedAtEpochMs) ? completedAtEpochMs : safeStartedAtEpochMs,
  )
  return {
    startedAtEpochMs: safeStartedAtEpochMs,
    completedAtEpochMs: safeCompletedAtEpochMs,
    durationMs: safeCompletedAtEpochMs - safeStartedAtEpochMs,
  }
}

function snapshotQueueState(state: HostedWorkerRuntimeState): HostedWorkerQueueSnapshot {
  return {
    inFlight: state.queue.inFlight,
    queueLength: state.queue.queueLength,
  }
}

function safeHostedNotionAiStageTimings(value: unknown): HostedNotionAiStageTimings | undefined {
  if (!isRecord(value)) return undefined
  const cdpTargetSession = safeStageTimingSpan(value.cdpTargetSession)
  const runtimeContextPreparation = safeStageTimingSpan(value.runtimeContextPreparation)
  if (!cdpTargetSession || !runtimeContextPreparation || !Array.isArray(value.inferenceAttempts)) {
    return undefined
  }

  const inferenceAttempts = value.inferenceAttempts
    .map(safeInferenceAttemptStageTiming)
    .filter((attempt): attempt is HostedNotionAiInferenceAttemptStageTiming => Boolean(attempt))
  if (inferenceAttempts.length !== value.inferenceAttempts.length) return undefined

  return {
    cdpTargetSession,
    runtimeContextPreparation,
    inferenceAttempts,
  }
}

function safeHostedNotionAiCdpConnectionState(value: unknown): HostedNotionAiCdpConnectionState | undefined {
  if (!isRecord(value)) return undefined
  if (!isCdpResourceState(value.session) || !isCdpResourceState(value.target)) return undefined

  return {
    session: value.session,
    target: value.target,
  }
}

function isCdpResourceState(value: unknown): value is HostedNotionAiCdpConnectionState["session"] {
  return value === "newly_established" || value === "existing_reused"
}

function safeInferenceAttemptStageTiming(value: unknown): HostedNotionAiInferenceAttemptStageTiming | undefined {
  if (!isRecord(value) || !Number.isInteger(value.attempt) || Number(value.attempt) < 1) return undefined
  const promptToFirstChunk = safeStageTimingSpan(value.promptToFirstChunk)
  const firstChunkToFinalChunk = safeStageTimingSpan(value.firstChunkToFinalChunk)
  const ndjsonOutputContractValidation = safeStageTimingSpan(value.ndjsonOutputContractValidation)
  if (!promptToFirstChunk || !firstChunkToFinalChunk || !ndjsonOutputContractValidation) {
    return undefined
  }

  return {
    attempt: Number(value.attempt),
    promptToFirstChunk,
    firstChunkToFinalChunk,
    ndjsonOutputContractValidation,
  }
}

function safeStageTimingSpan(value: unknown): ChatbotStageTimingSpan | undefined {
  if (!isRecord(value)) return undefined
  const startedAtEpochMs = value.startedAtEpochMs
  const completedAtEpochMs = value.completedAtEpochMs
  const durationMs = value.durationMs
  if (
    typeof startedAtEpochMs !== "number" ||
    !Number.isFinite(startedAtEpochMs) ||
    typeof completedAtEpochMs !== "number" ||
    !Number.isFinite(completedAtEpochMs) ||
    typeof durationMs !== "number" ||
    !Number.isFinite(durationMs)
  ) {
    return undefined
  }

  return { startedAtEpochMs, completedAtEpochMs, durationMs }
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return
  throw createAbortError()
}

function isAbortError(error: unknown): boolean {
  if (error instanceof ChatbotLlmError) {
    return isRecord(error.cause) && error.cause.errorCode === abortTag
  }
  return error === abortTag
}

function createLinkedAbortController(parent: AbortSignal | undefined): AbortController & { cleanup(): void } {
  const controller = new AbortController() as AbortController & { cleanup(): void }
  const abort = () => controller.abort()
  if (parent?.aborted) controller.abort()
  parent?.addEventListener("abort", abort, { once: true })
  controller.cleanup = () => parent?.removeEventListener("abort", abort)
  return controller
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  tag: string,
  signal?: AbortSignal,
  onCancel?: () => void,
): Promise<T> {
  throwIfAborted(signal)

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      onCancel?.()
      reject(tag)
    }, timeoutMs)
    const cleanup = () => {
      clearTimeout(timer)
      signal?.removeEventListener("abort", abort)
    }
    const abort = () => {
      cleanup()
      onCancel?.()
      reject(createAbortError())
    }
    signal?.addEventListener("abort", abort, { once: true })

    promise.then(
      (value) => {
        cleanup()
        resolve(value)
      },
      (error: unknown) => {
        cleanup()
        reject(error)
      },
    )
  })
}

async function writeGenerateDiagnostics(event: {
  path: string
  event: string
  requestId?: string
  buildSha: string
  tier: typeof hostedWorkerTier
  boundary: typeof stageTimingBoundary
  outcome: "success" | "error"
  queueWaitMs: number
  generateDurationMs: number
  timeoutMs: number
  aborted: boolean
  timedOut: boolean
  errorCode?: string
  pid: number
  workerStartedAtEpochMs: number
  uptimeMs: number
  cdpConnectionState?: HostedNotionAiCdpConnectionState
  stageTimings?: HostedWorkerStageTimings
  threadRotation?: HostedWorkerThreadRotationState
  threadRotationOutcome?: { ok: boolean; stage?: string; detail?: string; durationMs: number }
  conversationScopeHash?: string
  conversationThread?: HostedWorkerConversationThreadDiagnostic
  threadLifecycleFailure?: {
    lifecycleFailureCode: string
    lifecycleStage?: string
    visibilityStatus?: string
    hideVerificationResult?: string
  }
  queueSnapshots?: HostedWorkerQueueSnapshots
}): Promise<void> {
  try {
    const { path: logPath, ...payload } = event
    await mkdir(path.dirname(logPath), { recursive: true })
    await appendFile(logPath, `${JSON.stringify(payload)}\n`, "utf8")
  } catch {
    // Diagnostics must not make the hosted worker path fail.
  }
}

function safeRequestId(value: string | undefined): string | undefined {
  if (!value) return undefined
  return /^[A-Za-z0-9_.:-]{1,120}$/.test(value) ? value : "invalid_request_id"
}

function requireConversationId(value: string | undefined): string {
  if (value && /^[A-Za-z0-9_.:-]{1,200}$/.test(value)) return value
  throw new ChatbotLlmError({
    message: "Hosted Notion AI generation requires a valid conversation id.",
    code: "invalid-output",
    tier: hostedWorkerTier,
    isRetryable: false,
  })
}

function safeHostedWorkerConversationThreadDiagnostic(
  value: unknown,
): HostedWorkerConversationThreadDiagnostic | undefined {
  if (!isRecord(value)) return undefined
  if (value.mode !== "provisioned" && value.mode !== "reused" && value.mode !== "reprovisioned") {
    return undefined
  }
  const threadIdHash = safeThreadIdHash(value.threadIdHash, value.threadId)
  if (!threadIdHash) return undefined
  if (!Number.isInteger(value.threadVersion) || Number(value.threadVersion) < 1) return undefined
  if (value.visibilityStatus !== "hidden" || value.alive !== false) return undefined
  if (!isIsoTimestamp(value.deletedAt)) return undefined
  if (value.estimatedRetentionDeadline !== undefined && !isIsoTimestamp(value.estimatedRetentionDeadline)) {
    return undefined
  }
  if (value.hiddenFromChatList !== true) return undefined
  if (!Number.isInteger(value.hideAttemptCount) || Number(value.hideAttemptCount) < 0) return undefined
  if (value.hideVerificationResult !== "verified") return undefined
  for (const key of [
    "postHideInferenceVerified",
    "threadRecordMissing",
    "retentionPurgeDetected",
    "threadReprovisioned",
    "contextRebuiltFromHpDb",
  ] as const) {
    if (typeof value[key] !== "boolean") return undefined
  }
  return {
    mode: value.mode,
    threadIdHash,
    threadVersion: Number(value.threadVersion),
    visibilityStatus: "hidden",
    alive: false,
    deletedAt: value.deletedAt,
    ...(value.estimatedRetentionDeadline
      ? { estimatedRetentionDeadline: value.estimatedRetentionDeadline }
      : {}),
    hiddenFromChatList: true,
    hideAttemptCount: Number(value.hideAttemptCount),
    hideVerificationResult: "verified",
    postHideInferenceVerified: value.postHideInferenceVerified === true,
    threadRecordMissing: value.threadRecordMissing === true,
    retentionPurgeDetected: value.retentionPurgeDetected === true,
    threadReprovisioned: value.threadReprovisioned === true,
    contextRebuiltFromHpDb: value.contextRebuiltFromHpDb === true,
    ...(typeof value.scopeHash === "string" && /^[0-9a-f]{12}$/i.test(value.scopeHash)
      ? { scopeHash: value.scopeHash.toLowerCase() }
      : {}),
  }
}

function safeThreadIdHash(hashValue: unknown, rawValue: unknown): string | undefined {
  if (typeof hashValue === "string" && /^[0-9a-f]{12}$/i.test(hashValue)) {
    return hashValue.toLowerCase()
  }
  if (typeof rawValue !== "string") return undefined
  const normalized = rawValue.replaceAll("-", "").toLowerCase()
  if (!/^[0-9a-f]{32}$/.test(normalized)) return undefined
  return createHash("sha256").update(normalized).digest("hex").slice(0, 12)
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function safeThreadLifecycleFailure(value: unknown): {
  lifecycleFailureCode: string
  lifecycleStage?: string
  visibilityStatus?: string
  hideVerificationResult?: string
} | undefined {
  if (!isRecord(value)) return undefined
  const safeCode = (candidate: unknown): string | undefined =>
    typeof candidate === "string" && /^[a-z0-9][a-z0-9_.:-]{0,119}$/i.test(candidate)
      ? candidate
      : undefined
  const lifecycleFailureCode = safeCode(value.lifecycleFailureCode)
  if (!lifecycleFailureCode) return undefined
  const lifecycleStage = safeCode(value.lifecycleStage)
  const visibilityStatus = safeCode(value.visibilityStatus)
  const hideVerificationResult = safeCode(value.hideVerificationResult)
  return {
    lifecycleFailureCode,
    ...(lifecycleStage ? { lifecycleStage } : {}),
    ...(visibilityStatus ? { visibilityStatus } : {}),
    ...(hideVerificationResult ? { hideVerificationResult } : {}),
  }
}
