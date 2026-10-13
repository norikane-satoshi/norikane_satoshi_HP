import { z } from "zod"
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
  it("falls through model validation errors to Tier 3 without escaping as a server error", async () => {
    const result = z.object({ customer_reply: z.string() }).safeParse({ customer_reply: null })
    if (result.success) throw new Error("expected rejection")
    const attempts: TierAttemptEvent[] = []
    const tier2 = fakeClient("tier-2-gemini-flash", { generateError: result.error })
    const tier3 = fakeClient("tier-3-form-fallback")
    const orchestrator = createChatbotLlmTierOrchestrator({
      clients: [tier2, tier3], onTierAttempt: (attempt) => attempts.push(attempt),
    })
    await expect(orchestrator.generate(llmRequest())).resolves.toMatchObject({ tier: "tier-3-form-fallback" })
    expect(attempts.filter((attempt) => attempt.phase === "generate").map((attempt) => attempt.outcome))
      .toEqual(["error", "success"])
  })

  it("returns the Gemini response when it succeeds", async () => {
    const tier2 = fakeClient("tier-2-gemini-flash")
    const tier3 = fakeClient("tier-3-form-fallback")
    const orchestrator = createChatbotLlmTierOrchestrator({ clients: [tier2, tier3] })

    await expect(orchestrator.generate(llmRequest())).resolves.toEqual(llmResponse("tier-2-gemini-flash"))
    expect(tier2.generate).toHaveBeenCalledOnce()
    expect(tier3.generate).not.toHaveBeenCalled()
  })

  it("uses the form fallback when Gemini is unhealthy", async () => {
    const tier2 = fakeClient("tier-2-gemini-flash", { healthy: false })
    const tier3 = fakeClient("tier-3-form-fallback")
    const orchestrator = createChatbotLlmTierOrchestrator({ clients: [tier2, tier3] })

    await expect(orchestrator.generate(llmRequest())).resolves.toEqual(llmResponse("tier-3-form-fallback"))
    expect(tier2.generate).not.toHaveBeenCalled()
    expect(tier3.generate).toHaveBeenCalledOnce()
  })

  it("uses the form fallback after Gemini generation fails", async () => {
    const tier2 = fakeClient("tier-2-gemini-flash", {
      generateError: llmError("tier-2-gemini-flash"),
    })
    const tier3 = fakeClient("tier-3-form-fallback")
    const orchestrator = createChatbotLlmTierOrchestrator({ clients: [tier2, tier3] })

    await expect(orchestrator.generate(llmRequest())).resolves.toEqual(llmResponse("tier-3-form-fallback"))
    expect(tier2.generate).toHaveBeenCalledOnce()
    expect(tier3.generate).toHaveBeenCalledOnce()
  })

  it.each([
    ["missing display envelope", { rawText: "broken", tier: "tier-2-gemini-flash" }],
    [
      "missing raw text",
      {
        displayEnvelope: createChatbotLlmDisplayEnvelope("broken"),
        tier: "tier-2-gemini-flash",
      },
    ],
    [
      "malformed envelope",
      {
        rawText: "broken",
        displayEnvelope: { text: "broken", source: "unknown", defaultDenied: false, fallbackApplied: false, reasons: [] },
        tier: "tier-2-gemini-flash",
      },
    ],
  ])("falls back when a tier returns contract-invalid output: %s", async (_label, invalidResponse) => {
    const tier2 = fakeClient("tier-2-gemini-flash", {
      generateResult: invalidResponse as ChatbotLlmResponse,
    })
    const tier3 = fakeClient("tier-3-form-fallback", {
      generateResult: llmResponse("tier-3-form-fallback", "<customer_reply>フォームへ切り替えます。</customer_reply>"),
    })
    const orchestrator = createChatbotLlmTierOrchestrator({ clients: [tier2, tier3] })

    await expect(orchestrator.generate(llmRequest())).resolves.toMatchObject({
      tier: "tier-3-form-fallback",
      rawText: "<customer_reply>フォームへ切り替えます。</customer_reply>",
    })
  })

  it("accepts the shared tier response envelope", () => {
    expect(() => assertChatbotLlmResponseContract(llmResponse("tier-2-gemini-flash"))).not.toThrow()
  })

  it("throws with the last configured tier when no client succeeds", async () => {
    const tier2 = fakeClient("tier-2-gemini-flash", { healthy: false })
    const tier3 = fakeClient("tier-3-form-fallback", { healthy: false })
    const orchestrator = createChatbotLlmTierOrchestrator({ clients: [tier2, tier3] })

    await expect(orchestrator.generate(llmRequest())).rejects.toMatchObject({
      code: "unknown",
      tier: "tier-3-form-fallback",
      isRetryable: false,
    })
  })

  it("honors a custom tier order", async () => {
    const tier2 = fakeClient("tier-2-gemini-flash")
    const tier3 = fakeClient("tier-3-form-fallback")
    const orchestrator = createChatbotLlmTierOrchestrator({
      clients: [tier2, tier3],
      tierOrder: ["tier-3-form-fallback"],
    })

    await expect(orchestrator.generate(llmRequest())).resolves.toEqual(llmResponse("tier-3-form-fallback"))
    expect(tier2.isHealthy).not.toHaveBeenCalled()
  })

  it("emits health-check and generation events", async () => {
    const events: TierAttemptEvent[] = []
    const diagnostics = { endpoint: "/generate", attemptCount: 2 }
    const tier3 = fakeClient("tier-3-form-fallback", {
      generateResult: llmResponse("tier-3-form-fallback", "復旧しました", diagnostics),
    })
    const orchestrator = createChatbotLlmTierOrchestrator({
      clients: [tier3],
      onTierAttempt: (event) => events.push(event),
    })

    await orchestrator.generate(llmRequest())

    expect(events).toEqual([
      expect.objectContaining({ tier: "tier-3-form-fallback", phase: "health-check", outcome: "healthy" }),
      expect.objectContaining({
        tier: "tier-3-form-fallback",
        phase: "generate",
        outcome: "success",
        diagnostics,
      }),
    ])
  })

  it("emits a client health error without blocking fallback", async () => {
    const events: TierAttemptEvent[] = []
    const healthError = llmError("tier-2-gemini-flash", {
      message: "Gemini API key is not configured.",
      code: "auth",
      isRetryable: false,
    })
    const tier2 = fakeClient("tier-2-gemini-flash", { healthy: false, healthError })
    const tier3 = fakeClient("tier-3-form-fallback")
    const orchestrator = createChatbotLlmTierOrchestrator({
      clients: [tier2, tier3],
      onTierAttempt: (event) => events.push(event),
    })

    await expect(orchestrator.generate(llmRequest())).resolves.toEqual(llmResponse("tier-3-form-fallback"))
    expect(events[0]).toMatchObject({ outcome: "unhealthy", error: healthError })
  })

  it("ignores observer errors", async () => {
    const tier3 = fakeClient("tier-3-form-fallback")
    const orchestrator = createChatbotLlmTierOrchestrator({
      clients: [tier3],
      onTierAttempt: () => {
        throw new Error("observer failed")
      },
    })

    await expect(orchestrator.generate(llmRequest())).resolves.toEqual(llmResponse("tier-3-form-fallback"))
  })

  it("returns true when any ordered tier is healthy", async () => {
    const tier2 = fakeClient("tier-2-gemini-flash", { healthy: false })
    const tier3 = fakeClient("tier-3-form-fallback")
    const orchestrator = createChatbotLlmTierOrchestrator({ clients: [tier2, tier3] })

    await expect(orchestrator.isHealthy()).resolves.toBe(true)
  })

  it("returns false when every ordered tier is unhealthy", async () => {
    const tier2 = fakeClient("tier-2-gemini-flash", { healthy: false })
    const tier3 = fakeClient("tier-3-form-fallback", { healthy: false })
    const orchestrator = createChatbotLlmTierOrchestrator({ clients: [tier2, tier3] })

    await expect(orchestrator.isHealthy()).resolves.toBe(false)
  })

  it("skips a tier when its health check times out", async () => {
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
    const tier3 = fakeClient("tier-3-form-fallback")
    const orchestrator = createChatbotLlmTierOrchestrator({ clients: [tier3] })

    await orchestrator.generate(llmRequest())
    await orchestrator.isHealthy()

    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it("accepts a Gemini reply without a panel when the server supplies the panel this turn", async () => {
    const bodyOnly = llmResponse("tier-2-gemini-flash", "<customer_reply>作業期間は尺で変わります。</customer_reply>")
    const tier2 = fakeClient("tier-2-gemini-flash", { generateResult: bodyOnly })
    const attempts: TierAttemptEvent[] = []
    const orchestrator = createChatbotLlmTierOrchestrator({
      clients: [tier2],
      onTierAttempt: (event) => attempts.push(event),
    })

    await expect(orchestrator.generate(llmRequest({ structuredUiFromCode: true }))).resolves.toEqual(bodyOnly)
    expect(attempts.filter((attempt) => attempt.phase === "generate").map((attempt) => attempt.outcome)).toEqual(["success"])
  })

  it("still rejects a Gemini reply without a panel when the server has none to show", async () => {
    const bodyOnly = llmResponse("tier-2-gemini-flash", "<customer_reply>作業期間は尺で変わります。</customer_reply>")
    const tier2 = fakeClient("tier-2-gemini-flash", { generateResult: bodyOnly })
    const orchestrator = createChatbotLlmTierOrchestrator({ clients: [tier2] })

    await expect(orchestrator.generate(llmRequest())).rejects.toMatchObject({ code: "invalid-output" })
  })

  it("sets aside a panel the model improvised when the server supplies its own, without a failed attempt", async () => {
    const elevenChoices = Array.from({ length: 11 }, (_, index) => ({ id: `choice-${index}`, label: `候補${index}` }))
    const improvised = llmResponse(
      "tier-2-gemini-flash",
      `<customer_reply>承知しました。\n${JSON.stringify({
        tool: "show_choice_panel",
        args: { id: "work-site", question: "作業場所はどちらですか", choices: elevenChoices },
      })}</customer_reply>`,
    )
    const tier2 = fakeClient("tier-2-gemini-flash", { generateResult: improvised })
    const attempts: TierAttemptEvent[] = []
    const orchestrator = createChatbotLlmTierOrchestrator({
      clients: [tier2],
      onTierAttempt: (event) => attempts.push(event),
    })

    await expect(orchestrator.generate(llmRequest({ structuredUiFromCode: true }))).resolves.toEqual(improvised)
    expect(attempts.filter((attempt) => attempt.phase === "generate").map((attempt) => attempt.outcome)).toEqual(["success"])
    await expect(orchestrator.generate(llmRequest())).rejects.toMatchObject({ code: "invalid-output" })
  })
})
