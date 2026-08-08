import {
  ChatbotLlmError,
  assertChatbotLlmResponseContract,
  chatbotLlmTierIds,
  defaultLlmTierOrder,
  getChatbotLlmOutputContractRejection,
  type ChatbotLlmClient,
  type ChatbotLlmRequest,
  type ChatbotLlmResponse,
  type ChatbotLlmTier,
} from "@/lib/chatbot/server/llm-client"

const llmOrchestratorDefaults = {
  healthCheckTimeoutMs: 3000,
} as const

export type TierAttemptEvent = {
  tier: ChatbotLlmTier
  phase: "health-check" | "generate"
  outcome: "healthy" | "unhealthy" | "success" | "error"
  error?: ChatbotLlmError | Error
  latencyMs: number
  diagnostics?: ChatbotLlmResponse["diagnostics"]
}

export interface ChatbotLlmTierOrchestrator {
  generate(request: ChatbotLlmRequest): Promise<ChatbotLlmResponse>
  isHealthy(): Promise<boolean>
}

type ChatbotLlmTierOrchestratorOptions = {
  clients: ReadonlyArray<ChatbotLlmClient>
  tierOrder?: ReadonlyArray<ChatbotLlmTier>
  healthCheckTimeoutMs?: number
  onTierAttempt?: (event: TierAttemptEvent) => void
}

type HealthCheckResult = {
  healthy: boolean
  error?: ChatbotLlmError | Error
}

type TierFallbackDiagnostic = {
  tier: ChatbotLlmTier
  phase: "health-check" | "generate"
  errorCode: string
  lifecycleFailureCode?: string
  lifecycleStage?: string
  visibilityStatus?: string
  hideVerificationResult?: string
}

export function createChatbotLlmTierOrchestrator(
  options: ChatbotLlmTierOrchestratorOptions,
): ChatbotLlmTierOrchestrator {
  const tierOrder = options.tierOrder ?? defaultLlmTierOrder
  const healthCheckTimeoutMs =
    options.healthCheckTimeoutMs ?? llmOrchestratorDefaults.healthCheckTimeoutMs
  const clientsByTier = new Map(options.clients.map((client) => [client.tier, client]))

  async function checkClientHealth(client: ChatbotLlmClient): Promise<HealthCheckResult> {
    const startedAt = Date.now()

    try {
      const healthy = await withTimeout(client.isHealthy(), healthCheckTimeoutMs)
      const error = healthy ? undefined : client.getLastHealthError?.()
      emitAttempt(options.onTierAttempt, {
        tier: client.tier,
        phase: "health-check",
        outcome: healthy ? "healthy" : "unhealthy",
        ...(healthy ? {} : { error }),
        latencyMs: Date.now() - startedAt,
      })
      return { healthy, error }
    } catch (error) {
      const normalized = normalizeError(error, client.tier)
      emitAttempt(options.onTierAttempt, {
        tier: client.tier,
        phase: "health-check",
        outcome: "unhealthy",
        error: normalized,
        latencyMs: Date.now() - startedAt,
      })
      return { healthy: false, error: normalized }
    }
  }

  return {
    async generate(request: ChatbotLlmRequest): Promise<ChatbotLlmResponse> {
      let lastAttemptedTier: ChatbotLlmTier | undefined
      const tierFallbacks: TierFallbackDiagnostic[] = []

      for (const tier of tierOrder) {
        const client = clientsByTier.get(tier)
        if (!client) continue

        lastAttemptedTier = tier
        const health = await checkClientHealth(client)
        if (!health.healthy && !shouldAttemptGenerateAfterUnhealthyHealth(client, health.error)) {
          const fallback = summarizeTierFallback(client.tier, "health-check", health.error)
          if (fallback) tierFallbacks.push(fallback)
          continue
        }

        const startedAt = Date.now()

        try {
          const response = await client.generate(request)
          assertChatbotLlmResponseContract(response, tier)
          emitAttempt(options.onTierAttempt, {
            tier,
            phase: "generate",
            outcome: "success",
            latencyMs: Date.now() - startedAt,
            diagnostics: response.diagnostics,
          })
          return tierFallbacks.length > 0
            ? {
                ...response,
                diagnostics: {
                  ...(response.diagnostics ?? {}),
                  tierFallbacks,
                },
              }
            : response
        } catch (error) {
          const normalized = normalizeError(error, tier)
          const rejection = getChatbotLlmOutputContractRejection(normalized)
          emitAttempt(options.onTierAttempt, {
            tier,
            phase: "generate",
            outcome: "error",
            error: normalized,
            latencyMs: Date.now() - startedAt,
          })
          if (rejection?.decision === "reject-and-regenerate-structured-ui") throw normalized
          const fallback = summarizeTierFallback(tier, "generate", normalized)
          if (fallback) tierFallbacks.push(fallback)
        }
      }

      throw new ChatbotLlmError({
        message: "No chatbot LLM tier completed successfully.",
        code: "unknown",
        tier: lastAttemptedTier ?? getLastTier(tierOrder),
        isRetryable: false,
      })
    },

    async isHealthy(): Promise<boolean> {
      for (const tier of tierOrder) {
        const client = clientsByTier.get(tier)
        if (!client) continue
        if ((await checkClientHealth(client)).healthy) return true
      }

      return false
    },
  }
}

function summarizeTierFallback(
  tier: ChatbotLlmTier,
  phase: TierFallbackDiagnostic["phase"],
  error: ChatbotLlmError | Error | undefined,
): TierFallbackDiagnostic | undefined {
  const cause = error instanceof ChatbotLlmError && isRecord(error.cause) ? error.cause : undefined
  const lifecycleFailureCode = safeDiagnosticCode(cause?.lifecycleFailureCode)
  const lifecycleStage = safeDiagnosticCode(cause?.lifecycleStage)
  const visibilityStatus = safeDiagnosticCode(cause?.visibilityStatus)
  const hideVerificationResult = safeDiagnosticCode(cause?.hideVerificationResult)
  if (!lifecycleFailureCode) return undefined
  return {
    tier,
    phase,
    errorCode: error instanceof ChatbotLlmError ? error.code : "unknown",
    ...(lifecycleFailureCode ? { lifecycleFailureCode } : {}),
    ...(lifecycleStage ? { lifecycleStage } : {}),
    ...(visibilityStatus ? { visibilityStatus } : {}),
    ...(hideVerificationResult ? { hideVerificationResult } : {}),
  }
}

function safeDiagnosticCode(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-z0-9][a-z0-9_.:-]{0,119}$/i.test(value)
    ? value
    : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function shouldAttemptGenerateAfterUnhealthyHealth(
  client: ChatbotLlmClient,
  error: ChatbotLlmError | Error | undefined,
): boolean {
  if (client.tier !== chatbotLlmTierIds.tier1HostedChromeNotionAi) return false
  if (!error) return false

  if (error instanceof ChatbotLlmError) {
    return error.isRetryable && (error.code === "timeout" || error.code === "connection")
  }

  return /health check timed out/i.test(error.message)
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error("Chatbot LLM tier health check timed out.")), timeoutMs)
  })

  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

function emitAttempt(onTierAttempt: ChatbotLlmTierOrchestratorOptions["onTierAttempt"], event: TierAttemptEvent) {
  try {
    onTierAttempt?.(event)
  } catch {
    // Observability hooks must never block fallback.
  }
}

function normalizeError(error: unknown, tier: ChatbotLlmTier): ChatbotLlmError | Error {
  if (error instanceof ChatbotLlmError || error instanceof Error) return error

  return new ChatbotLlmError({
    message: "Chatbot LLM tier failed with an unknown error.",
    code: "unknown",
    tier,
    isRetryable: false,
    cause: error,
  })
}

function getLastTier(tierOrder: ReadonlyArray<ChatbotLlmTier>): ChatbotLlmTier {
  for (const tier of [...tierOrder].reverse()) return tier

  return chatbotLlmTierIds.tier3FormFallback
}
