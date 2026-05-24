import type { ChatbotLlmClient, ChatbotLlmRequest, ChatbotLlmResponse } from "@/lib/chatbot/server/llm-client"
import { ChatbotLlmError } from "@/lib/chatbot/server/llm-client"

type Tier3GeminiFlashLiteClientConfig = {
  baseUrl: string
  apiKey: string
  modelName: string
  requestTimeoutMs: number
  healthCheckTimeoutMs: number
  preferredModel?: string
}

type Tier3GeminiFlashLiteClientOptions = Partial<Tier3GeminiFlashLiteClientConfig> & {
  httpClient?: Tier3GeminiHttpClient
}

type Tier3GeminiHttpClient = (input: string, init?: RequestInit) => Promise<Response>

type TimeoutTag = "timeout"

type GeminiGenerateContentResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: unknown }>
    }
  }>
  usageMetadata?: {
    totalTokenCount?: unknown
  }
}

type GeminiContent = {
  role: "user" | "model"
  parts: Array<{ text: string }>
}

class GeminiHttpStatusError extends Error {
  constructor(readonly status: number) {
    super("Gemini HTTP request failed.")
    this.name = "GeminiHttpStatusError"
  }
}

export const tier3GeminiFlashLiteDefaults = {
  baseUrl: "https://generativelanguage.googleapis.com",
  modelName: "gemini-2.5-flash-lite",
  requestTimeoutMs: 90000,
  healthCheckTimeoutMs: 3000,
} as const

const tier = "tier-3-gemini-flash-lite" as const
const timeoutTag: TimeoutTag = "timeout"
const emptyText = ""
const httpMethodHead = "HEAD"
const httpMethodPost = "POST"
const headerContentType = "content-type"
const contentTypeJson = "application/json"
const generateContentPathPrefix = "/v1beta/models/"
const generateContentPathSuffix = ":generateContent"
const queryKey = "key"
const httpStatusUnauthorized = 401
const httpStatusForbidden = 403
const httpStatusTooManyRequests = 429
const httpStatusServerError = 500

export class Tier3GeminiFlashLiteClient implements ChatbotLlmClient {
  readonly tier = tier
  private readonly config: Tier3GeminiFlashLiteClientConfig
  private readonly httpClient: Tier3GeminiHttpClient

  constructor(options: Tier3GeminiFlashLiteClientOptions = {}) {
    this.config = {
      baseUrl: options.baseUrl ?? tier3GeminiFlashLiteDefaults.baseUrl,
      apiKey: options.apiKey ?? emptyText,
      modelName: options.modelName ?? tier3GeminiFlashLiteDefaults.modelName,
      requestTimeoutMs: options.requestTimeoutMs ?? tier3GeminiFlashLiteDefaults.requestTimeoutMs,
      healthCheckTimeoutMs:
        options.healthCheckTimeoutMs ?? tier3GeminiFlashLiteDefaults.healthCheckTimeoutMs,
      preferredModel: options.preferredModel,
    }
    this.httpClient = options.httpClient ?? globalFetch
  }

  async generate(request: ChatbotLlmRequest): Promise<ChatbotLlmResponse> {
    const startedAt = Date.now()

    if (!this.config.apiKey) {
      throw this.toLlmError({
        message: "Gemini Flash-Lite tier is missing an API key.",
        code: "auth",
        isRetryable: false,
      })
    }

    try {
      const response = await this.requestJson<GeminiGenerateContentResponse>(
        this.generateContentPath(),
        {
          method: httpMethodPost,
          headers: { [headerContentType]: contentTypeJson },
          body: JSON.stringify(buildGenerateContentPayload(request)),
        },
        this.config.requestTimeoutMs,
      )
      const rawText = getGeminiCandidateText(response).trim()

      if (rawText === emptyText) {
        throw this.toLlmError({
          message: "Gemini Flash-Lite tier returned an empty response.",
          code: "invalid-output",
          isRetryable: false,
        })
      }

      return {
        rawText,
        tier: this.tier,
        latencyMs: Date.now() - startedAt,
        tokensUsed: getTotalTokens(response),
      }
    } catch (error) {
      throw this.mapGenerateError(error)
    }
  }

  async isHealthy(): Promise<boolean> {
    if (!this.config.apiKey) return false

    try {
      await this.request(emptyText, { method: httpMethodHead }, this.config.healthCheckTimeoutMs)
      return true
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
      throw new GeminiHttpStatusError(response.status)
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
      if (
        error === timeoutTag ||
        error instanceof ChatbotLlmError ||
        error instanceof GeminiHttpStatusError
      ) {
        throw error
      }

      throw this.toLlmError({
        message: "Unable to connect to the Gemini Flash-Lite endpoint.",
        code: "connection",
        isRetryable: true,
        cause: error,
      })
    }
  }

  private generateContentPath(): string {
    const urlSearchParams = new URLSearchParams({ [queryKey]: this.config.apiKey })
    const modelName = encodeURIComponent(this.config.preferredModel ?? this.config.modelName)

    return `${generateContentPathPrefix}${modelName}${generateContentPathSuffix}?${urlSearchParams.toString()}`
  }

  private mapGenerateError(error: unknown): ChatbotLlmError {
    if (error instanceof ChatbotLlmError) return error

    if (error === timeoutTag) {
      return this.toLlmError({
        message: "Gemini Flash-Lite tier request timed out.",
        code: "timeout",
        isRetryable: true,
      })
    }

    if (error instanceof GeminiHttpStatusError) {
      if (error.status === httpStatusUnauthorized || error.status === httpStatusForbidden) {
        return this.toLlmError({
          message: "Gemini Flash-Lite tier authentication failed.",
          code: "auth",
          isRetryable: false,
          cause: error,
        })
      }

      if (error.status === httpStatusTooManyRequests) {
        return this.toLlmError({
          message: "Gemini Flash-Lite tier was rate limited.",
          code: "rate-limit",
          isRetryable: true,
          cause: error,
        })
      }

      if (error.status >= httpStatusServerError) {
        return this.toLlmError({
          message: "Gemini Flash-Lite endpoint returned a server error.",
          code: "connection",
          isRetryable: true,
          cause: error,
        })
      }
    }

    return this.toLlmError({
      message: "Gemini Flash-Lite tier failed with an unknown error.",
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

export function createTier3GeminiFlashLiteClient(
  overrides: Tier3GeminiFlashLiteClientOptions = {},
): Tier3GeminiFlashLiteClient {
  return new Tier3GeminiFlashLiteClient({
    baseUrl: tier3GeminiFlashLiteDefaults.baseUrl,
    apiKey: process.env.GEMINI_API_KEY ?? process.env.CHATBOT_TIER3_GEMINI_API_KEY ?? emptyText,
    modelName: process.env.CHATBOT_TIER3_GEMINI_MODEL ?? tier3GeminiFlashLiteDefaults.modelName,
    requestTimeoutMs: tier3GeminiFlashLiteDefaults.requestTimeoutMs,
    healthCheckTimeoutMs: tier3GeminiFlashLiteDefaults.healthCheckTimeoutMs,
    ...overrides,
  })
}

function globalFetch(input: string, init?: RequestInit): Promise<Response> {
  return fetch(input, init)
}

function buildGenerateContentPayload(request: ChatbotLlmRequest) {
  return {
    systemInstruction: {
      parts: [{ text: request.systemPrompt }],
    },
    contents: buildContents(request),
    generationConfig: {
      temperature: request.temperature,
      maxOutputTokens: request.maxOutputTokens,
    },
  }
}

function buildContents(request: ChatbotLlmRequest): GeminiContent[] {
  return [
    ...request.messages.map((message): GeminiContent => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }],
    })),
    request.latestUserMessage
      ? {
          role: "user",
          parts: [{ text: request.latestUserMessage }],
        }
      : undefined,
  ].filter((message): message is GeminiContent => Boolean(message))
}

function getGeminiCandidateText(response: GeminiGenerateContentResponse): string {
  const parts = response.candidates?.[0]?.content?.parts

  if (!Array.isArray(parts)) return emptyText

  return parts.map((part) => (typeof part.text === "string" ? part.text : emptyText)).join(emptyText)
}

function getTotalTokens(response: GeminiGenerateContentResponse): number | undefined {
  const totalTokenCount = response.usageMetadata?.totalTokenCount

  return typeof totalTokenCount === "number" ? totalTokenCount : undefined
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
