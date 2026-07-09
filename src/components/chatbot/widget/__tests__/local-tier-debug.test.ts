import { describe, expect, it } from "vitest"

import { formatChatbotTierDebugLabel, isLocalChatbotTierDebugLocation } from "@/components/chatbot/widget/local-tier-debug"

describe("local chatbot tier debug helpers", () => {
  it("formats human labels with raw tier ids", () => {
    expect(formatChatbotTierDebugLabel("local-deterministic")).toBe(
      "Local deterministic -> model unknown (local-deterministic)",
    )
    expect(formatChatbotTierDebugLabel("tier-1-chrome-notion-ai", "Notion AI Sonnet 5")).toBe(
      "Tier 1 Notion AI -> Notion AI Sonnet 5 (tier-1-chrome-notion-ai)",
    )
    expect(formatChatbotTierDebugLabel("tier-2-hosted-chrome-notion-ai")).toBe(
      "Tier 2 Hosted Notion AI -> model unknown (tier-2-hosted-chrome-notion-ai)",
    )
    expect(formatChatbotTierDebugLabel("tier-3-gemini-flash")).toBe(
      "Tier 3 Gemini Flash -> model unknown (tier-3-gemini-flash)",
    )
    expect(formatChatbotTierDebugLabel("tier-3-ollama-deepseek")).toBe(
      "Tier 3 Ollama DeepSeek -> model unknown (tier-3-ollama-deepseek)",
    )
    expect(formatChatbotTierDebugLabel("tier-4-form-fallback")).toBe(
      "Tier 4 form fallback -> model unknown (tier-4-form-fallback)",
    )
  })

  it("only enables the debug display on the shared local 41238 surface", () => {
    expect(isLocalChatbotTierDebugLocation("localhost", "41238")).toBe(true)
    expect(isLocalChatbotTierDebugLocation("127.0.0.1", "41238")).toBe(true)
    expect(isLocalChatbotTierDebugLocation("localhost", "3000")).toBe(false)
    expect(isLocalChatbotTierDebugLocation("norikane.studio", "")).toBe(false)
    expect(isLocalChatbotTierDebugLocation("norikane-satoshi-hp.vercel.app", "")).toBe(false)
  })
})
