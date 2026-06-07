import { describe, expect, it } from "vitest"

import {
  formatChatbotTierDebugDetails,
  formatChatbotTierDebugLabel,
  isLocalChatbotTierDebugHostname,
} from "@/components/chatbot/widget/local-tier-debug"

describe("local chatbot tier debug helpers", () => {
  it("formats human labels with raw tier ids", () => {
    expect(formatChatbotTierDebugLabel("tier-1-chrome-notion-ai")).toBe(
      "Actual: Tier 1 local Notion AI / Chrome CDP (tier-1-chrome-notion-ai)",
    )
    expect(formatChatbotTierDebugLabel("tier-2-hosted-chrome-notion-ai")).toBe(
      "Actual: Tier 2 VPS Notion AI hosted worker (tier-2-hosted-chrome-notion-ai)",
    )
    expect(formatChatbotTierDebugLabel("tier-3-ollama-deepseek")).toBe(
      "Actual: Tier 3 local Ollama DeepSeek (tier-3-ollama-deepseek)",
    )
    expect(formatChatbotTierDebugLabel("tier-4-form-fallback")).toBe(
      "Actual: Tier 4 form fallback (tier-4-form-fallback)",
    )
  })

  it("formats tier 1 health and generate retry diagnostics", () => {
    expect(
      formatChatbotTierDebugDetails([
        {
          tier: "tier-1-chrome-notion-ai",
          phase: "health-check",
          outcome: "healthy",
          latencyMs: 20,
        },
        {
          tier: "tier-1-chrome-notion-ai",
          phase: "generate",
          outcome: "error",
          latencyMs: 231,
          attempt: 1,
          errorCode: "invalid-output",
        },
        {
          tier: "tier-1-chrome-notion-ai",
          phase: "generate",
          outcome: "error",
          latencyMs: 184,
          attempt: 2,
          errorCode: "invalid-output",
        },
        {
          tier: "tier-2-hosted-chrome-notion-ai",
          phase: "health-check",
          outcome: "unhealthy",
          latencyMs: 8,
          errorCode: "auth",
        },
        {
          tier: "tier-3-ollama-deepseek",
          phase: "generate",
          outcome: "success",
          latencyMs: 310,
          attempt: 1,
        },
      ]),
    ).toBe(
      "Tier1 health healthy; Tier1 generate invalid-output x2; Tier1 retry 1; Tier2 VPS health unhealthy; Tier3 Ollama generate success",
    )
  })

  it("only enables the debug display on local hostnames", () => {
    expect(isLocalChatbotTierDebugHostname("localhost")).toBe(true)
    expect(isLocalChatbotTierDebugHostname("127.0.0.1")).toBe(true)
    expect(isLocalChatbotTierDebugHostname("norikane.studio")).toBe(false)
    expect(isLocalChatbotTierDebugHostname("norikane-satoshi-hp.vercel.app")).toBe(false)
  })
})
