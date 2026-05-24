import { describe, expect, it, vi } from "vitest"

import type { ConversationState, JobContext } from "@/lib/chatbot/domain"
import type { ChatbotLlmRequest } from "@/lib/chatbot/server/llm-client"
import {
  createTier4FormFallbackClient,
  Tier4FormFallbackClient,
  tier4FormFallbackDefaults,
} from "@/lib/chatbot/server/llm-clients/tier4-form-fallback"

function conversationState(overrides: Partial<ConversationState> = {}): ConversationState {
  return {
    hasFinalMedium: true,
    hasJobKind: true,
    hasAdditionalWork: true,
    hasDocumentaryAttachments: true,
    hasWorkSite: true,
    hasReferenceUrls: true,
    hasContactEmail: true,
    hasDesiredSchedule: true,
    turnCount: 3,
    contactEmail: "client@example.com",
    ...overrides,
  }
}

function jobContext(overrides: Partial<JobContext> = {}): JobContext {
  return {
    jobKind: "cm-30s",
    finalMedium: "web",
    workSite: "remote-grading",
    documentaryAttachment: { kind: "none" },
    ...overrides,
  }
}

function llmRequest(overrides: Partial<ChatbotLlmRequest> = {}): ChatbotLlmRequest {
  return {
    systemPrompt: "Collect only new project intake details.",
    messages: [{ role: "user", content: "来月のWeb CM案件です" }],
    latestUserMessage: "立ち会い候補を相談したいです",
    conversationState: conversationState(),
    jobContext: jobContext(),
    ...overrides,
  }
}

describe("Tier4FormFallbackClient", () => {
  it("keeps the tier property fixed to tier 4 form fallback", () => {
    const client = createTier4FormFallbackClient()

    expect(client.tier).toBe("tier-4-form-fallback")
  })

  it("is always healthy because it has no external dependency", async () => {
    const client = createTier4FormFallbackClient()

    await expect(client.isHealthy()).resolves.toBe(true)
  })

  it("returns the default fallback text and deterministic routing decision", async () => {
    const client = createTier4FormFallbackClient()

    await expect(client.generate(llmRequest())).resolves.toMatchObject({
      rawText: tier4FormFallbackDefaults.responseText,
      tier: "tier-4-form-fallback",
      proposedRoutingDecision: {
        kind: "to-booking-inline",
        suggestedSlots: [],
        jobContext: jobContext(),
      },
    })
  })

  it("allows the fallback response text to be injected", async () => {
    const client = new Tier4FormFallbackClient({
      responseText: "フォームで続けます。",
    })

    await expect(client.generate(llmRequest())).resolves.toMatchObject({
      rawText: "フォームで続けます。",
    })
  })

  it("uses the fallback router for direct-contact decisions", async () => {
    const client = createTier4FormFallbackClient()

    await expect(
      client.generate(
        llmRequest({
          conversationState: conversationState({ technicalQuestion: true }),
        }),
      ),
    ).resolves.toMatchObject({
      proposedRoutingDecision: {
        kind: "to-direct-contact",
        reason: "tech-question",
        requireEmail: true,
      },
    })
  })

  it("does not call fetch or any network transport", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    const client = createTier4FormFallbackClient()

    await client.generate(llmRequest())
    await client.isHealthy()

    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })
})
