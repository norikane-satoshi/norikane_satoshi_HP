import { readFileSync } from "node:fs"
import { join } from "node:path"

import type { ChatbotLlmClient, ChatbotLlmRequest, ChatbotLlmResponse } from "@/lib/chatbot/server/llm-client"
import { ChatbotLlmError } from "@/lib/chatbot/server/llm-client"

type Tier2HostedChromeNotionAiClientConfig = {
  workerUrl?: string
  token?: string
  requestTimeoutMs: number
  healthCheckTimeoutMs: number
  totalGenerateBudgetMs: number
  enabled: boolean
}

type Tier2HostedChromeNotionAiClientOptions = Partial<Tier2HostedChromeNotionAiClientConfig> & {
  httpClient?: Tier2HostedWorkerHttpClient
}

type Tier2HostedWorkerHttpClient = (input: string, init?: RequestInit) => Promise<Response>

type TimeoutTag = "timeout"
type RetryFailureReason = "timeout" | "server-error" | "connection" | "rate-limit" | "auth" | "unknown"
type HostedWorkerErrorSummary = {
  endpoint: string
  httpStatus: number
  errorCode?: string
  retryable?: boolean
  messagePreview?: string
}

type HostedWorkerHealthResponse = {
  ok?: unknown
}

type HostedWorkerGenerateResponse = {
  rawText?: unknown
  tokensUsed?: unknown
  latencyMs?: unknown
}

type GenerateAttemptDiagnostic = {
  attempt: number
  outcome: "success" | "error"
  durationMs: number
  timeoutMs: number
  reason?: RetryFailureReason
  httpStatus?: number
  errorCode?: string
  retryable?: boolean
}

type GenerateRetryDiagnostics = {
  attemptCount: number
  maxAttempts: number
  repairAttempted: boolean
  retryReasons: RetryFailureReason[]
  totalDurationMs: number
  totalBudgetMs: number
  perAttemptTimeoutMs: number
  exhausted?: boolean
  fallbackReason?: RetryFailureReason | "budget-exhausted"
  attempts: GenerateAttemptDiagnostic[]
}

type HostedWorkerGenerateResponseWithDiagnostics = HostedWorkerGenerateResponse & {
  retryDiagnostics: GenerateRetryDiagnostics
}

class HostedWorkerHttpStatusError extends Error {
  constructor(
    readonly status: number,
    readonly summary: HostedWorkerErrorSummary,
  ) {
    super("Hosted Notion AI worker HTTP request failed.")
    this.name = "HostedWorkerHttpStatusError"
  }
}

export const tier2HostedChromeNotionAiDefaults = {
  requestTimeoutMs: 55000,
  healthCheckTimeoutMs: 3000,
  totalGenerateBudgetMs: 65000,
  enabled: true,
} as const

const tier = "tier-2-hosted-chrome-notion-ai" as const
const timeoutTag: TimeoutTag = "timeout"
const healthEndpointPath = "/health"
const generateEndpointPath = "/generate"
const ensureChromeEndpointPath = "/ensure-chrome"
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
const maxGenerateAttempts = 3
const minRetryAttemptBudgetMs = 5000

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
      totalGenerateBudgetMs:
        options.totalGenerateBudgetMs ?? tier2HostedChromeNotionAiDefaults.totalGenerateBudgetMs,
      enabled: options.enabled ?? tier2HostedChromeNotionAiDefaults.enabled,
    }
    this.httpClient = options.httpClient ?? globalFetch
  }

  async generate(request: ChatbotLlmRequest): Promise<ChatbotLlmResponse> {
    const startedAt = Date.now()

    try {
      this.assertConfigured()
      const response = await this.generateWithRepair(request)
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
          repairAttempted: response.retryDiagnostics.repairAttempted,
          attemptCount: response.retryDiagnostics.attemptCount,
          maxAttempts: response.retryDiagnostics.maxAttempts,
          retryReasons: response.retryDiagnostics.retryReasons,
          totalGenerateDurationMs: response.retryDiagnostics.totalDurationMs,
          totalGenerateBudgetMs: response.retryDiagnostics.totalBudgetMs,
          perAttemptTimeoutMs: response.retryDiagnostics.perAttemptTimeoutMs,
          attempts: response.retryDiagnostics.attempts,
        },
      }
    } catch (error) {
      throw this.mapGenerateError(error)
    }
  }

  private async generateWithRepair(request: ChatbotLlmRequest): Promise<HostedWorkerGenerateResponseWithDiagnostics> {
    const startedAt = Date.now()
    const init = {
      method: httpMethodPost,
      headers: this.headers({ contentType: true }),
      body: JSON.stringify(request),
    }
    const retryDiagnostics: GenerateRetryDiagnostics = {
      attemptCount: 0,
      maxAttempts: maxGenerateAttempts,
      repairAttempted: false,
      retryReasons: [],
      totalDurationMs: 0,
      totalBudgetMs: this.config.totalGenerateBudgetMs,
      perAttemptTimeoutMs: this.config.requestTimeoutMs,
      attempts: [],
    }

    await this.tryEnsureChrome(startedAt)

    for (let attempt = 1; attempt <= maxGenerateAttempts; attempt += 1) {
      const remainingBudgetMs = remainingGenerateBudgetMs(startedAt, this.config.totalGenerateBudgetMs)
      if (remainingBudgetMs <= 0) {
        throw this.toBudgetExhaustedError(finalizeRetryDiagnostics(retryDiagnostics, startedAt, "budget-exhausted"))
      }

      const attemptStartedAt = Date.now()
      const attemptTimeoutMs = Math.min(this.config.requestTimeoutMs, remainingBudgetMs)
      retryDiagnostics.attemptCount = attempt

      try {
        const response = await this.requestJson<HostedWorkerGenerateResponse>(
          generateEndpointPath,
          init,
          attemptTimeoutMs,
        )
        retryDiagnostics.attempts.push({
          attempt,
          outcome: "success",
          durationMs: Date.now() - attemptStartedAt,
          timeoutMs: attemptTimeoutMs,
        })
        return {
          ...response,
          retryDiagnostics: finalizeRetryDiagnostics(retryDiagnostics, startedAt),
        }
      } catch (error) {
        const failure = summarizeGenerateFailure(error)
        retryDiagnostics.attempts.push({
          attempt,
          outcome: "error",
          durationMs: Date.now() - attemptStartedAt,
          timeoutMs: attemptTimeoutMs,
          reason: failure.reason,
          ...(failure.httpStatus ? { httpStatus: failure.httpStatus } : {}),
          ...(failure.errorCode ? { errorCode: failure.errorCode } : {}),
          retryable: failure.retryable,
        })

        if (!canRetryGenerate({ attempt, failure, startedAt, config: this.config })) {
          throw this.toGenerateFailureError(
            error,
            finalizeRetryDiagnostics(retryDiagnostics, startedAt, failure.reason, true),
          )
        }

        retryDiagnostics.retryReasons.push(failure.reason)
        retryDiagnostics.repairAttempted = true
        await this.tryEnsureChrome(startedAt)
      }
    }

    throw this.toBudgetExhaustedError(finalizeRetryDiagnostics(retryDiagnostics, startedAt, "budget-exhausted", true))
  }

  private async tryEnsureChrome(generateStartedAt?: number): Promise<void> {
    try {
      const timeoutMs = generateStartedAt
        ? Math.min(this.config.healthCheckTimeoutMs, remainingGenerateBudgetMs(generateStartedAt, this.config.totalGenerateBudgetMs))
        : this.config.healthCheckTimeoutMs
      if (timeoutMs <= 0) return

      await this.requestJson<unknown>(
        ensureChromeEndpointPath,
        {
          method: httpMethodPost,
          headers: this.headers(),
        },
        timeoutMs,
      )
    } catch {
      // The original generate error is more useful than a failed repair probe.
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

  private async requestJson<T>(path: string, init: RequestInit, timeoutMs: number): Promise<T> {
    const response = await this.request(path, init, timeoutMs)

    if (!response.ok) {
      throw new HostedWorkerHttpStatusError(response.status, await readWorkerErrorSummary(response, path))
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

  private toGenerateFailureError(error: unknown, diagnostics: GenerateRetryDiagnostics): ChatbotLlmError {
    const mapped = this.mapGenerateError(error)
    return new ChatbotLlmError({
      message: mapped.message,
      code: mapped.code,
      tier: mapped.tier,
      isRetryable: mapped.isRetryable,
      cause: mergeCauseWithRetryDiagnostics(mapped.cause, diagnostics),
    })
  }

  private toBudgetExhaustedError(diagnostics: GenerateRetryDiagnostics): ChatbotLlmError {
    return this.toLlmError({
      message: "Hosted Notion AI worker retry budget was exhausted.",
      code: "timeout",
      isRetryable: true,
      cause: { retryDiagnostics: diagnostics },
    })
  }

  private mapHttpStatusError(error: unknown, input: { fallbackMessage: string }): ChatbotLlmError {
    if (error instanceof HostedWorkerHttpStatusError) {
      if (error.status === httpStatusUnauthorized || error.status === httpStatusForbidden) {
        return this.toLlmError({
          message: "Hosted Notion AI worker authentication failed.",
          code: "auth",
          isRetryable: false,
          cause: error.summary,
        })
      }

      if (error.status === httpStatusTooManyRequests) {
        return this.toLlmError({
          message: "Hosted Notion AI worker was rate limited.",
          code: "rate-limit",
          isRetryable: true,
          cause: error.summary,
        })
      }

      if (error.status >= firstServerErrorStatus) {
        return this.toLlmError({
          message: "Hosted Notion AI worker returned a server error.",
          code: "connection",
          isRetryable: true,
          cause: error.summary,
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

function canRetryGenerate(input: {
  attempt: number
  failure: ReturnType<typeof summarizeGenerateFailure>
  startedAt: number
  config: Tier2HostedChromeNotionAiClientConfig
}): boolean {
  if (input.attempt >= maxGenerateAttempts || !input.failure.retryable) return false

  const remainingAfterRepair =
    remainingGenerateBudgetMs(input.startedAt, input.config.totalGenerateBudgetMs) - input.config.healthCheckTimeoutMs
  if (remainingAfterRepair <= 0) return false

  if (input.failure.reason === "timeout") return remainingAfterRepair >= minRetryAttemptBudgetMs
  return true
}

function summarizeGenerateFailure(error: unknown): {
  reason: RetryFailureReason
  retryable: boolean
  httpStatus?: number
  errorCode?: string
} {
  if (error === timeoutTag) return { reason: "timeout", retryable: true }

  if (error instanceof HostedWorkerHttpStatusError) {
    if (error.status === httpStatusUnauthorized || error.status === httpStatusForbidden) {
      return { reason: "auth", retryable: false, httpStatus: error.status, errorCode: error.summary.errorCode }
    }
    if (error.status === httpStatusTooManyRequests) {
      return { reason: "rate-limit", retryable: true, httpStatus: error.status, errorCode: error.summary.errorCode }
    }
    if (error.status >= firstServerErrorStatus) {
      return { reason: "server-error", retryable: true, httpStatus: error.status, errorCode: error.summary.errorCode }
    }
    return { reason: "unknown", retryable: false, httpStatus: error.status, errorCode: error.summary.errorCode }
  }

  if (error instanceof ChatbotLlmError) {
    if (error.code === "timeout") return { reason: "timeout", retryable: error.isRetryable, errorCode: error.code }
    if (error.code === "connection") return { reason: "connection", retryable: error.isRetryable, errorCode: error.code }
    if (error.code === "rate-limit") return { reason: "rate-limit", retryable: error.isRetryable, errorCode: error.code }
    if (error.code === "auth") return { reason: "auth", retryable: false, errorCode: error.code }
    return { reason: "unknown", retryable: error.isRetryable, errorCode: error.code }
  }

  return { reason: "unknown", retryable: false }
}

function finalizeRetryDiagnostics(
  diagnostics: GenerateRetryDiagnostics,
  startedAt: number,
  fallbackReason?: GenerateRetryDiagnostics["fallbackReason"],
  exhausted?: boolean,
): GenerateRetryDiagnostics {
  return {
    ...diagnostics,
    totalDurationMs: Date.now() - startedAt,
    ...(fallbackReason ? { fallbackReason } : {}),
    ...(exhausted ? { exhausted } : {}),
  }
}

function mergeCauseWithRetryDiagnostics(cause: unknown, diagnostics: GenerateRetryDiagnostics): Record<string, unknown> {
  if (isRecord(cause)) return { ...cause, retryDiagnostics: diagnostics }
  if (cause === undefined) return { retryDiagnostics: diagnostics }
  return { originalCause: sanitizeLogText(String(cause)), retryDiagnostics: diagnostics }
}

function remainingGenerateBudgetMs(startedAt: number, totalBudgetMs: number): number {
  return Math.max(0, totalBudgetMs - (Date.now() - startedAt))
}

export function createTier2HostedChromeNotionAiClient(
  overrides: Partial<Tier2HostedChromeNotionAiClientConfig> & {
    httpClient?: Tier2HostedWorkerHttpClient
  } = {},
): Tier2HostedChromeNotionAiClient {
  const env = readHostedNotionAiEnv()

  return new Tier2HostedChromeNotionAiClient({
    workerUrl: env.CHATBOT_HOSTED_NOTION_AI_WORKER_URL,
    token: env.CHATBOT_HOSTED_NOTION_AI_WORKER_TOKEN,
    requestTimeoutMs: parsePositiveInteger(
      env.CHATBOT_HOSTED_NOTION_AI_TIMEOUT_MS,
      tier2HostedChromeNotionAiDefaults.requestTimeoutMs,
    ),
    healthCheckTimeoutMs: parsePositiveInteger(
      env.CHATBOT_HOSTED_NOTION_AI_HEALTH_TIMEOUT_MS,
      tier2HostedChromeNotionAiDefaults.healthCheckTimeoutMs,
    ),
    totalGenerateBudgetMs: parsePositiveInteger(
      env.CHATBOT_HOSTED_NOTION_AI_TOTAL_BUDGET_MS,
      tier2HostedChromeNotionAiDefaults.totalGenerateBudgetMs,
    ),
    enabled: parseEnabled(env.CHATBOT_HOSTED_NOTION_AI_ENABLED),
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

function readHostedNotionAiEnv(): Record<string, string | undefined> {
  const localEnv = readLocalEnvFile()

  return {
    CHATBOT_HOSTED_NOTION_AI_WORKER_URL:
      process.env.CHATBOT_HOSTED_NOTION_AI_WORKER_URL ?? localEnv.CHATBOT_HOSTED_NOTION_AI_WORKER_URL,
    CHATBOT_HOSTED_NOTION_AI_WORKER_TOKEN:
      process.env.CHATBOT_HOSTED_NOTION_AI_WORKER_TOKEN ?? localEnv.CHATBOT_HOSTED_NOTION_AI_WORKER_TOKEN,
    CHATBOT_HOSTED_NOTION_AI_TIMEOUT_MS:
      process.env.CHATBOT_HOSTED_NOTION_AI_TIMEOUT_MS ?? localEnv.CHATBOT_HOSTED_NOTION_AI_TIMEOUT_MS,
    CHATBOT_HOSTED_NOTION_AI_HEALTH_TIMEOUT_MS:
      process.env.CHATBOT_HOSTED_NOTION_AI_HEALTH_TIMEOUT_MS ??
      localEnv.CHATBOT_HOSTED_NOTION_AI_HEALTH_TIMEOUT_MS,
    CHATBOT_HOSTED_NOTION_AI_TOTAL_BUDGET_MS:
      process.env.CHATBOT_HOSTED_NOTION_AI_TOTAL_BUDGET_MS ?? localEnv.CHATBOT_HOSTED_NOTION_AI_TOTAL_BUDGET_MS,
    CHATBOT_HOSTED_NOTION_AI_ENABLED:
      process.env.CHATBOT_HOSTED_NOTION_AI_ENABLED ?? localEnv.CHATBOT_HOSTED_NOTION_AI_ENABLED,
  }
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

function trimTrailingSlash(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed) return undefined

  return trimmed.replace(/\/+$/, "")
}

function getHostedWorkerRawText(response: HostedWorkerGenerateResponse): string {
  return typeof response.rawText === "string" ? response.rawText : emptyText
}

async function readWorkerErrorSummary(response: Response, endpoint: string): Promise<HostedWorkerErrorSummary> {
  const body = await response.json().catch(() => undefined)
  const error = isRecord(body) && isRecord(body.error) ? body.error : undefined
  return {
    endpoint,
    httpStatus: response.status,
    errorCode: typeof error?.code === "string" ? sanitizeLogText(error.code) : undefined,
    retryable: typeof error?.retryable === "boolean" ? error.retryable : undefined,
    messagePreview: typeof error?.message === "string" ? sanitizeLogText(error.message) : undefined,
  }
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function sanitizeLogText(value: string): string {
  const sanitized = value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/xox[baprs]-[A-Za-z0-9-]+/gi, "[redacted-slack-token]")
    .replace(/https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+/gi, "[redacted-slack-webhook]")
    .replace(/"systemPrompt"\s*:\s*"[^"]*"/gi, '"systemPrompt":"[redacted]"')
    .replace(/"latestUserMessage"\s*:\s*"[^"]*"/gi, '"latestUserMessage":"[redacted]"')
  return sanitized.length <= 500 ? sanitized : `${sanitized.slice(0, 500)}...[truncated]`
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
