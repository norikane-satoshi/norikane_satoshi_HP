import { getChatbotBuildSha } from "@/lib/chatbot/server/build-info"
import type { ChatbotLlmTier } from "@/lib/chatbot/server/llm-client"

export function logChatbotBoundaryEvent(input: {
  event: string
  requestId?: string
  tier?: ChatbotLlmTier
  boundary: unknown
  decision?: unknown
  reason?: unknown
  fields?: Record<string, unknown>
}): void {
  if (process.env.NODE_ENV === "test") return

  console.info(
    JSON.stringify({
      event: input.event,
      requestId: input.requestId,
      buildSha: getChatbotBuildSha(),
      tier: input.tier,
      boundary: input.boundary,
      decision: input.decision,
      reason: input.reason,
      ...input.fields,
    }),
  )
}
