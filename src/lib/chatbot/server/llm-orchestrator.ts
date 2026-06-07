import {
  ChatbotLlmError,
  defaultLlmTierOrder,
  type ChatbotLlmClient,
  type ChatbotLlmRequest,
  type ChatbotLlmResponse,
  type ChatbotLlmTier,
} from "@/lib/chatbot/server/llm-client"

const llmOrchestratorDefaults = {
  healthCheckTimeoutMs: 3000,
  retryBackoffMs: 500,
} as const

const aiGenerateAttemptLimits: Readonly<Record<ChatbotLlmTier, number>> = {
  "tier-1-chrome-notion-ai": 4,
  "tier-2-hosted-chrome-notion-ai": 2,
  "tier-3-ollama-deepseek": 2,
  "tier-4-form-fallback": 1,
} as const

export type TierAttemptEvent = {
  tier: ChatbotLlmTier
  phase: "health-check" | "generate"
  outcome: "healthy" | "unhealthy" | "success" | "error"
  error?: ChatbotLlmError | Error
  latencyMs: number
  attempt?: number
}

export interface ChatbotLlmTierOrchestrator {
  generate(request: ChatbotLlmRequest): Promise<ChatbotLlmResponse>
  isHealthy(): Promise<boolean>
}

type ChatbotLlmTierOrchestratorOptions = {
  clients: ReadonlyArray<ChatbotLlmClient>
  tierOrder?: ReadonlyArray<ChatbotLlmTier>
  healthCheckTimeoutMs?: number
  retryBackoffMs?: number
  onTierAttempt?: (event: TierAttemptEvent) => void
}

export function createChatbotLlmTierOrchestrator(
  options: ChatbotLlmTierOrchestratorOptions,
): ChatbotLlmTierOrchestrator {
  const tierOrder = options.tierOrder ?? defaultLlmTierOrder
  const healthCheckTimeoutMs =
    options.healthCheckTimeoutMs ?? llmOrchestratorDefaults.healthCheckTimeoutMs
  const retryBackoffMs = options.retryBackoffMs ?? llmOrchestratorDefaults.retryBackoffMs
  const clientsByTier = new Map(options.clients.map((client) => [client.tier, client]))

  async function checkClientHealth(client: ChatbotLlmClient): Promise<boolean> {
    const startedAt = Date.now()

    try {
      const healthy = await withTimeout(client.isHealthy(), healthCheckTimeoutMs)
      emitAttempt(options.onTierAttempt, {
        tier: client.tier,
        phase: "health-check",
        outcome: healthy ? "healthy" : "unhealthy",
        error: healthy ? undefined : client.getLastHealthError?.(),
        latencyMs: Date.now() - startedAt,
      })
      return healthy
    } catch (error) {
      emitAttempt(options.onTierAttempt, {
        tier: client.tier,
        phase: "health-check",
        outcome: "unhealthy",
        error: normalizeError(error, client.tier),
        latencyMs: Date.now() - startedAt,
      })
      return false
    }
  }

  return {
    async generate(request: ChatbotLlmRequest): Promise<ChatbotLlmResponse> {
      let lastAttemptedTier: ChatbotLlmTier | undefined

      for (const tier of tierOrder) {
        const client = clientsByTier.get(tier)
        if (!client) continue

        lastAttemptedTier = tier
        await checkClientHealth(client)

        const attemptLimit = aiGenerateAttemptLimits[tier] ?? 1
        for (let attempt = 1; attempt <= attemptLimit; attempt += 1) {
          const startedAt = Date.now()

          try {
            const response = await client.generate(request)
            emitAttempt(options.onTierAttempt, {
              tier,
              phase: "generate",
              outcome: "success",
              latencyMs: Date.now() - startedAt,
              attempt,
            })
            return response
          } catch (error) {
            const normalizedError = normalizeError(error, tier)
            emitAttempt(options.onTierAttempt, {
              tier,
              phase: "generate",
              outcome: "error",
              error: normalizedError,
              latencyMs: Date.now() - startedAt,
              attempt,
            })

            if (!shouldRetryGenerate(normalizedError, attempt, attemptLimit)) break
            await sleep(retryBackoffMs)
          }
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
        if (await checkClientHealth(client)) return true
      }

      return false
    },
  }
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

function shouldRetryGenerate(
  error: ChatbotLlmError | Error,
  attempt: number,
  attemptLimit: number,
): boolean {
  return attempt < attemptLimit && error instanceof ChatbotLlmError && error.isRetryable
}

async function sleep(delayMs: number): Promise<void> {
  if (delayMs <= 0) return
  await new Promise((resolve) => setTimeout(resolve, delayMs))
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

  return "tier-4-form-fallback"
}
