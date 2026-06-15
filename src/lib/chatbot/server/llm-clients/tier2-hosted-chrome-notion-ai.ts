import type { ChatbotLlmClient, ChatbotLlmRequest, ChatbotLlmResponse } from "@/lib/chatbot/server/llm-client"
import { ChatbotLlmError } from "@/lib/chatbot/server/llm-client"

type Tier2HostedChromeNotionAiClientConfig = {
  workerUrl?: string
  token?: string
  requestTimeoutMs: number
  healthCheckTimeoutMs: number
  enabled: boolean
}

type Tier2HostedChromeNotionAiClientOptions = Partial<Tier2HostedChromeNotionAiClientConfig> & {
  httpClient?: Tier2HostedWorkerHttpClient
}

type Tier2HostedWorkerHttpClient = (input: string, init?: RequestInit) => Promise<Response>

type TimeoutTag = "timeout"

type HostedWorkerHealthResponse = {
  ok?: unknown
}

type HostedWorkerGenerateResponse = {
  rawText?: unknown
  tokensUsed?: unknown
  latencyMs?: unknown
}

class HostedWorkerHttpStatusError extends Error {
  constructor(readonly status: number) {
    super("Hosted Notion AI worker HTTP request failed.")
    this.name = "HostedWorkerHttpStatusError"
  }
}

export const tier2HostedChromeNotionAiDefaults = {
  requestTimeoutMs: 45000,
  healthCheckTimeoutMs: 3000,
  enabled: true,
} as const

const tier = "tier-2-hosted-chrome-notion-ai" as const
const timeoutTag: TimeoutTag = "timeout"
const healthEndpointPath = "/health"
const generateEndpointPath = "/generate"
const httpMethodGet = "GET"
const httpMethodPost = "POST"
const headerAuthorization = "authorization"
const headerContentType = "content-type"
const contentTypeJson = "application/json"
const bearerPrefix = "Bearer "
const emptyText = ""
const httpStatusUnauthorized = 401
const httpStatusForbidden = 403
const httpStatusTooManyRequests = 429
const firstServerErrorStatus = 500

export class Tier2HostedChromeNotionAiClient implements ChatbotLlmClient {
  readonly tier = tier
  private readonly config: Tier2HostedChromeNotionAiClientConfig
  private readonly httpClient: Tier2HostedWorkerHttpClient
  private lastHealthError?: ChatbotLlmError | Error

  constructor(options: Tier2HostedChromeNotionAiClientOptions = {}) {
    this.config = {
      workerUrl: trimTrailingSlash(options.workerUrl),
      token: options.token,
      requestTimeoutMs: options.requestTimeoutMs ?? tier2HostedChromeNotionAiDefaults.requestTimeoutMs,
      healthCheckTimeoutMs:
        options.healthCheckTimeoutMs ?? tier2HostedChromeNotionAiDefaults.healthCheckTimeoutMs,
      enabled: options.enabled ?? tier2HostedChromeNotionAiDefaults.enabled,
    }
    this.httpClient = options.httpClient ?? globalFetch
  }

  async generate(request: ChatbotLlmRequest): Promise<ChatbotLlmResponse> {
    const startedAt = Date.now()

    try {
      this.assertConfigured()
      const response = await this.requestJson<HostedWorkerGenerateResponse>(
        generateEndpointPath,
        {
          method: httpMethodPost,
          headers: this.headers({ contentType: true }),
          body: JSON.stringify(request),
        },
        this.config.requestTimeoutMs,
      )
      const rawText = getHostedWorkerRawText(response).trim()

      if (rawText === emptyText) {
        throw this.toLlmError({
          message: "Hosted Notion AI worker returned an empty response.",
          code: "invalid-output",
          isRetryable: false,
        })
      }

      return {
        rawText,
        tokensUsed: numberOrUndefined(response.tokensUsed),
        latencyMs: Date.now() - startedAt,
        tier: this.tier,
        diagnostics: {
          endpoint: generateEndpointPath,
          workerLatencyMs: numberOrUndefined(response.latencyMs),
        },
      }
    } catch (error) {
      throw this.mapGenerateError(error)
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      this.lastHealthError = undefined
      this.assertConfigured()
      const response = await this.requestJson<HostedWorkerHealthResponse>(
        healthEndpointPath,
        {
          method: httpMethodGet,
          headers: this.headers(),
        },
        this.config.healthCheckTimeoutMs,
      )
      const healthy = response.ok === true

      if (!healthy) {
        this.lastHealthError = this.toLlmError({
          message: "Hosted Notion AI worker health check did not return ok: true.",
          code: "connection",
          isRetryable: true,
        })
      }

      return healthy
    } catch (error) {
      const normalized = this.mapHealthError(error)
      this.lastHealthError = normalized
      return false
    }
  }

  getLastHealthError(): ChatbotLlmError | Error | undefined {
    return this.lastHealthError
  }

  private assertConfigured(): void {
    if (!this.config.enabled) {
      throw this.toLlmError({
        message: "Hosted Notion AI worker tier is disabled.",
        code: "connection",
        isRetryable: true,
      })
    }

    if (!this.config.workerUrl || !this.config.token) {
      throw this.toLlmError({
        message: "Hosted Notion AI worker URL or token is not configured.",
        code: "auth",
        isRetryable: false,
      })
    }
  }

  private async requestJson<T>(
    path: string,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<T> {
    const response = await this.request(path, init, timeoutMs)

    if (!response.ok) {
      throw new HostedWorkerHttpStatusError(response.status)
    }

    try {
      return (await response.json()) as T
    } catch (error) {
      throw this.toLlmError({
        message: "Hosted Notion AI worker returned invalid JSON.",
        code: "invalid-output",
        isRetryable: false,
        cause: error,
      })
    }
  }

  private async request(path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    try {
      return await withTimeout(
        this.httpClient(`${this.config.workerUrl}${path}`, init),
        timeoutMs,
        timeoutTag,
      )
    } catch (error) {
      if (error === timeoutTag || error instanceof ChatbotLlmError) throw error
      throw this.toLlmError({
        message: "Unable to connect to the Hosted Notion AI worker endpoint.",
        code: "connection",
        isRetryable: true,
        cause: error,
      })
    }
  }

  private headers(options: { contentType?: boolean } = {}): HeadersInit {
    return {
      [headerAuthorization]: `${bearerPrefix}${this.config.token}`,
      ...(options.contentType ? { [headerContentType]: contentTypeJson } : {}),
    }
  }

  private mapHealthError(error: unknown): ChatbotLlmError {
    if (error instanceof ChatbotLlmError) return error

    if (error === timeoutTag) {
      return this.toLlmError({
        message: "Hosted Notion AI worker health check timed out.",
        code: "timeout",
        isRetryable: true,
      })
    }

    return this.mapHttpStatusError(error, {
      fallbackMessage: "Hosted Notion AI worker health check failed.",
    })
  }

  private mapGenerateError(error: unknown): ChatbotLlmError {
    if (error instanceof ChatbotLlmError) return error

    if (error === timeoutTag) {
      return this.toLlmError({
        message: "Hosted Notion AI worker request timed out.",
        code: "timeout",
        isRetryable: true,
      })
    }

    return this.mapHttpStatusError(error, {
      fallbackMessage: "Hosted Notion AI worker failed with an unknown error.",
    })
  }

  private mapHttpStatusError(
    error: unknown,
    input: { fallbackMessage: string },
  ): ChatbotLlmError {
    if (error instanceof HostedWorkerHttpStatusError) {
      if (error.status === httpStatusUnauthorized || error.status === httpStatusForbidden) {
        return this.toLlmError({
          message: "Hosted Notion AI worker authentication failed.",
          code: "auth",
          isRetryable: false,
          cause: error,
        })
      }

      if (error.status === httpStatusTooManyRequests) {
        return this.toLlmError({
          message: "Hosted Notion AI worker was rate limited.",
          code: "rate-limit",
          isRetryable: true,
          cause: error,
        })
      }

      if (error.status >= firstServerErrorStatus) {
        return this.toLlmError({
          message: "Hosted Notion AI worker returned a server error.",
          code: "connection",
          isRetryable: true,
          cause: error,
        })
      }
    }

    return this.toLlmError({
      message: input.fallbackMessage,
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

export function createTier2HostedChromeNotionAiClient(
  overrides: Partial<Tier2HostedChromeNotionAiClientConfig> & {
    httpClient?: Tier2HostedWorkerHttpClient
  } = {},
): Tier2HostedChromeNotionAiClient {
  return new Tier2HostedChromeNotionAiClient({
    workerUrl: process.env.CHATBOT_HOSTED_NOTION_AI_WORKER_URL,
    token: process.env.CHATBOT_HOSTED_NOTION_AI_WORKER_TOKEN,
    requestTimeoutMs: parsePositiveInteger(
      process.env.CHATBOT_HOSTED_NOTION_AI_TIMEOUT_MS,
      tier2HostedChromeNotionAiDefaults.requestTimeoutMs,
    ),
    healthCheckTimeoutMs: parsePositiveInteger(
      process.env.CHATBOT_HOSTED_NOTION_AI_HEALTH_TIMEOUT_MS,
      tier2HostedChromeNotionAiDefaults.healthCheckTimeoutMs,
    ),
    enabled: parseEnabled(process.env.CHATBOT_HOSTED_NOTION_AI_ENABLED),
    ...overrides,
  })
}

function globalFetch(input: string, init?: RequestInit): Promise<Response> {
  return fetch(input, init)
}

function parseEnabled(value: string | undefined): boolean {
  if (!value) return tier2HostedChromeNotionAiDefaults.enabled

  return !["false", "0", "off"].includes(value.trim().toLowerCase())
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback

  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function trimTrailingSlash(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed) return undefined

  return trimmed.replace(/\/+$/, "")
}

function getHostedWorkerRawText(response: HostedWorkerGenerateResponse): string {
  return typeof response.rawText === "string" ? response.rawText : emptyText
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
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
