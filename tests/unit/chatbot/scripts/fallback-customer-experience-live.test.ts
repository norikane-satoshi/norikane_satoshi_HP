import { describe, expect, it, vi } from "vitest"

import type { ChatbotLlmClient, ChatbotLlmTier } from "@/lib/chatbot/server/llm-client"
import { createChatbotLlmResponse } from "@/lib/chatbot/server/llm-client"
import { createTier3FormFallbackClient } from "@/lib/chatbot/server/llm-clients/tier3-form-fallback"
import {
  fallbackLiveCanary,
  verifyFallbackCustomerExperience,
} from "../../../../scripts/chatbot/verify-fallback-customer-experience-live"

function healthyClient(tier: ChatbotLlmTier, rawText: string): ChatbotLlmClient {
  return {
    tier,
    isHealthy: vi.fn().mockResolvedValue(true),
    generate: vi.fn().mockResolvedValue(createChatbotLlmResponse({ tier, rawText })),
  }
}

describe("verifyFallbackCustomerExperience", () => {
  it("proves Tier 2 display output, Tier 3 form guidance, and actual inquiry acceptance", async () => {
    const tier2 = healthyClient(
      "tier-2-gemini-flash",
      `<customer_reply>${fallbackLiveCanary}\n{"tool":"show_choice_panel","args":{"id":"job-kind","question":"案件の種類を教えてください","choices":[{"id":"cm","label":"CM"},{"id":"other","label":"その他"}]}}</customer_reply>`,
    )
    const submitInquiry = vi.fn().mockResolvedValue({ ok: true, delivered: true })

    const report = await verifyFallbackCustomerExperience({
      tier2Client: tier2,
      tier3Client: createTier3FormFallbackClient(),
      submitInquiry,
    })

    expect(report).toEqual({
      ok: true,
      results: {
        tier2: {
          status: "pass",
          tier: "tier-2-gemini-flash",
          canaryMatched: true,
          customerDisplayContract: true,
          uiKind: "choice-panel",
        },
        tier3: {
          status: "pass",
          tier: "tier-3-form-fallback",
          customerTextMatched: true,
          expectedUiKind: "tier3-inquiry-form",
        },
        inquiry: {
          status: "pass",
          accepted: true,
          delivered: true,
        },
      },
    })
    expect(submitInquiry).toHaveBeenCalledOnce()
  })

  it("fails when the customer inquiry is accepted by HTTP but not delivered", async () => {
    const tier2 = healthyClient(
      "tier-2-gemini-flash",
      `<customer_reply>${fallbackLiveCanary}\n{"tool":"show_choice_panel","args":{"id":"job-kind","question":"案件の種類を教えてください","choices":[{"id":"cm","label":"CM"},{"id":"other","label":"その他"}]}}</customer_reply>`,
    )

    await expect(
      verifyFallbackCustomerExperience({
        tier2Client: tier2,
        tier3Client: createTier3FormFallbackClient(),
        submitInquiry: vi.fn().mockResolvedValue({ ok: true, delivered: false }),
      }),
    ).rejects.toThrow("inquiry_delivery_not_confirmed")
  })

  it("returns only safe booleans and tier labels, never response bodies or contact data", async () => {
    const tier2 = healthyClient(
      "tier-2-gemini-flash",
      `<customer_reply>${fallbackLiveCanary}\n{"tool":"show_choice_panel","args":{"id":"job-kind","question":"案件の種類を教えてください","choices":[{"id":"cm","label":"CM"},{"id":"other","label":"その他"}]}}</customer_reply>`,
    )

    const report = await verifyFallbackCustomerExperience({
      tier2Client: tier2,
      tier3Client: createTier3FormFallbackClient(),
      submitInquiry: vi.fn().mockResolvedValue({ ok: true, delivered: true }),
    })
    const serialized = JSON.stringify(report)

    expect(serialized).not.toContain("customer_reply")
    expect(serialized).not.toContain("@")
    expect(serialized).not.toContain("apiKey")
    expect(serialized).not.toContain("systemPrompt")
  })
})
