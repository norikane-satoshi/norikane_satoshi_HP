import { describe, expect, it, vi } from "vitest"

import type { ConversationState, JobContext } from "@/lib/chatbot/domain"
import {
  assertChatbotLlmResponseContract,
  ChatbotLlmError,
  type ChatbotLlmClient,
  type ChatbotLlmRequest,
  type ChatbotLlmResponse,
  type ChatbotLlmTier,
} from "@/lib/chatbot/server/llm-client"
import {
  createChatbotLlmTierOrchestrator,
  type TierAttemptEvent,
} from "@/lib/chatbot/server/llm-orchestrator"
import { createChatbotLlmDisplayEnvelope } from "@/lib/chatbot/server/llm-response-normalizer"

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

function llmResponse(
  tier: ChatbotLlmTier,
  rawText?: string,
  diagnostics?: ChatbotLlmResponse["diagnostics"],
): ChatbotLlmResponse {
  const resolvedRawText =
    rawText ??
    (tier === "tier-2-gemini-flash"
      ? '<customer_reply>案件を確認します。\n{"tool":"show_choice_panel","args":{"id":"job-kind","question":"案件の種類を教えてください","choices":[{"id":"cm","label":"CM"},{"id":"other","label":"その他"}]}}</customer_reply>'
      : `${tier} response`)
  return {
    rawText: resolvedRawText,
    displayEnvelope: createChatbotLlmDisplayEnvelope(resolvedRawText),
    tier,
    ...(diagnostics ? { diagnostics } : {}),
  }
}

function llmError(
  tier: ChatbotLlmTier,
  overrides: Partial<ConstructorParameters<typeof ChatbotLlmError>[0]> = {},
): ChatbotLlmError {
  return new ChatbotLlmError({
    message: "tier failed",
    code: "unknown",
    tier,
    isRetryable: true,
    ...overrides,
  })
}

function fakeClient(
  tier: ChatbotLlmTier,
  overrides: {
    healthy?: boolean
    healthPromise?: Promise<boolean>
    healthError?: Error
    generateResult?: ChatbotLlmResponse
    generateError?: Error
  } = {},
): ChatbotLlmClient {
  return {
    tier,
    isHealthy: vi.fn(async () => overrides.healthPromise ?? overrides.healthy ?? true),
    generate: vi.fn(async () => {
      if (overrides.generateError) throw overrides.generateError
      return overrides.generateResult ?? llmResponse(tier)
    }),
    getLastHealthError: vi.fn(() => overrides.healthError),
  } satisfies ChatbotLlmClient
}

describe("createChatbotLlmTierOrchestrator", () => {
  it("returns the new tier 1 hosted response when it succeeds", async () => {
    const tier1 = fakeClient("tier-1-hosted-chrome-notion-ai")
    const tier2 = fakeClient("tier-2-gemini-flash")
    const orchestrator = createChatbotLlmTierOrchestrator({ clients: [tier1, tier2] })

    await expect(orchestrator.generate(llmRequest())).resolves.toEqual(
      llmResponse("tier-1-hosted-chrome-notion-ai"),
    )
    expect(tier1.generate).toHaveBeenCalledOnce()
    expect(tier2.generate).not.toHaveBeenCalled()
  })

  it("tries the new tier 2 Gemini client when tier 1 is unhealthy", async () => {
    const tier1 = fakeClient("tier-1-hosted-chrome-notion-ai", { healthy: false })
    const tier2 = fakeClient("tier-2-gemini-flash")
    const orchestrator = createChatbotLlmTierOrchestrator({ clients: [tier1, tier2] })

    await expect(orchestrator.generate(llmRequest())).resolves.toEqual(llmResponse("tier-2-gemini-flash"))
    expect(tier1.generate).not.toHaveBeenCalled()
    expect(tier2.generate).toHaveBeenCalledOnce()
  })

  it("tries tier 2 after tier 1 generation fails", async () => {
    const tier1 = fakeClient("tier-1-hosted-chrome-notion-ai", {
      generateError: llmError("tier-1-hosted-chrome-notion-ai"),
    })
    const tier2 = fakeClient("tier-2-gemini-flash")
    const orchestrator = createChatbotLlmTierOrchestrator({ clients: [tier1, tier2] })

    await expect(orchestrator.generate(llmRequest())).resolves.toEqual(llmResponse("tier-2-gemini-flash"))
    expect(tier1.generate).toHaveBeenCalledOnce()
    expect(tier2.generate).toHaveBeenCalledOnce()
  })

  it("uses tier 3 form fallback when tiers 1 and 2 are unhealthy", async () => {
    const tier1 = fakeClient("tier-1-hosted-chrome-notion-ai", { healthy: false })
    const tier2 = fakeClient("tier-2-gemini-flash", { healthy: false })
    const tier3 = fakeClient("tier-3-form-fallback")
    const orchestrator = createChatbotLlmTierOrchestrator({ clients: [tier1, tier2, tier3] })

    await expect(orchestrator.generate(llmRequest())).resolves.toEqual(llmResponse("tier-3-form-fallback"))
    expect(tier3.generate).toHaveBeenCalledOnce()
  })

  it.each([
    ["missing display envelope", { rawText: "broken", tier: "tier-1-hosted-chrome-notion-ai" }],
    [
      "missing raw text",
      {
        displayEnvelope: createChatbotLlmDisplayEnvelope("broken"),
        tier: "tier-1-hosted-chrome-notion-ai",
      },
    ],
    [
      "malformed envelope",
      {
        rawText: "broken",
        displayEnvelope: { text: "broken", source: "unknown", defaultDenied: false, fallbackApplied: false, reasons: [] },
        tier: "tier-1-hosted-chrome-notion-ai",
      },
    ],
  ])("falls back when a tier returns contract-invalid output: %s", async (_label, invalidResponse) => {
    const tier1 = fakeClient("tier-1-hosted-chrome-notion-ai", {
      generateResult: invalidResponse as ChatbotLlmResponse,
    })
    const tier3 = fakeClient("tier-3-form-fallback", {
      generateResult: llmResponse("tier-3-form-fallback", "<customer_reply>フォームへ切り替えます。</customer_reply>"),
    })
    const orchestrator = createChatbotLlmTierOrchestrator({ clients: [tier1, tier3] })

    await expect(orchestrator.generate(llmRequest())).resolves.toMatchObject({
      tier: "tier-3-form-fallback",
      rawText: "<customer_reply>フォームへ切り替えます。</customer_reply>",
    })
  })

  it("accepts the new shared tier response envelope", () => {
    expect(() => assertChatbotLlmResponseContract(llmResponse("tier-1-hosted-chrome-notion-ai"))).not.toThrow()
  })

  it("throws with the last configured tier when no client succeeds", async () => {
    const tier1 = fakeClient("tier-1-hosted-chrome-notion-ai", { healthy: false })
    const tier2 = fakeClient("tier-2-gemini-flash", { healthy: false })
    const orchestrator = createChatbotLlmTierOrchestrator({ clients: [tier1, tier2] })

    await expect(orchestrator.generate(llmRequest())).rejects.toMatchObject({
      code: "unknown",
      tier: "tier-2-gemini-flash",
      isRetryable: false,
    })
  })

  it("honors a custom tier order", async () => {
    const tier1 = fakeClient("tier-1-hosted-chrome-notion-ai")
    const tier2 = fakeClient("tier-2-gemini-flash")
    const tier3 = fakeClient("tier-3-form-fallback")
    const orchestrator = createChatbotLlmTierOrchestrator({
      clients: [tier1, tier2, tier3],
      tierOrder: ["tier-2-gemini-flash", "tier-3-form-fallback"],
    })

    await expect(orchestrator.generate(llmRequest())).resolves.toEqual(llmResponse("tier-2-gemini-flash"))
    expect(tier1.isHealthy).not.toHaveBeenCalled()
    expect(tier3.isHealthy).not.toHaveBeenCalled()
  })

  it("emits health-check and generation events", async () => {
    const events: TierAttemptEvent[] = []
    const diagnostics = { endpoint: "/generate", attemptCount: 2 }
    const tier1 = fakeClient("tier-1-hosted-chrome-notion-ai", {
      generateResult: llmResponse("tier-1-hosted-chrome-notion-ai", "復旧しました", diagnostics),
    })
    const orchestrator = createChatbotLlmTierOrchestrator({
      clients: [tier1],
      onTierAttempt: (event) => events.push(event),
    })

    await orchestrator.generate(llmRequest())

    expect(events).toEqual([
      expect.objectContaining({ tier: "tier-1-hosted-chrome-notion-ai", phase: "health-check", outcome: "healthy" }),
      expect.objectContaining({
        tier: "tier-1-hosted-chrome-notion-ai",
        phase: "generate",
        outcome: "success",
        diagnostics,
      }),
    ])
  })

  it("emits a client health error without blocking fallback", async () => {
    const events: TierAttemptEvent[] = []
    const healthError = llmError("tier-1-hosted-chrome-notion-ai", {
      message: "Hosted Notion AI worker URL or token is not configured.",
      code: "auth",
      isRetryable: false,
    })
    const tier1 = fakeClient("tier-1-hosted-chrome-notion-ai", { healthy: false, healthError })
    const tier3 = fakeClient("tier-3-form-fallback")
    const orchestrator = createChatbotLlmTierOrchestrator({
      clients: [tier1, tier3],
      onTierAttempt: (event) => events.push(event),
    })

    await expect(orchestrator.generate(llmRequest())).resolves.toEqual(llmResponse("tier-3-form-fallback"))
    expect(events[0]).toMatchObject({ outcome: "unhealthy", error: healthError })
  })

  it("ignores observer errors", async () => {
    const tier1 = fakeClient("tier-1-hosted-chrome-notion-ai")
    const orchestrator = createChatbotLlmTierOrchestrator({
      clients: [tier1],
      onTierAttempt: () => {
        throw new Error("observer failed")
      },
    })

    await expect(orchestrator.generate(llmRequest())).resolves.toEqual(
      llmResponse("tier-1-hosted-chrome-notion-ai"),
    )
  })

  it("returns true when any ordered tier is healthy", async () => {
    const tier1 = fakeClient("tier-1-hosted-chrome-notion-ai", { healthy: false })
    const tier2 = fakeClient("tier-2-gemini-flash")
    const orchestrator = createChatbotLlmTierOrchestrator({ clients: [tier1, tier2] })

    await expect(orchestrator.isHealthy()).resolves.toBe(true)
  })

  it("returns false when every ordered tier is unhealthy", async () => {
    const tier1 = fakeClient("tier-1-hosted-chrome-notion-ai", { healthy: false })
    const tier2 = fakeClient("tier-2-gemini-flash", { healthy: false })
    const orchestrator = createChatbotLlmTierOrchestrator({ clients: [tier1, tier2] })

    await expect(orchestrator.isHealthy()).resolves.toBe(false)
  })

  it("still attempts hosted tier 1 when its health probe times out", async () => {
    const tier1 = fakeClient("tier-1-hosted-chrome-notion-ai", {
      healthPromise: new Promise<boolean>(() => undefined),
    })
    const tier2 = fakeClient("tier-2-gemini-flash")
    const orchestrator = createChatbotLlmTierOrchestrator({
      clients: [tier1, tier2],
      healthCheckTimeoutMs: 1,
    })

    await expect(orchestrator.generate(llmRequest())).resolves.toEqual(
      llmResponse("tier-1-hosted-chrome-notion-ai"),
    )
    expect(tier1.generate).toHaveBeenCalledOnce()
  })

  it("still attempts hosted tier 1 after a retryable connection health error", async () => {
    const healthError = llmError("tier-1-hosted-chrome-notion-ai", {
      code: "connection",
      isRetryable: true,
    })
    const tier1 = fakeClient("tier-1-hosted-chrome-notion-ai", { healthy: false, healthError })
    const tier2 = fakeClient("tier-2-gemini-flash")
    const orchestrator = createChatbotLlmTierOrchestrator({ clients: [tier1, tier2] })

    await expect(orchestrator.generate(llmRequest())).resolves.toEqual(
      llmResponse("tier-1-hosted-chrome-notion-ai"),
    )
    expect(tier1.generate).toHaveBeenCalledOnce()
  })

  it("skips a non-hosted tier when its health check times out", async () => {
    const tier2 = fakeClient("tier-2-gemini-flash", {
      healthPromise: new Promise<boolean>(() => undefined),
    })
    const tier3 = fakeClient("tier-3-form-fallback")
    const orchestrator = createChatbotLlmTierOrchestrator({
      clients: [tier2, tier3],
      healthCheckTimeoutMs: 1,
    })

    await expect(orchestrator.generate(llmRequest())).resolves.toEqual(llmResponse("tier-3-form-fallback"))
    expect(tier2.generate).not.toHaveBeenCalled()
  })

  it("does not call a network transport directly", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    const tier1 = fakeClient("tier-1-hosted-chrome-notion-ai")
    const orchestrator = createChatbotLlmTierOrchestrator({ clients: [tier1] })

    await orchestrator.generate(llmRequest())
    await orchestrator.isHealthy()

    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })
})
