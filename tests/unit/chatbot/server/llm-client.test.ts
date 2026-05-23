import { describe, expect, it } from "vitest"

import { ChatbotLlmError, defaultLlmTierOrder } from "@/lib/chatbot/server/llm-client"
import type { ChatbotLlmTier } from "@/lib/chatbot/server/llm-client"

const expectedDefaultLlmTierOrder = [
  "tier-1-chrome-claude",
  "tier-2-ollama-deepseek",
  "tier-3-gemini-flash-lite",
  "tier-4-form-fallback",
] as const satisfies ReadonlyArray<ChatbotLlmTier>

describe("chatbot LLM client interface", () => {
  it("keeps ChatbotLlmError fields and Error inheritance", () => {
    const cause = new Error("upstream refused the request")
    const error = new ChatbotLlmError({
      message: "Claude browser tier timed out",
      code: "timeout",
      tier: "tier-1-chrome-claude",
      isRetryable: true,
      cause,
    })

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe("ChatbotLlmError")
    expect(error.message).toBe("Claude browser tier timed out")
    expect(error.code).toBe("timeout")
    expect(error.tier).toBe("tier-1-chrome-claude")
    expect(error.isRetryable).toBe(true)
    expect(error.cause).toBe(cause)
  })

  it("supports instanceof checks for the concrete error class", () => {
    const error = new ChatbotLlmError({
      message: "Gemini returned invalid JSON",
      code: "invalid-output",
      tier: "tier-3-gemini-flash-lite",
      isRetryable: false,
    })

    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(ChatbotLlmError)
  })

  it("keeps the default tier order fixed and readonly-typed", () => {
    const readonlyOrder: ReadonlyArray<ChatbotLlmTier> = defaultLlmTierOrder

    expect(readonlyOrder.length).toBe(expectedDefaultLlmTierOrder.length)
    expect(readonlyOrder).toEqual(expectedDefaultLlmTierOrder)
  })

  it("keeps the form fallback included as the final tier", () => {
    const [lastTier] = [...defaultLlmTierOrder].reverse()

    expect(defaultLlmTierOrder.includes("tier-4-form-fallback")).toBe(true)
    expect(lastTier).toBe("tier-4-form-fallback")
  })
})
