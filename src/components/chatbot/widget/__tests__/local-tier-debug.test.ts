import { describe, expect, it } from "vitest"

import { formatChatbotTierDebugLabel, isLocalChatbotTierDebugHostname } from "@/components/chatbot/widget/local-tier-debug"

describe("local chatbot tier debug helpers", () => {
  it("formats human labels with raw tier ids", () => {
    expect(formatChatbotTierDebugLabel("tier-1-chrome-notion-ai")).toBe(
      "Tier 1 Notion AI (tier-1-chrome-notion-ai)",
    )
    expect(formatChatbotTierDebugLabel("tier-2-ollama-deepseek")).toBe(
      "Tier 2 Ollama DeepSeek (tier-2-ollama-deepseek)",
    )
    expect(formatChatbotTierDebugLabel("tier-4-form-fallback")).toBe(
      "Tier 4 form fallback (tier-4-form-fallback)",
    )
  })

  it("only enables the debug display on local hostnames", () => {
    expect(isLocalChatbotTierDebugHostname("localhost")).toBe(true)
    expect(isLocalChatbotTierDebugHostname("127.0.0.1")).toBe(true)
    expect(isLocalChatbotTierDebugHostname("norikane.studio")).toBe(false)
    expect(isLocalChatbotTierDebugHostname("norikane-satoshi-hp.vercel.app")).toBe(false)
  })
})
