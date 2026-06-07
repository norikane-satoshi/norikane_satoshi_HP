import { describe, expect, it } from "vitest"

import { ChatbotLlmError } from "@/lib/chatbot/server/llm-client"
import { formatChatbotTierAttemptLogEvent } from "@/lib/chatbot/server/llm-tier-attempt-logger"

describe("formatChatbotTierAttemptLogEvent", () => {
  it("keeps tier attempt diagnostics machine-readable without leaking stack traces", () => {
    const error = new ChatbotLlmError({
      message: "No Notion AI page target was found on the configured Chrome CDP port.",
      code: "connection",
      tier: "tier-1-chrome-notion-ai",
      isRetryable: true,
    })

    expect(
      formatChatbotTierAttemptLogEvent({
        tier: "tier-1-chrome-notion-ai",
        phase: "health-check",
        outcome: "unhealthy",
        error,
        latencyMs: 12,
      }),
    ).toEqual({
      event: "chatbot_llm_tier_attempt",
      tier: "tier-1-chrome-notion-ai",
      phase: "health-check",
      outcome: "unhealthy",
      latencyMs: 12,
      error: {
        name: "ChatbotLlmError",
        code: "connection",
        message: "No Notion AI page target was found on the configured Chrome CDP port.",
      },
    })
  })

  it("includes generate attempt numbers when retries are emitted", () => {
    expect(
      formatChatbotTierAttemptLogEvent({
        tier: "tier-3-ollama-deepseek",
        phase: "generate",
        outcome: "error",
        latencyMs: 90000,
        attempt: 2,
      }),
    ).toEqual({
      event: "chatbot_llm_tier_attempt",
      tier: "tier-3-ollama-deepseek",
      phase: "generate",
      outcome: "error",
      latencyMs: 90000,
      attempt: 2,
    })
  })
})
