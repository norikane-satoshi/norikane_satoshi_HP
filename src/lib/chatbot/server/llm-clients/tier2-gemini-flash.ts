import { readFileSync } from "node:fs"
import { join } from "node:path"

import type { ChatbotMessageRole } from "@/lib/chatbot/domain"
import type { ChatbotLlmClient, ChatbotLlmRequest, ChatbotLlmResponse } from "@/lib/chatbot/server/llm-client"
import {
  ChatbotLlmError,
  chatbotLlmTierIds,
  createChatbotLlmResponse,
} from "@/lib/chatbot/server/llm-client"

type Tier2GeminiFlashClientConfig = {
  apiKey?: string
  modelName: string
  dailyQuotaFallbackModelName: string
  baseUrl: string
  requestTimeoutMs: number
  healthCheckTimeoutMs: number
  rateLimitMaxRetries: number
  rateLimitMaxDelayMs: number
  enabled: boolean
}

type Tier2GeminiFlashClientOptions = Partial<Tier2GeminiFlashClientConfig> & {
  httpClient?: Tier2GeminiHttpClient
  sleep?: (delayMs: number) => Promise<void>
}

type Tier2GeminiHttpClient = (input: string, init?: RequestInit) => Promise<Response>

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
    thoughtsTokenCount?: unknown
    candidatesTokenCount?: unknown
  }
  modelVersion?: unknown
  promptFeedback?: {
    blockReason?: unknown
  }
}

class GeminiHttpStatusError extends Error {
  constructor(
    readonly status: number,
    readonly retryDelayMs?: number,
    readonly quotaIds: string[] = [],
  ) {
    super("Gemini Flash HTTP request failed.")
    this.name = "GeminiHttpStatusError"
  }
}

export const tier2GeminiFlashDefaults = {
  baseUrl: "https://generativelanguage.googleapis.com",
  modelName: "gemini-2.5-flash",
  dailyQuotaFallbackModelName: "gemini-2.5-flash-lite",
  requestTimeoutMs: 30000,
  healthCheckTimeoutMs: 3000,
  rateLimitMaxRetries: 1,
  rateLimitMaxDelayMs: 55000,
  enabled: true,
} as const

const tier = chatbotLlmTierIds.tier2GeminiFlash
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
const defaultRateLimitRetryDelayMs = 1000

export class Tier2GeminiFlashClient implements ChatbotLlmClient {
  readonly tier = tier
  private readonly config: Tier2GeminiFlashClientConfig
  private readonly httpClient: Tier2GeminiHttpClient
  private readonly sleep: (delayMs: number) => Promise<void>
  private lastHealthError?: ChatbotLlmError | Error

  constructor(options: Tier2GeminiFlashClientOptions = {}) {
    this.config = {
      apiKey: options.apiKey,
      modelName: options.modelName ?? tier2GeminiFlashDefaults.modelName,
      dailyQuotaFallbackModelName:
        options.dailyQuotaFallbackModelName ?? tier2GeminiFlashDefaults.dailyQuotaFallbackModelName,
      baseUrl: trimTrailingSlash(options.baseUrl) ?? tier2GeminiFlashDefaults.baseUrl,
      requestTimeoutMs: options.requestTimeoutMs ?? tier2GeminiFlashDefaults.requestTimeoutMs,
      healthCheckTimeoutMs: options.healthCheckTimeoutMs ?? tier2GeminiFlashDefaults.healthCheckTimeoutMs,
      rateLimitMaxRetries: normalizeNonnegativeInteger(
        options.rateLimitMaxRetries,
        tier2GeminiFlashDefaults.rateLimitMaxRetries,
      ),
      rateLimitMaxDelayMs: normalizeNonnegativeInteger(
        options.rateLimitMaxDelayMs,
        tier2GeminiFlashDefaults.rateLimitMaxDelayMs,
      ),
      enabled: options.enabled ?? tier2GeminiFlashDefaults.enabled,
    }
    this.httpClient = options.httpClient ?? globalFetch
    this.sleep = options.sleep ?? sleep
  }

  async generate(request: ChatbotLlmRequest): Promise<ChatbotLlmResponse> {
    const startedAt = Date.now()
    let rateLimitRetryCount = 0
    let dailyQuotaModelFallbackCount = 0
    let activeModelName = this.config.modelName

    try {
      this.assertConfigured()
      let response: GeminiGenerateResponse
      while (true) {
        try {
          response = await this.requestJson<GeminiGenerateResponse>(
            `${this.modelPath(activeModelName)}${generateSuffix}`,
            {
              method: httpMethodPost,
              headers: this.headers({ contentType: true }),
              body: JSON.stringify(buildGenerateBody(request, activeModelName)),
            },
            this.config.requestTimeoutMs,
          )
          break
        } catch (error) {
          if (this.shouldFallbackDailyModelQuota(error, activeModelName, dailyQuotaModelFallbackCount)) {
            activeModelName = this.config.dailyQuotaFallbackModelName
            dailyQuotaModelFallbackCount += 1
            continue
          }
          if (!this.shouldRetryRateLimit(error, rateLimitRetryCount)) throw error
          rateLimitRetryCount += 1
          await this.sleep(error.retryDelayMs ?? defaultRateLimitRetryDelayMs)
        }
      }
      const rawText = getGeminiText(response).trim()

      if (rawText === emptyText) {
        throw this.toLlmError({
          message: buildInvalidOutputMessage(response),
          code: "invalid-output",
          isRetryable: false,
          cause: buildInvalidOutputCause(response),
        })
      }

      return createChatbotLlmResponse({
        rawText,
        tokensUsed: numberOrUndefined(response.usageMetadata?.totalTokenCount),
        latencyMs: Date.now() - startedAt,
        tier: this.tier,
        diagnostics: {
          endpoint: `${apiVersionPath}${activeModelName}${generateSuffix}`,
          model: typeof response.modelVersion === "string" ? response.modelVersion : activeModelName,
          finishReason: firstFinishReason(response),
          rateLimitRetryCount,
          dailyQuotaModelFallbackCount,
        },
      })
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
    if (!response.ok) throw await buildGeminiHttpStatusError(response)

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

  private shouldRetryRateLimit(error: unknown, retryCount: number): error is GeminiHttpStatusError {
    if (!(error instanceof GeminiHttpStatusError) || error.status !== 429) return false
    if (isPerModelDailyQuota(error)) return false
    if (retryCount >= this.config.rateLimitMaxRetries) return false
    const retryDelayMs = error.retryDelayMs ?? defaultRateLimitRetryDelayMs
    return retryDelayMs <= this.config.rateLimitMaxDelayMs
  }

  private shouldFallbackDailyModelQuota(
    error: unknown,
    activeModelName: string,
    fallbackCount: number,
  ): error is GeminiHttpStatusError {
    return (
      error instanceof GeminiHttpStatusError &&
      error.status === 429 &&
      isPerModelDailyQuota(error) &&
      fallbackCount === 0 &&
      activeModelName !== this.config.dailyQuotaFallbackModelName
    )
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

  private modelPath(modelName = this.config.modelName): string {
    return `${apiVersionPath}${encodeURIComponent(modelName)}`
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

export function createTier2GeminiFlashClient(
  overrides: Tier2GeminiFlashClientOptions = {},
): Tier2GeminiFlashClient {
  const env = readGeminiEnv()

  return new Tier2GeminiFlashClient({
    apiKey: env.CHATBOT_TIER2_GEMINI_API_KEY ?? env.GEMINI_API_KEY,
    modelName: env.CHATBOT_TIER2_GEMINI_MODEL ?? tier2GeminiFlashDefaults.modelName,
    baseUrl: env.CHATBOT_TIER2_GEMINI_BASE_URL ?? tier2GeminiFlashDefaults.baseUrl,
    requestTimeoutMs: parsePositiveInteger(
      env.CHATBOT_TIER2_GEMINI_TIMEOUT_MS,
      tier2GeminiFlashDefaults.requestTimeoutMs,
    ),
    healthCheckTimeoutMs: parsePositiveInteger(
      env.CHATBOT_TIER2_GEMINI_HEALTH_TIMEOUT_MS,
      tier2GeminiFlashDefaults.healthCheckTimeoutMs,
    ),
    enabled: parseEnabled(env.CHATBOT_TIER2_GEMINI_ENABLED),
    ...overrides,
  })
}

function buildGenerateBody(request: ChatbotLlmRequest, modelName: string): Record<string, unknown> {
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
      ...(supportsDisabledThinking(modelName)
        ? { thinkingConfig: { thinkingBudget: 0 } }
        : {}),
    },
  }
}

function supportsDisabledThinking(modelName: string): boolean {
  return modelName.toLowerCase().startsWith("gemini-2.5-flash")
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

function buildInvalidOutputCause(response: GeminiGenerateResponse): Record<string, string | number> {
  return {
    invalidOutputReason: "empty-response",
    ...stringField("finishReason", firstFinishReason(response)),
    ...stringField("blockReason", response.promptFeedback?.blockReason),
    ...numberField("totalTokenCount", response.usageMetadata?.totalTokenCount),
    ...numberField("thoughtsTokenCount", response.usageMetadata?.thoughtsTokenCount),
    ...numberField("candidatesTokenCount", response.usageMetadata?.candidatesTokenCount),
  }
}

function stringField(name: string, value: unknown): Record<string, string> {
  return typeof value === "string" && value ? { [name]: value } : {}
}

function numberField(name: string, value: unknown): Record<string, number> {
  return typeof value === "number" && Number.isFinite(value) ? { [name]: value } : {}
}

function firstFinishReason(response: GeminiGenerateResponse): string | undefined {
  const reason = response.candidates?.[0]?.finishReason
  return typeof reason === "string" ? reason : undefined
}

async function buildGeminiHttpStatusError(response: Response): Promise<GeminiHttpStatusError> {
  if (response.status !== 429) return new GeminiHttpStatusError(response.status)

  const retryDelays = [retryAfterHeaderMs(response)]
  let quotaIds: string[] = []
  try {
    const payload = await response.json() as unknown
    const metadata = geminiErrorMetadata(payload)
    retryDelays.push(metadata.retryDelayMs)
    quotaIds = metadata.quotaIds
  } catch {
    // A missing or malformed error body still uses the bounded default delay.
  }
  const parsedRetryDelays = retryDelays.filter((value): value is number => typeof value === "number")
  const retryDelayMs = parsedRetryDelays.length > 0
    ? Math.max(...parsedRetryDelays)
    : defaultRateLimitRetryDelayMs
  return new GeminiHttpStatusError(response.status, retryDelayMs, quotaIds)
}

function retryAfterHeaderMs(response: Response): number | undefined {
  const value = response.headers?.get?.("retry-after")?.trim()
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000)
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : undefined
}

function geminiErrorMetadata(value: unknown): { retryDelayMs?: number; quotaIds: string[] } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { quotaIds: [] }
  const error = (value as { error?: unknown }).error
  if (!error || typeof error !== "object" || Array.isArray(error)) return { quotaIds: [] }
  const details = (error as { details?: unknown }).details
  if (!Array.isArray(details)) return { quotaIds: [] }

  let retryDelayMs: number | undefined
  const quotaIds: string[] = []
  for (const detail of details) {
    if (!detail || typeof detail !== "object" || Array.isArray(detail)) continue
    const retryDelay = (detail as { retryDelay?: unknown }).retryDelay
    if (typeof retryDelay === "string") {
      const match = /^(\d+(?:\.\d+)?)s$/u.exec(retryDelay.trim())
      const milliseconds = match ? Number(match[1]) * 1000 : Number.NaN
      if (Number.isFinite(milliseconds) && milliseconds >= 0) retryDelayMs = Math.ceil(milliseconds)
    }
    const violations = (detail as { violations?: unknown }).violations
    if (!Array.isArray(violations)) continue
    for (const violation of violations) {
      if (!violation || typeof violation !== "object" || Array.isArray(violation)) continue
      const quotaId = (violation as { quotaId?: unknown }).quotaId
      if (typeof quotaId === "string" && /^[a-z0-9_-]{1,160}$/iu.test(quotaId)) quotaIds.push(quotaId)
    }
  }
  return {
    ...(typeof retryDelayMs === "number" ? { retryDelayMs } : {}),
    quotaIds: [...new Set(quotaIds)],
  }
}

function isPerModelDailyQuota(error: GeminiHttpStatusError): boolean {
  return error.quotaIds.some((quotaId) => /PerDayPerProjectPerModel/iu.test(quotaId))
}

function globalFetch(input: string, init?: RequestInit): Promise<Response> {
  return fetch(input, init)
}

function readGeminiEnv(): Record<string, string | undefined> {
  const localEnv = readLocalEnvFile()
  const names = [
    "CHATBOT_TIER2_GEMINI_API_KEY",
    "GEMINI_API_KEY",
    "CHATBOT_TIER2_GEMINI_MODEL",
    "CHATBOT_TIER2_GEMINI_BASE_URL",
    "CHATBOT_TIER2_GEMINI_TIMEOUT_MS",
    "CHATBOT_TIER2_GEMINI_HEALTH_TIMEOUT_MS",
    "CHATBOT_TIER2_GEMINI_ENABLED",
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
  if (!value) return tier2GeminiFlashDefaults.enabled
  return !["false", "0", "off"].includes(value.trim().toLowerCase())
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function normalizeNonnegativeInteger(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : fallback
}

function trimTrailingSlash(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed) return undefined
  return trimmed.replace(/\/+$/, "")
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs))
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
