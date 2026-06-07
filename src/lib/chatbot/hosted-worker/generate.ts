import {
  ChatbotLlmError,
  type ChatbotLlmRequest,
  type ChatbotLlmResponse,
} from "@/lib/chatbot/server/llm-client"
import {
  createTier1ChromeNotionAiClient,
  tier1ChromeNotionAiDefaults,
  tier1ObservedNotionAiModel,
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
    generate(request: ChatbotLlmRequest): Promise<ChatbotLlmResponse>
  }
}

const defaultWorkerGenerateTimeoutMs = 180000
const timeoutTag = "timeout"

export class HostedWorkerSingleFlightQueue {
  private tail: Promise<void> = Promise.resolve()

  constructor(private readonly state: HostedWorkerRuntimeState) {}

  run<T>(task: () => Promise<T>): Promise<T> {
    this.state.queue.queueLength += 1
    const previous = this.tail.catch(() => undefined)
    const current = previous.then(async () => {
      this.state.queue.queueLength = Math.max(0, this.state.queue.queueLength - 1)
      this.state.queue.inFlight = true
      try {
        return await task()
      } finally {
        this.state.queue.inFlight = false
      }
    })
    this.tail = current.then(
      () => undefined,
      () => undefined,
    )
    return current
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

  try {
    const response = await queue.run(() =>
      withTimeout(
        createTier1Response(request, options.clientFactory),
        timeoutMs,
        timeoutTag,
      ),
    )
    const latencyMs = (options.now?.() ?? Date.now()) - startedAt
    state.queue.lastSuccessAt = new Date().toISOString()
    state.queue.lastErrorCode = undefined
    state.queue.lastLatencyMs = latencyMs

    return {
      ...response,
      tier: hostedWorkerTier,
      latencyMs,
      diagnostics: safeDiagnostics(response.diagnostics),
    }
  } catch (error) {
    const normalized = normalizeGenerateError(error)
    state.queue.lastErrorCode = normalized.code
    state.queue.lastLatencyMs = (options.now?.() ?? Date.now()) - startedAt
    throw normalized
  }
}

function createTier1Response(
  request: ChatbotLlmRequest,
  clientFactory: GenerateOptions["clientFactory"],
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
      preferredModel: process.env.CHATBOT_HOSTED_WORKER_NOTION_MODEL ?? tier1ObservedNotionAiModel,
    })

  return client.generate(request)
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

function safeDiagnostics(diagnostics: ChatbotLlmResponse["diagnostics"]): Record<string, unknown> {
  return {
    endpoint: diagnostics?.endpoint,
    contentType: diagnostics?.contentType,
    responseBytes: diagnostics?.responseBytes,
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

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, tag: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(tag), timeoutMs)

    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}
