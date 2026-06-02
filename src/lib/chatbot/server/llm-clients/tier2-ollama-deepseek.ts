import type { ChatbotLlmClient, ChatbotLlmRequest, ChatbotLlmResponse } from "@/lib/chatbot/server/llm-client"
import { ChatbotLlmError } from "@/lib/chatbot/server/llm-client"

type Tier2OllamaDeepSeekClientConfig = {
  baseUrl: string
  modelName: string
  requestTimeoutMs: number
  healthCheckTimeoutMs: number
}

type Tier2OllamaDeepSeekClientOptions = Tier2OllamaDeepSeekClientConfig & {
  httpClient?: Tier2OllamaHttpClient
}

type Tier2OllamaHttpClient = (input: string, init?: RequestInit) => Promise<Response>

type TimeoutTag = "timeout"

type OllamaChatResponse = {
  model?: unknown
  message?: {
    content?: unknown
  }
  load_duration?: unknown
  eval_count?: unknown
  eval_duration?: unknown
}

type OllamaTagsResponse = {
  models?: unknown
}

type OllamaModelEntry = {
  name?: unknown
  model?: unknown
}

class OllamaHttpStatusError extends Error {
  constructor(readonly status: number) {
    super("Ollama HTTP request failed.")
    this.name = "OllamaHttpStatusError"
  }
}

export const tier2OllamaDeepSeekDefaults = {
  baseUrl: "http://localhost:11434",
  modelName: "hf.co/mmnga/cyberagent-DeepSeek-R1-Distill-Qwen-14B-Japanese-gguf:Q4_K_M",
  requestTimeoutMs: 12000,
  healthCheckTimeoutMs: 3000,
} as const

const tier = "tier-2-ollama-deepseek" as const
const emptyText = ""
const timeoutTag: TimeoutTag = "timeout"
const chatEndpointPath = "/api/chat"
const tagsEndpointPath = "/api/tags"
const httpMethodGet = "GET"
const httpMethodPost = "POST"
const headerContentType = "content-type"
const contentTypeJson = "application/json"
const roleSystem = "system"
const roleUser = "user"
const streamDisabled = false
const httpStatusTooManyRequests = 429

export class Tier2OllamaDeepSeekClient implements ChatbotLlmClient {
  readonly tier = tier
  private readonly config: Tier2OllamaDeepSeekClientConfig
  private readonly httpClient: Tier2OllamaHttpClient

  constructor(options: Tier2OllamaDeepSeekClientOptions) {
    this.config = {
      baseUrl: options.baseUrl,
      modelName: options.modelName,
      requestTimeoutMs: options.requestTimeoutMs,
      healthCheckTimeoutMs: options.healthCheckTimeoutMs,
    }
    this.httpClient = options.httpClient ?? globalFetch
  }

  async generate(request: ChatbotLlmRequest): Promise<ChatbotLlmResponse> {
    const startedAt = Date.now()

    try {
      const response = await this.requestJson<OllamaChatResponse>(
        chatEndpointPath,
        {
          method: httpMethodPost,
          headers: { [headerContentType]: contentTypeJson },
          body: JSON.stringify({
            model: this.config.modelName,
            messages: buildMessages(request),
            stream: streamDisabled,
          }),
        },
        this.config.requestTimeoutMs,
      )
      const rawText = getOllamaMessageContent(response).trim()

      if (rawText === emptyText) {
        throw this.toLlmError({
          message: "Ollama DeepSeek tier returned an empty response.",
          code: "invalid-output",
          isRetryable: false,
        })
      }

      return {
        rawText,
        tier: this.tier,
        latencyMs: Date.now() - startedAt,
        diagnostics: buildOllamaDiagnostics(response),
      }
    } catch (error) {
      throw this.mapGenerateError(error)
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      const response = await this.requestJson<OllamaTagsResponse>(
        tagsEndpointPath,
        { method: httpMethodGet },
        this.config.healthCheckTimeoutMs,
      )

      return hasModel(response.models, this.config.modelName)
    } catch {
      return false
    }
  }

  private async requestJson<T>(
    path: string,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<T> {
    const response = await this.request(path, init, timeoutMs)

    if (!response.ok) {
      throw new OllamaHttpStatusError(response.status)
    }

    return (await response.json()) as T
  }

  private async request(path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    try {
      return await withTimeout(
        this.httpClient(`${this.config.baseUrl}${path}`, init),
        timeoutMs,
        timeoutTag,
      )
    } catch (error) {
      if (error === timeoutTag) throw error
      throw this.toLlmError({
        message: "Unable to connect to the Ollama DeepSeek endpoint.",
        code: "connection",
        isRetryable: true,
        cause: error,
      })
    }
  }

  private mapGenerateError(error: unknown): ChatbotLlmError {
    if (error instanceof ChatbotLlmError) return error

    if (error === timeoutTag) {
      return this.toLlmError({
        message: "Ollama DeepSeek tier request timed out.",
        code: "timeout",
        isRetryable: true,
      })
    }

    if (error instanceof OllamaHttpStatusError && error.status === httpStatusTooManyRequests) {
      return this.toLlmError({
        message: "Ollama DeepSeek tier was rate limited.",
        code: "rate-limit",
        isRetryable: true,
        cause: error,
      })
    }

    return this.toLlmError({
      message: "Ollama DeepSeek tier failed with an unknown error.",
      code: "unknown",
      isRetryable: false,
      cause: error,
    })
  }

  private toLlmError(input: {
    message: string
    code: ConstructorParameters<typeof ChatbotLlmError>[0]["code"]
    isRetryable: boolean
    cause?: unknown
  }): ChatbotLlmError {
    return new ChatbotLlmError({
      message: input.message,
      code: input.code,
      tier: this.tier,
      isRetryable: input.isRetryable,
      cause: input.cause,
    })
  }
}

export function createTier2OllamaDeepSeekClient(
  overrides: Partial<Tier2OllamaDeepSeekClientConfig> & {
    httpClient?: Tier2OllamaHttpClient
  } = {},
): Tier2OllamaDeepSeekClient {
  return new Tier2OllamaDeepSeekClient({
    baseUrl: process.env.CHATBOT_TIER2_OLLAMA_BASE_URL ?? tier2OllamaDeepSeekDefaults.baseUrl,
    modelName: process.env.CHATBOT_TIER2_OLLAMA_MODEL ?? tier2OllamaDeepSeekDefaults.modelName,
    requestTimeoutMs: tier2OllamaDeepSeekDefaults.requestTimeoutMs,
    healthCheckTimeoutMs: tier2OllamaDeepSeekDefaults.healthCheckTimeoutMs,
    ...overrides,
  })
}

function globalFetch(input: string, init?: RequestInit): Promise<Response> {
  return fetch(input, init)
}

function buildMessages(request: ChatbotLlmRequest) {
  return [
    { role: roleSystem, content: request.systemPrompt },
    ...request.messages,
    request.latestUserMessage ? { role: roleUser, content: request.latestUserMessage } : undefined,
  ].filter((message): message is Exclude<typeof message, undefined> => Boolean(message))
}

function getOllamaMessageContent(response: OllamaChatResponse): string {
  return typeof response.message?.content === "string" ? response.message.content : emptyText
}

function buildOllamaDiagnostics(response: OllamaChatResponse): Record<string, unknown> {
  const evalCount = numberOrUndefined(response.eval_count)
  const evalDurationMs = nanosecondsToMilliseconds(response.eval_duration)
  const loadDurationMs = nanosecondsToMilliseconds(response.load_duration)
  const tokensPerSecond =
    typeof evalCount === "number" && typeof evalDurationMs === "number" && evalDurationMs > 0
      ? evalCount / (evalDurationMs / 1000)
      : undefined

  return {
    model: typeof response.model === "string" ? response.model : undefined,
    loadDurationMs,
    evalCount,
    evalDurationMs,
    tokensPerSecond,
  }
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function nanosecondsToMilliseconds(value: unknown): number | undefined {
  const numeric = numberOrUndefined(value)
  return typeof numeric === "number" ? numeric / 1_000_000 : undefined
}

function hasModel(models: unknown, modelName: string): boolean {
  if (!Array.isArray(models)) return false

  return models.some((model) => modelMatches(model, modelName))
}

function modelMatches(model: unknown, modelName: string): boolean {
  if (typeof model === "string") return model === modelName
  if (!model || typeof model !== "object") return false

  const candidate = model as OllamaModelEntry

  return candidate.name === modelName || candidate.model === modelName
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, tag: TimeoutTag): Promise<T> {
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
