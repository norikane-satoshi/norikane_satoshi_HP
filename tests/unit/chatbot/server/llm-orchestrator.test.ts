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
  rawText = `${tier} response`,
  diagnostics?: ChatbotLlmResponse["diagnostics"],
): ChatbotLlmResponse {
  return {
    rawText,
    displayEnvelope: createChatbotLlmDisplayEnvelope(rawText),
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
  const client = {
    tier,
    isHealthy: vi.fn(async () => overrides.healthPromise ?? overrides.healthy ?? true),
    generate: vi.fn(async () => {
      if (overrides.generateError) throw overrides.generateError
      return overrides.generateResult ?? llmResponse(tier)
    }),
    getLastHealthError: vi.fn(() => overrides.healthError),
  } satisfies ChatbotLlmClient

  return client
}

describe("createChatbotLlmTierOrchestrator", () => {
  it("returns tier 1 response when tier 1 is healthy and generate succeeds", async () => {
    const tier1 = fakeClient("tier-1-chrome-notion-ai")
    const tier2 = fakeClient("tier-3-ollama-deepseek")
    const orchestrator = createChatbotLlmTierOrchestrator({ clients: [tier1, tier2] })

    await expect(orchestrator.generate(llmRequest())).resolves.toEqual(
      llmResponse("tier-1-chrome-notion-ai"),
    )
    expect(tier1.generate).toHaveBeenCalledOnce()
    expect(tier2.generate).not.toHaveBeenCalled()
  })

  it("tries tier 2 when tier 1 is unhealthy", async () => {
    const tier1 = fakeClient("tier-1-chrome-notion-ai", { healthy: false })
    const tier2 = fakeClient("tier-2-hosted-chrome-notion-ai")
    const orchestrator = createChatbotLlmTierOrchestrator({ clients: [tier1, tier2] })

    await expect(orchestrator.generate(llmRequest())).resolves.toEqual(
      llmResponse("tier-2-hosted-chrome-notion-ai"),
    )
    expect(tier1.generate).not.toHaveBeenCalled()
    expect(tier2.generate).toHaveBeenCalledOnce()
  })

  it("chooses hosted worker tier 2 when tier 1 is unhealthy", async () => {
    const tier1 = fakeClient("tier-1-chrome-notion-ai", { healthy: false })
    const tier2 = fakeClient("tier-2-hosted-chrome-notion-ai", { healthy: true })
    const tier3 = fakeClient("tier-3-ollama-deepseek", { healthy: true })
    const tier4 = fakeClient("tier-4-form-fallback", { healthy: true })
    const orchestrator = createChatbotLlmTierOrchestrator({ clients: [tier1, tier2, tier3, tier4] })

    await expect(orchestrator.generate(llmRequest())).resolves.toEqual(
      llmResponse("tier-2-hosted-chrome-notion-ai"),
    )
    expect(tier1.generate).not.toHaveBeenCalled()
    expect(tier2.generate).toHaveBeenCalledOnce()
    expect(tier3.generate).not.toHaveBeenCalled()
    expect(tier4.generate).not.toHaveBeenCalled()
  })

  it.each([
    ["missing display envelope", { rawText: "broken", tier: "tier-1-chrome-notion-ai" }],
    [
      "missing raw text",
      {
        displayEnvelope: createChatbotLlmDisplayEnvelope("broken"),
        tier: "tier-1-chrome-notion-ai",
      },
    ],
    [
      "malformed envelope",
      {
        rawText: "broken",
        displayEnvelope: { text: "broken", source: "unknown", defaultDenied: false, fallbackApplied: false, reasons: [] },
        tier: "tier-1-chrome-notion-ai",
      },
    ],
  ])("falls back when a tier returns contract-invalid output: %s", async (_label, invalidResponse) => {
    const tier1 = fakeClient("tier-1-chrome-notion-ai", {
      generateResult: invalidResponse as ChatbotLlmResponse,
    })
    const tier4 = fakeClient(
      "tier-4-form-fallback",
      { generateResult: llmResponse("tier-4-form-fallback", "<customer_reply>フォームへ切り替えます。</customer_reply>") },
    )
    const orchestrator = createChatbotLlmTierOrchestrator({ clients: [tier1, tier4] })

    await expect(orchestrator.generate(llmRequest())).resolves.toMatchObject({
      tier: "tier-4-form-fallback",
      rawText: "<customer_reply>フォームへ切り替えます。</customer_reply>",
    })
    expect(tier1.generate).toHaveBeenCalledOnce()
    expect(tier4.generate).toHaveBeenCalledOnce()
  })

  it("accepts the shared tier response envelope", () => {
    expect(() => assertChatbotLlmResponseContract(llmResponse("tier-2-hosted-chrome-notion-ai"))).not.toThrow()
  })

  it("chooses Ollama tier 3 when tiers 1 and 2 are unhealthy", async () => {
    const tier1 = fakeClient("tier-1-chrome-notion-ai", { healthy: false })
    const tier2 = fakeClient("tier-2-hosted-chrome-notion-ai", { healthy: false })
    const gemini = fakeClient("tier-3-gemini-flash", { healthy: false })
    const tier3 = fakeClient("tier-3-ollama-deepseek", { healthy: true })
    const tier4 = fakeClient("tier-4-form-fallback", { healthy: true })
    const orchestrator = createChatbotLlmTierOrchestrator({ clients: [tier1, tier2, gemini, tier3, tier4] })

    await expect(orchestrator.generate(llmRequest())).resolves.toEqual(
      llmResponse("tier-3-ollama-deepseek"),
    )
    expect(tier1.generate).not.toHaveBeenCalled()
    expect(tier2.generate).not.toHaveBeenCalled()
    expect(gemini.generate).not.toHaveBeenCalled()
    expect(tier3.generate).toHaveBeenCalledOnce()
    expect(tier4.generate).not.toHaveBeenCalled()
  })

  it("chooses Gemini tier 3 when tiers 1 and 2 fail in production-like routing", async () => {
    const tier1 = fakeClient("tier-1-chrome-notion-ai", { healthy: false })
    const tier2 = fakeClient("tier-2-hosted-chrome-notion-ai", {
      generateError: llmError("tier-2-hosted-chrome-notion-ai", { code: "connection", isRetryable: true }),
    })
    const gemini = fakeClient("tier-3-gemini-flash", { healthy: true })
    const ollama = fakeClient("tier-3-ollama-deepseek", { healthy: true })
    const tier4 = fakeClient("tier-4-form-fallback", { healthy: true })
    const orchestrator = createChatbotLlmTierOrchestrator({ clients: [tier1, tier2, gemini, ollama, tier4] })

    await expect(orchestrator.generate(llmRequest())).resolves.toEqual(
      llmResponse("tier-3-gemini-flash"),
    )
    expect(tier2.generate).toHaveBeenCalledOnce()
    expect(gemini.generate).toHaveBeenCalledOnce()
    expect(ollama.generate).not.toHaveBeenCalled()
    expect(tier4.generate).not.toHaveBeenCalled()
  })

  it("tries tier 2 when tier 1 generate throws a retryable ChatbotLlmError", async () => {
    const tier1 = fakeClient("tier-1-chrome-notion-ai", {
      generateError: llmError("tier-1-chrome-notion-ai", { isRetryable: true }),
    })
    const tier2 = fakeClient("tier-3-ollama-deepseek")
    const orchestrator = createChatbotLlmTierOrchestrator({ clients: [tier1, tier2] })

    await expect(orchestrator.generate(llmRequest())).resolves.toEqual(
      llmResponse("tier-3-ollama-deepseek"),
    )
    expect(tier1.generate).toHaveBeenCalledOnce()
    expect(tier2.generate).toHaveBeenCalledOnce()
  })

  it("tries tier 2 when tier 1 generate throws a non-retryable ChatbotLlmError", async () => {
    const tier1 = fakeClient("tier-1-chrome-notion-ai", {
      generateError: llmError("tier-1-chrome-notion-ai", { isRetryable: false }),
    })
    const tier2 = fakeClient("tier-3-ollama-deepseek")
    const orchestrator = createChatbotLlmTierOrchestrator({ clients: [tier1, tier2] })

    await expect(orchestrator.generate(llmRequest())).resolves.toEqual(
      llmResponse("tier-3-ollama-deepseek"),
    )
    expect(tier1.generate).toHaveBeenCalledOnce()
    expect(tier2.generate).toHaveBeenCalledOnce()
  })

  it("uses tier 4 form fallback after tiers 1 and 2 fail", async () => {
    const tier1 = fakeClient("tier-1-chrome-notion-ai", {
      generateError: llmError("tier-1-chrome-notion-ai"),
    })
    const tier2 = fakeClient("tier-3-ollama-deepseek", {
      generateError: llmError("tier-3-ollama-deepseek"),
    })
    const tier4 = fakeClient("tier-4-form-fallback", {
      generateResult: llmResponse("tier-4-form-fallback", "fallback form"),
    })
    const orchestrator = createChatbotLlmTierOrchestrator({ clients: [tier1, tier2, tier4] })

    await expect(orchestrator.generate(llmRequest())).resolves.toEqual(
      llmResponse("tier-4-form-fallback", "fallback form"),
    )
    expect(tier4.generate).toHaveBeenCalledOnce()
  })

  it("throws unknown ChatbotLlmError when tier 4 is missing and tiers 1 and 2 fail", async () => {
    const tier1 = fakeClient("tier-1-chrome-notion-ai", {
      generateError: llmError("tier-1-chrome-notion-ai"),
    })
    const tier2 = fakeClient("tier-3-ollama-deepseek", {
      generateError: llmError("tier-3-ollama-deepseek"),
    })
    const orchestrator = createChatbotLlmTierOrchestrator({ clients: [tier1, tier2] })

    await expect(orchestrator.generate(llmRequest())).rejects.toMatchObject({
      code: "unknown",
      tier: "tier-3-ollama-deepseek",
      isRetryable: false,
    })
  })

  it("honors custom tierOrder and skips omitted tiers", async () => {
    const tier1 = fakeClient("tier-1-chrome-notion-ai")
    const tier2 = fakeClient("tier-3-ollama-deepseek")
    const tier4 = fakeClient("tier-4-form-fallback")
    const orchestrator = createChatbotLlmTierOrchestrator({
      clients: [tier1, tier2, tier4],
      tierOrder: ["tier-3-ollama-deepseek", "tier-4-form-fallback"],
    })

    await expect(orchestrator.generate(llmRequest())).resolves.toEqual(
      llmResponse("tier-3-ollama-deepseek"),
    )
    expect(tier1.isHealthy).not.toHaveBeenCalled()
    expect(tier4.isHealthy).not.toHaveBeenCalled()
  })

  it("emits health-check and generate attempt events for each tried tier", async () => {
    const events: TierAttemptEvent[] = []
    const tier1 = fakeClient("tier-1-chrome-notion-ai")
    const orchestrator = createChatbotLlmTierOrchestrator({
      clients: [tier1],
      onTierAttempt: (event) => events.push(event),
    })

    await orchestrator.generate(llmRequest())

    expect(events).toEqual([
      {
        tier: "tier-1-chrome-notion-ai",
        phase: "health-check",
        outcome: "healthy",
        latencyMs: expect.any(Number),
      },
      {
        tier: "tier-1-chrome-notion-ai",
        phase: "generate",
        outcome: "success",
        latencyMs: expect.any(Number),
        diagnostics: undefined,
      },
    ])
  })

  it("emits retry diagnostics from a successful hosted Tier2 generate event", async () => {
    const events: TierAttemptEvent[] = []
    const diagnostics = {
      endpoint: "/generate",
      attemptCount: 2,
      retryReasons: ["server-error"],
      repairAttempted: true,
      totalGenerateDurationMs: 312,
    }
    const tier2 = fakeClient("tier-2-hosted-chrome-notion-ai", {
      generateResult: llmResponse("tier-2-hosted-chrome-notion-ai", "復旧しました", diagnostics),
    })
    const orchestrator = createChatbotLlmTierOrchestrator({
      clients: [tier2],
      onTierAttempt: (event) => events.push(event),
    })

    await orchestrator.generate(llmRequest())

    expect(events[1]).toMatchObject({
      tier: "tier-2-hosted-chrome-notion-ai",
      phase: "generate",
      outcome: "success",
      diagnostics,
    })
  })

  it("emits the client health error when a false health check exposes one", async () => {
    const events: TierAttemptEvent[] = []
    const healthError = llmError("tier-2-hosted-chrome-notion-ai", {
      message: "Hosted Notion AI worker URL or token is not configured.",
      code: "auth",
      isRetryable: false,
    })
    const tier2 = fakeClient("tier-2-hosted-chrome-notion-ai", {
      healthy: false,
      healthError,
    })
    const tier4 = fakeClient("tier-4-form-fallback")
    const orchestrator = createChatbotLlmTierOrchestrator({
      clients: [tier2, tier4],
      onTierAttempt: (event) => events.push(event),
    })

    await expect(orchestrator.generate(llmRequest())).resolves.toEqual(
      llmResponse("tier-4-form-fallback"),
    )

    expect(events[0]).toMatchObject({
      tier: "tier-2-hosted-chrome-notion-ai",
      phase: "health-check",
      outcome: "unhealthy",
      error: healthError,
    })
  })

  it("ignores onTierAttempt errors and keeps fallback behavior", async () => {
    const tier1 = fakeClient("tier-1-chrome-notion-ai", { healthy: false })
    const tier2 = fakeClient("tier-3-ollama-deepseek")
    const orchestrator = createChatbotLlmTierOrchestrator({
      clients: [tier1, tier2],
      onTierAttempt: () => {
        throw new Error("observer failed")
      },
    })

    await expect(orchestrator.generate(llmRequest())).resolves.toEqual(
      llmResponse("tier-3-ollama-deepseek"),
    )
  })

  it("returns true from isHealthy when any ordered tier is healthy", async () => {
    const tier1 = fakeClient("tier-1-chrome-notion-ai", { healthy: false })
    const tier2 = fakeClient("tier-3-ollama-deepseek", { healthy: true })
    const orchestrator = createChatbotLlmTierOrchestrator({ clients: [tier1, tier2] })

    await expect(orchestrator.isHealthy()).resolves.toBe(true)
    expect(tier2.isHealthy).toHaveBeenCalledOnce()
  })

  it("returns false from isHealthy when all ordered tiers are unhealthy", async () => {
    const tier1 = fakeClient("tier-1-chrome-notion-ai", { healthy: false })
    const tier2 = fakeClient("tier-3-ollama-deepseek", { healthy: false })
    const orchestrator = createChatbotLlmTierOrchestrator({ clients: [tier1, tier2] })

    await expect(orchestrator.isHealthy()).resolves.toBe(false)
  })

  it("treats isHealthy timeout as false", async () => {
    const tier1 = fakeClient("tier-1-chrome-notion-ai", {
      healthPromise: new Promise<boolean>(() => {}),
    })
    const orchestrator = createChatbotLlmTierOrchestrator({
      clients: [tier1],
      healthCheckTimeoutMs: 1,
    })

    await expect(orchestrator.isHealthy()).resolves.toBe(false)
  })

  it("skips a tier when generate health-check times out", async () => {
    const tier1 = fakeClient("tier-1-chrome-notion-ai", {
      healthPromise: new Promise<boolean>(() => {}),
    })
    const tier4 = fakeClient("tier-4-form-fallback")
    const orchestrator = createChatbotLlmTierOrchestrator({
      clients: [tier1, tier4],
      healthCheckTimeoutMs: 1,
    })

    await expect(orchestrator.generate(llmRequest())).resolves.toEqual(
      llmResponse("tier-4-form-fallback"),
    )
    expect(tier1.generate).not.toHaveBeenCalled()
    expect(tier4.generate).toHaveBeenCalledOnce()
  })

  it("still tries hosted tier 2 when its health probe times out", async () => {
    const tier2 = fakeClient("tier-2-hosted-chrome-notion-ai", {
      healthPromise: new Promise<boolean>(() => {}),
    })
    const tier3 = fakeClient("tier-3-gemini-flash")
    const orchestrator = createChatbotLlmTierOrchestrator({
      clients: [tier2, tier3],
      healthCheckTimeoutMs: 1,
    })

    await expect(orchestrator.generate(llmRequest())).resolves.toEqual(
      llmResponse("tier-2-hosted-chrome-notion-ai"),
    )
    expect(tier2.generate).toHaveBeenCalledOnce()
    expect(tier3.generate).not.toHaveBeenCalled()
  })

  it("still tries hosted tier 2 after a retryable health error", async () => {
    const healthError = llmError("tier-2-hosted-chrome-notion-ai", {
      code: "connection",
      isRetryable: true,
    })
    const tier2 = fakeClient("tier-2-hosted-chrome-notion-ai", {
      healthy: false,
      healthError,
    })
    const tier3 = fakeClient("tier-3-gemini-flash")
    const orchestrator = createChatbotLlmTierOrchestrator({ clients: [tier2, tier3] })

    await expect(orchestrator.generate(llmRequest())).resolves.toEqual(
      llmResponse("tier-2-hosted-chrome-notion-ai"),
    )
    expect(tier2.generate).toHaveBeenCalledOnce()
    expect(tier3.generate).not.toHaveBeenCalled()
  })

  it("does not call fetch or any network transport directly", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    const tier1 = fakeClient("tier-1-chrome-notion-ai")
    const orchestrator = createChatbotLlmTierOrchestrator({ clients: [tier1] })

    await orchestrator.generate(llmRequest())
    await orchestrator.isHealthy()

    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })
})
