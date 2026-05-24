import { describe, expect, it, vi } from "vitest"

import type { ConversationState, JobContext } from "@/lib/chatbot/domain"
import {
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

function llmResponse(tier: ChatbotLlmTier, rawText = `${tier} response`): ChatbotLlmResponse {
  return {
    rawText,
    tier,
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
  } satisfies ChatbotLlmClient

  return client
}

describe("createChatbotLlmTierOrchestrator", () => {
  it("returns tier 1 response when tier 1 is healthy and generate succeeds", async () => {
    const tier1 = fakeClient("tier-1-chrome-notion-ai")
    const tier2 = fakeClient("tier-2-ollama-deepseek")
    const orchestrator = createChatbotLlmTierOrchestrator({ clients: [tier1, tier2] })

    await expect(orchestrator.generate(llmRequest())).resolves.toEqual(
      llmResponse("tier-1-chrome-notion-ai"),
    )
    expect(tier1.generate).toHaveBeenCalledOnce()
    expect(tier2.generate).not.toHaveBeenCalled()
  })

  it("tries tier 2 when tier 1 is unhealthy", async () => {
    const tier1 = fakeClient("tier-1-chrome-notion-ai", { healthy: false })
    const tier2 = fakeClient("tier-2-ollama-deepseek")
    const orchestrator = createChatbotLlmTierOrchestrator({ clients: [tier1, tier2] })

    await expect(orchestrator.generate(llmRequest())).resolves.toEqual(
      llmResponse("tier-2-ollama-deepseek"),
    )
    expect(tier1.generate).not.toHaveBeenCalled()
    expect(tier2.generate).toHaveBeenCalledOnce()
  })

  it("tries tier 2 when tier 1 generate throws a retryable ChatbotLlmError", async () => {
    const tier1 = fakeClient("tier-1-chrome-notion-ai", {
      generateError: llmError("tier-1-chrome-notion-ai", { isRetryable: true }),
    })
    const tier2 = fakeClient("tier-2-ollama-deepseek")
    const orchestrator = createChatbotLlmTierOrchestrator({ clients: [tier1, tier2] })

    await expect(orchestrator.generate(llmRequest())).resolves.toEqual(
      llmResponse("tier-2-ollama-deepseek"),
    )
    expect(tier1.generate).toHaveBeenCalledOnce()
    expect(tier2.generate).toHaveBeenCalledOnce()
  })

  it("tries tier 2 when tier 1 generate throws a non-retryable ChatbotLlmError", async () => {
    const tier1 = fakeClient("tier-1-chrome-notion-ai", {
      generateError: llmError("tier-1-chrome-notion-ai", { isRetryable: false }),
    })
    const tier2 = fakeClient("tier-2-ollama-deepseek")
    const orchestrator = createChatbotLlmTierOrchestrator({ clients: [tier1, tier2] })

    await expect(orchestrator.generate(llmRequest())).resolves.toEqual(
      llmResponse("tier-2-ollama-deepseek"),
    )
    expect(tier1.generate).toHaveBeenCalledOnce()
    expect(tier2.generate).toHaveBeenCalledOnce()
  })

  it("uses tier 4 form fallback after tiers 1 through 3 fail", async () => {
    const tier1 = fakeClient("tier-1-chrome-notion-ai", {
      generateError: llmError("tier-1-chrome-notion-ai"),
    })
    const tier2 = fakeClient("tier-2-ollama-deepseek", {
      generateError: llmError("tier-2-ollama-deepseek"),
    })
    const tier3 = fakeClient("tier-3-gemini-flash-lite", {
      generateError: llmError("tier-3-gemini-flash-lite"),
    })
    const tier4 = fakeClient("tier-4-form-fallback", {
      generateResult: llmResponse("tier-4-form-fallback", "fallback form"),
    })
    const orchestrator = createChatbotLlmTierOrchestrator({ clients: [tier1, tier2, tier3, tier4] })

    await expect(orchestrator.generate(llmRequest())).resolves.toEqual(
      llmResponse("tier-4-form-fallback", "fallback form"),
    )
    expect(tier4.generate).toHaveBeenCalledOnce()
  })

  it("throws unknown ChatbotLlmError when tier 4 is missing and tiers 1 through 3 fail", async () => {
    const tier1 = fakeClient("tier-1-chrome-notion-ai", {
      generateError: llmError("tier-1-chrome-notion-ai"),
    })
    const tier2 = fakeClient("tier-2-ollama-deepseek", {
      generateError: llmError("tier-2-ollama-deepseek"),
    })
    const tier3 = fakeClient("tier-3-gemini-flash-lite", {
      generateError: llmError("tier-3-gemini-flash-lite"),
    })
    const orchestrator = createChatbotLlmTierOrchestrator({ clients: [tier1, tier2, tier3] })

    await expect(orchestrator.generate(llmRequest())).rejects.toMatchObject({
      code: "unknown",
      tier: "tier-3-gemini-flash-lite",
      isRetryable: false,
    })
  })

  it("honors custom tierOrder and skips omitted tiers", async () => {
    const tier1 = fakeClient("tier-1-chrome-notion-ai")
    const tier2 = fakeClient("tier-2-ollama-deepseek")
    const tier3 = fakeClient("tier-3-gemini-flash-lite")
    const tier4 = fakeClient("tier-4-form-fallback")
    const orchestrator = createChatbotLlmTierOrchestrator({
      clients: [tier1, tier2, tier3, tier4],
      tierOrder: ["tier-2-ollama-deepseek", "tier-4-form-fallback"],
    })

    await expect(orchestrator.generate(llmRequest())).resolves.toEqual(
      llmResponse("tier-2-ollama-deepseek"),
    )
    expect(tier1.isHealthy).not.toHaveBeenCalled()
    expect(tier3.isHealthy).not.toHaveBeenCalled()
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
      },
    ])
  })

  it("ignores onTierAttempt errors and keeps fallback behavior", async () => {
    const tier1 = fakeClient("tier-1-chrome-notion-ai", { healthy: false })
    const tier2 = fakeClient("tier-2-ollama-deepseek")
    const orchestrator = createChatbotLlmTierOrchestrator({
      clients: [tier1, tier2],
      onTierAttempt: () => {
        throw new Error("observer failed")
      },
    })

    await expect(orchestrator.generate(llmRequest())).resolves.toEqual(
      llmResponse("tier-2-ollama-deepseek"),
    )
  })

  it("returns true from isHealthy when any ordered tier is healthy", async () => {
    const tier1 = fakeClient("tier-1-chrome-notion-ai", { healthy: false })
    const tier2 = fakeClient("tier-2-ollama-deepseek", { healthy: true })
    const orchestrator = createChatbotLlmTierOrchestrator({ clients: [tier1, tier2] })

    await expect(orchestrator.isHealthy()).resolves.toBe(true)
    expect(tier2.isHealthy).toHaveBeenCalledOnce()
  })

  it("returns false from isHealthy when all ordered tiers are unhealthy", async () => {
    const tier1 = fakeClient("tier-1-chrome-notion-ai", { healthy: false })
    const tier2 = fakeClient("tier-2-ollama-deepseek", { healthy: false })
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
