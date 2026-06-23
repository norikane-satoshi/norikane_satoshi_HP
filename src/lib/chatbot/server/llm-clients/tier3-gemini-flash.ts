import { readFileSync } from "node:fs"
import { join } from "node:path"

import type { ChatbotMessageRole } from "@/lib/chatbot/domain"
import type { ChatbotLlmClient, ChatbotLlmRequest, ChatbotLlmResponse } from "@/lib/chatbot/server/llm-client"
import { ChatbotLlmError } from "@/lib/chatbot/server/llm-client"

type Tier3GeminiFlashClientConfig = {
  apiKey?: string
  modelName: string
  baseUrl: string
  requestTimeoutMs: number
  healthCheckTimeoutMs: number
  enabled: boolean
}

type Tier3GeminiFlashClientOptions = Partial<Tier3GeminiFlashClientConfig> & {
  httpClient?: Tier3GeminiHttpClient
}

type Tier3GeminiHttpClient = (input: string, init?: RequestInit) => Promise<Response>

type TimeoutTag = "timeout"

type GeminiGenerateResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: unknown }>
    }
    finishReason?: unknown
  }>
  usageMetadata?: {
    totalTokenCount?: unknown
  }
  modelVersion?: unknown
  promptFeedback?: {
    blockReason?: unknown
  }
}

class GeminiHttpStatusError extends Error {
  constructor(readonly status: number) {
    super("Gemini Flash HTTP request failed.")
    this.name = "GeminiHttpStatusError"
  }
}

export const tier3GeminiFlashDefaults = {
  baseUrl: "https://generativelanguage.googleapis.com",
  modelName: "gemini-2.5-flash",
  requestTimeoutMs: 30000,
  healthCheckTimeoutMs: 3000,
  enabled: true,
} as const

const tier = "tier-3-gemini-flash" as const
const timeoutTag: TimeoutTag = "timeout"
const apiVersionPath = "/v1beta/models/"
const generateSuffix = ":generateContent"
const httpMethodGet = "GET"
const httpMethodPost = "POST"
const headerApiKey = "x-goog-api-key"
const headerContentType = "content-type"
const contentTypeJson = "application/json"
const emptyText = ""
const firstServerErrorStatus = 500

export class Tier3GeminiFlashClient implements ChatbotLlmClient {
  readonly tier = tier
  private readonly config: Tier3GeminiFlashClientConfig
  private readonly httpClient: Tier3GeminiHttpClient
  private lastHealthError?: ChatbotLlmError | Error

  constructor(options: Tier3GeminiFlashClientOptions = {}) {
    this.config = {
      apiKey: options.apiKey,
      modelName: options.modelName ?? tier3GeminiFlashDefaults.modelName,
      baseUrl: trimTrailingSlash(options.baseUrl) ?? tier3GeminiFlashDefaults.baseUrl,
      requestTimeoutMs: options.requestTimeoutMs ?? tier3GeminiFlashDefaults.requestTimeoutMs,
      healthCheckTimeoutMs: options.healthCheckTimeoutMs ?? tier3GeminiFlashDefaults.healthCheckTimeoutMs,
      enabled: options.enabled ?? tier3GeminiFlashDefaults.enabled,
    }
    this.httpClient = options.httpClient ?? globalFetch
  }

  async generate(request: ChatbotLlmRequest): Promise<ChatbotLlmResponse> {
    const startedAt = Date.now()

    try {
      this.assertConfigured()
      const response = await this.requestJson<GeminiGenerateResponse>(
        `${this.modelPath()}${generateSuffix}`,
        {
          method: httpMethodPost,
          headers: this.headers({ contentType: true }),
          body: JSON.stringify(buildGenerateBody(request)),
        },
        this.config.requestTimeoutMs,
      )
      const rawText = getGeminiText(response).trim()

      if (rawText === emptyText) {
        throw this.toLlmError({
          message: buildInvalidOutputMessage(response),
          code: "invalid-output",
          isRetryable: false,
        })
      }

      return {
        rawText,
        tokensUsed: numberOrUndefined(response.usageMetadata?.totalTokenCount),
        latencyMs: Date.now() - startedAt,
        tier: this.tier,
        diagnostics: {
          endpoint: `${apiVersionPath}${this.config.modelName}${generateSuffix}`,
          model: typeof response.modelVersion === "string" ? response.modelVersion : this.config.modelName,
          finishReason: firstFinishReason(response),
        },
      }
    } catch (error) {
      throw this.mapError(error, "Gemini Flash tier failed.")
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      this.lastHealthError = undefined
      this.assertConfigured()
      await this.requestJson<unknown>(
        this.modelPath(),
        {
          method: httpMethodGet,
          headers: this.headers(),
        },
        this.config.healthCheckTimeoutMs,
      )
      return true
    } catch (error) {
      const normalized = this.mapError(error, "Gemini Flash health check failed.")
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
        message: "Gemini Flash tier is disabled.",
        code: "connection",
        isRetryable: true,
      })
    }

    if (!this.config.apiKey) {
      throw this.toLlmError({
        message: "Gemini Flash API key is not configured.",
        code: "auth",
        isRetryable: false,
      })
    }
  }

  private async requestJson<T>(path: string, init: RequestInit, timeoutMs: number): Promise<T> {
    const response = await this.request(path, init, timeoutMs)
    if (!response.ok) throw new GeminiHttpStatusError(response.status)

    try {
      return (await response.json()) as T
    } catch (error) {
      throw this.toLlmError({
        message: "Gemini Flash returned invalid JSON.",
        code: "invalid-output",
        isRetryable: false,
        cause: error,
      })
    }
  }

  private async request(path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    try {
      return await withTimeout(this.httpClient(`${this.config.baseUrl}${path}`, init), timeoutMs, timeoutTag)
    } catch (error) {
      if (error === timeoutTag || error instanceof ChatbotLlmError) throw error
      throw this.toLlmError({
        message: "Unable to connect to the Gemini Flash endpoint.",
        code: "connection",
        isRetryable: true,
        cause: error,
      })
    }
  }

  private headers(options: { contentType?: boolean } = {}): HeadersInit {
    return {
      [headerApiKey]: this.config.apiKey ?? "",
      ...(options.contentType ? { [headerContentType]: contentTypeJson } : {}),
    }
  }

  private modelPath(): string {
    return `${apiVersionPath}${encodeURIComponent(this.config.modelName)}`
  }

  private mapError(error: unknown, fallbackMessage: string): ChatbotLlmError {
    if (error instanceof ChatbotLlmError) return error

    if (error === timeoutTag) {
      return this.toLlmError({
        message: "Gemini Flash request timed out.",
        code: "timeout",
        isRetryable: true,
      })
    }

    if (error instanceof GeminiHttpStatusError) {
      if (error.status === 401 || error.status === 403) {
        return this.toLlmError({
          message: "Gemini Flash authentication failed.",
          code: "auth",
          isRetryable: false,
          cause: error,
        })
      }
      if (error.status === 429) {
        return this.toLlmError({
          message: "Gemini Flash tier was rate limited.",
          code: "rate-limit",
          isRetryable: true,
          cause: error,
        })
      }
      if (error.status >= firstServerErrorStatus) {
        return this.toLlmError({
          message: "Gemini Flash returned a server error.",
          code: "connection",
          isRetryable: true,
          cause: error,
        })
      }
    }

    return this.toLlmError({
      message: fallbackMessage,
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

export function createTier3GeminiFlashClient(
  overrides: Tier3GeminiFlashClientOptions = {},
): Tier3GeminiFlashClient {
  const env = readGeminiEnv()

  return new Tier3GeminiFlashClient({
    apiKey: env.CHATBOT_TIER3_GEMINI_API_KEY ?? env.GEMINI_API_KEY,
    modelName: env.CHATBOT_TIER3_GEMINI_MODEL ?? tier3GeminiFlashDefaults.modelName,
    baseUrl: env.CHATBOT_TIER3_GEMINI_BASE_URL ?? tier3GeminiFlashDefaults.baseUrl,
    requestTimeoutMs: parsePositiveInteger(
      env.CHATBOT_TIER3_GEMINI_TIMEOUT_MS,
      tier3GeminiFlashDefaults.requestTimeoutMs,
    ),
    healthCheckTimeoutMs: parsePositiveInteger(
      env.CHATBOT_TIER3_GEMINI_HEALTH_TIMEOUT_MS,
      tier3GeminiFlashDefaults.healthCheckTimeoutMs,
    ),
    enabled: parseEnabled(env.CHATBOT_TIER3_GEMINI_ENABLED),
    ...overrides,
  })
}

function buildGenerateBody(request: ChatbotLlmRequest): Record<string, unknown> {
  const contents = request.messages.length > 0
    ? request.messages.map(toGeminiContent)
    : request.latestUserMessage
      ? [toGeminiContent({ role: "user", content: request.latestUserMessage })]
      : []

  return {
    systemInstruction: {
      parts: [{ text: request.systemPrompt }],
    },
    contents,
    generationConfig: {
      temperature: request.temperature ?? 0.2,
      maxOutputTokens: request.maxOutputTokens ?? 900,
    },
  }
}

function toGeminiContent(message: { role: ChatbotMessageRole; content: string }): Record<string, unknown> {
  return {
    role: message.role === "assistant" ? "model" : "user",
    parts: [{ text: message.content }],
  }
}

function getGeminiText(response: GeminiGenerateResponse): string {
  return response.candidates?.[0]?.content?.parts
    ?.map((part) => (typeof part.text === "string" ? part.text : ""))
    .join("") ?? emptyText
}

function buildInvalidOutputMessage(response: GeminiGenerateResponse): string {
  const blockReason = response.promptFeedback?.blockReason
  if (typeof blockReason === "string" && blockReason) {
    return `Gemini Flash returned no text. blockReason=${blockReason}`
  }
  return "Gemini Flash returned an empty response."
}

function firstFinishReason(response: GeminiGenerateResponse): string | undefined {
  const reason = response.candidates?.[0]?.finishReason
  return typeof reason === "string" ? reason : undefined
}

function globalFetch(input: string, init?: RequestInit): Promise<Response> {
  return fetch(input, init)
}

function readGeminiEnv(): Record<string, string | undefined> {
  const localEnv = readLocalEnvFile()
  const names = [
    "CHATBOT_TIER3_GEMINI_API_KEY",
    "GEMINI_API_KEY",
    "CHATBOT_TIER3_GEMINI_MODEL",
    "CHATBOT_TIER3_GEMINI_BASE_URL",
    "CHATBOT_TIER3_GEMINI_TIMEOUT_MS",
    "CHATBOT_TIER3_GEMINI_HEALTH_TIMEOUT_MS",
    "CHATBOT_TIER3_GEMINI_ENABLED",
  ] as const
  return Object.fromEntries(names.map((name) => [name, process.env[name] ?? localEnv[name]]))
}

function readLocalEnvFile(): Record<string, string | undefined> {
  try {
    return parseEnvFile(readFileSync(join(process.cwd(), ".env.local"), "utf8"))
  } catch {
    return {}
  }
}

function parseEnvFile(raw: string): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {}
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const separatorIndex = trimmed.indexOf("=")
    if (separatorIndex < 0) continue
    const key = trimmed.slice(0, separatorIndex).trim()
    let value = trimmed.slice(separatorIndex + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    env[key] = value
  }
  return env
}

function parseEnabled(value: string | undefined): boolean {
  if (!value) return tier3GeminiFlashDefaults.enabled
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
