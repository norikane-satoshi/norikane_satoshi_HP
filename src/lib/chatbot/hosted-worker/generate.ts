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
  createTier1ChromeNotionAiClient,
  tier1ChromeNotionAiDefaults,
} from "@/lib/chatbot/server/llm-clients/tier1-chrome-notion-ai"
import { getNotionAiChatbotThreadUrl } from "@/lib/chatbot/server/llm-clients/tier1-chrome-notion-ai-config"
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

const defaultWorkerGenerateTimeoutMs = 70000
const timeoutTag = "timeout"
const abortTag = "request_aborted"
const diagnosticsEventName = "hosted_worker_generate"
const stateDir = path.join(homedir(), ".local", "state", "norikane_satoshi_hp")
const defaultDiagnosticsPath = path.join(stateDir, "hosted-worker-generate.jsonl")

export class HostedWorkerSingleFlightQueue {
  private tail: Promise<void> = Promise.resolve()

  constructor(private readonly state: HostedWorkerRuntimeState) {}

  run<T>(
    task: (context: { queueWaitMs: number }) => Promise<T>,
    options: { signal?: AbortSignal; now?: () => number } = {},
  ): Promise<T> {
    const queuedAt = options.now?.() ?? Date.now()
    if (options.signal?.aborted) return Promise.reject(createAbortError())

    this.state.queue.queueLength += 1
    let queued = true

    const previous = this.tail.catch(() => undefined)
    const current = previous.then(async () => {
      if (!queued || options.signal?.aborted) throw createAbortError()
      queued = false
      this.state.queue.queueLength = Math.max(0, this.state.queue.queueLength - 1)
      this.state.queue.inFlight = true
      try {
        return await task({ queueWaitMs: (options.now?.() ?? Date.now()) - queuedAt })
      } finally {
        this.state.queue.inFlight = false
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

  try {
    throwIfAborted(options.signal)
    const response = await queue.run(
      async (queueContext) => {
        queueWaitMs = queueContext.queueWaitMs
        const generateStartedAt = options.now?.() ?? Date.now()
        const activeAbort = createLinkedAbortController(options.signal)
        try {
          return await withTimeout(
            createTier1Response(request, options.clientFactory, activeAbort.signal),
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
      { signal: options.signal, now: options.now },
    )
    const latencyMs = (options.now?.() ?? Date.now()) - startedAt
    outcome = "success"
    state.queue.lastSuccessAt = new Date().toISOString()
    state.queue.lastErrorCode = undefined
    state.queue.lastLatencyMs = latencyMs

    return {
      ...response,
      tier: hostedWorkerTier,
      latencyMs,
      modelName: response.modelName,
      diagnostics: safeDiagnostics(response.diagnostics),
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
        outcome,
        queueWaitMs,
        generateDurationMs,
        timeoutMs,
        aborted: aborted || Boolean(options.signal?.aborted),
        timedOut: errorCode === "timeout",
        errorCode,
        pid: process.pid,
        uptimeMs: Math.round(process.uptime() * 1000),
      })
    }
  }
}

function createTier1Response(
  request: ChatbotLlmRequest,
  clientFactory: GenerateOptions["clientFactory"],
  signal?: AbortSignal,
): Promise<ChatbotLlmResponse> {
  const client =
    clientFactory?.() ??
    createTier1ChromeNotionAiClient({
      cdpBaseUrl: process.env.CHATBOT_HOSTED_WORKER_CDP_BASE_URL ?? tier1ChromeNotionAiDefaults.cdpBaseUrl,
      targetUrlIncludes:
        process.env.CHATBOT_HOSTED_WORKER_NOTION_THREAD_URL ??
        process.env.NOTION_AI_CHATBOT_THREAD_URL ??
        getNotionAiChatbotThreadUrl(),
      requestTimeoutMs: parsePositiveInteger(
        process.env.CHATBOT_HOSTED_WORKER_GENERATE_TIMEOUT_MS,
        tier1ChromeNotionAiDefaults.requestTimeoutMs,
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

function safeDiagnostics(diagnostics: ChatbotLlmResponse["diagnostics"]): Record<string, unknown> {
  return {
    endpoint: diagnostics?.endpoint,
    contentType: diagnostics?.contentType,
    responseBytes: diagnostics?.responseBytes,
    selectedModel: diagnostics?.selectedModel,
    finalModelName: diagnostics?.finalModelName,
    ndjsonPartialParsed: diagnostics?.ndjsonPartialParsed,
    ndjsonFinalParsed: diagnostics?.ndjsonFinalParsed,
    chunkCount: diagnostics?.chunkCount,
  }
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
  outcome: "success" | "error"
  queueWaitMs: number
  generateDurationMs: number
  timeoutMs: number
  aborted: boolean
  timedOut: boolean
  errorCode?: string
  pid: number
  uptimeMs: number
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
