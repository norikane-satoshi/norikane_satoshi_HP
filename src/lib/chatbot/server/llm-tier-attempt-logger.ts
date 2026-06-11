import type { TierAttemptEvent } from "@/lib/chatbot/server/llm-orchestrator"

export type ChatbotTierAttemptLogEvent = {
  event: "chatbot_llm_tier_attempt"
  tier: TierAttemptEvent["tier"]
  phase: TierAttemptEvent["phase"]
  outcome: TierAttemptEvent["outcome"]
  latencyMs: number
  attempt?: number
  diagnostics?: Record<string, unknown>
  error?: {
    name: string
    code?: string
    message: string
  }
}

export function formatChatbotTierAttemptLogEvent(event: TierAttemptEvent): ChatbotTierAttemptLogEvent {
  return {
    event: "chatbot_llm_tier_attempt",
    tier: event.tier,
    phase: event.phase,
    outcome: event.outcome,
    latencyMs: event.latencyMs,
    ...(event.attempt ? { attempt: event.attempt } : {}),
    ...(event.diagnostics ? { diagnostics: pickLogSafeDiagnostics(event.diagnostics) } : {}),
    error: event.error
      ? {
          name: event.error.name,
          code: "code" in event.error ? String(event.error.code) : undefined,
          message: event.error.message,
        }
      : undefined,
  }
}

function pickLogSafeDiagnostics(diagnostics: Record<string, unknown>): Record<string, unknown> {
  const keys = [
    "postDataBytes",
    "responseBytes",
    "chunkCount",
    "notionAiThreadId",
    "notionAiThreadCreated",
    "notionAiThreadPartialTranscript",
    "notionAiThreadMode",
    "notionAiThreadFallbackReason",
    "attachTargetUrlMatches",
  ] as const
  const picked: Record<string, unknown> = {}

  for (const key of keys) {
    if (key in diagnostics) picked[key] = diagnostics[key]
  }

  return picked
}

export function createLocalChatbotTierAttemptLogger(): ((event: TierAttemptEvent) => void) | undefined {
  if (!shouldLogChatbotTierAttempts()) return undefined

  return (event) => {
    console.info(JSON.stringify(formatChatbotTierAttemptLogEvent(event)))
  }
}

function shouldLogChatbotTierAttempts(): boolean {
  if (process.env.CHATBOT_TIER_ATTEMPT_LOGS === "0") return false
  if (process.env.CHATBOT_TIER_ATTEMPT_LOGS === "1") return true
  if (process.env.NODE_ENV === "test") return false

  return process.env.VERCEL_ENV !== "production"
}
