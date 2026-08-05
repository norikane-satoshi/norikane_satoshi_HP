import {
  ChatbotLlmError,
  type ChatbotLlmGenerateOptions,
  type ChatbotLlmRequest,
  type ChatbotLlmResponse,
} from "@/lib/chatbot/server/llm-client"
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
} from "@/lib/chatbot/hosted-worker/notion-ai-browser-client"
import { getChatbotBuildSha } from "@/lib/chatbot/server/build-info"
import { getNotionAiChatbotThreadUrl } from "@/lib/chatbot/hosted-worker/notion-ai-config"
import {
  hostedWorkerTier,
  type HostedWorkerGenerateResponse,
} from "@/lib/chatbot/hosted-worker/types"
import type { HostedWorkerRuntimeState } from "@/lib/chatbot/hosted-worker/health"

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
            createHostedNotionAiResponse(request, options.clientFactory, activeAbort.signal),
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
    state.queue.lastSuccessAt = new Date().toISOString()
    state.queue.lastErrorCode = undefined
    state.queue.lastLatencyMs = latencyMs
    cdpConnectionState = safeHostedNotionAiCdpConnectionState(response.diagnostics?.cdpConnectionState)
    const hostedNotionAiStageTimings = safeHostedNotionAiStageTimings(response.diagnostics?.stageTimings)
    stageTimings = workerQueueWait && hostedNotionAiStageTimings
      ? { workerQueueWait, ...hostedNotionAiStageTimings }
      : undefined

    return {
      ...response,
      tier: hostedWorkerTier,
      latencyMs,
      diagnostics: safeDiagnostics(response.diagnostics, stageTimings, cdpConnectionState),
    }
  } catch (error) {
    const normalized = normalizeGenerateError(error)
    errorCode =
      normalized.cause && typeof normalized.cause === "object" && "errorCode" in normalized.cause
        ? String(normalized.cause.errorCode)
        : normalized.code
    aborted = isAbortError(error) || errorCode === abortTag
    state.queue.lastErrorCode = normalized.code
    state.queue.lastLatencyMs = (options.now?.() ?? Date.now()) - startedAt
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
        queueSnapshots: Object.keys(queueSnapshots).length > 0 ? queueSnapshots : undefined,
      })
    }
  }
}

function createHostedNotionAiResponse(
  request: ChatbotLlmRequest,
  clientFactory: GenerateOptions["clientFactory"],
  signal?: AbortSignal,
): Promise<ChatbotLlmResponse> {
  const client =
    clientFactory?.() ??
    createHostedNotionAiBrowserClient({
      cdpBaseUrl: process.env.CHATBOT_HOSTED_WORKER_CDP_BASE_URL ?? hostedNotionAiBrowserDefaults.cdpBaseUrl,
      targetUrlIncludes:
        process.env.CHATBOT_HOSTED_WORKER_NOTION_THREAD_URL ??
        process.env.NOTION_AI_CHATBOT_THREAD_URL ??
        getNotionAiChatbotThreadUrl(),
      requestTimeoutMs: parsePositiveInteger(
        process.env.CHATBOT_HOSTED_WORKER_GENERATE_TIMEOUT_MS,
        hostedNotionAiBrowserDefaults.requestTimeoutMs,
      ),
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
