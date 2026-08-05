import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({ prisma: {} }))

import { jobKindChoices, type ChatbotConversation, type ChatbotMessage, type ConversationState } from "@/lib/chatbot/domain"
import {
  ChatbotLlmError,
  defaultLlmTierOrder,
  type ChatbotLlmClient,
  type ChatbotLlmRequest,
  type ChatbotLlmResponse,
  type ChatbotLlmTier,
} from "@/lib/chatbot/server/llm-client"
import { createTier3FormFallbackClient, tier3FormFallbackDefaults } from "@/lib/chatbot/server/llm-clients/tier3-form-fallback"
import {
  createChatbotLlmTierOrchestrator,
  type TierAttemptEvent,
} from "@/lib/chatbot/server/llm-orchestrator"
import { handleChatbotMessage } from "@/lib/chatbot/server/message-handler"
import { createChatbotLlmDisplayEnvelope } from "@/lib/chatbot/server/llm-response-normalizer"
import { createStaticChatbotKnowledgeSnapshot } from "@/lib/chatbot/server/notion-knowledge-sync"
import {
  invalidChoiceSetRegressionCorpus,
  tierFallbackOutputContractIncident,
} from "../../../fixtures/chatbot/tier-fallback-output-contract-corpus"

type LoggedTierAttempt = TierAttemptEvent & { requestId?: string }

function emptyConversationState(): ConversationState {
  return {
    hasFinalMedium: false,
    hasJobKind: false,
    hasProjectLength: false,
    hasAdditionalWork: false,
    hasDocumentaryAttachments: false,
    hasWorkSite: false,
    hasReferenceUrls: false,
    hasContactEmail: false,
    hasDesiredSchedule: false,
    turnCount: 0,
  }
}

function llmRequest(requestId: string): ChatbotLlmRequest {
  return {
    requestId,
    systemPrompt: "Collect one intake fact and return a structured customer response.",
    messages: [{ role: "user", content: tierFallbackOutputContractIncident.userMessage }],
    latestUserMessage: tierFallbackOutputContractIncident.userMessage,
    conversationState: emptyConversationState(),
    jobContext: {
      finalMedium: "other",
      workSite: "remote-grading",
      documentaryAttachment: { kind: "none" },
    },
  }
}

function llmResponse(tier: ChatbotLlmTier, rawText: string): ChatbotLlmResponse {
  return {
    rawText,
    displayEnvelope: createChatbotLlmDisplayEnvelope(rawText),
    tier,
  }
}

function fakeClient(input: {
  tier: ChatbotLlmTier
  response?: ChatbotLlmResponse
  error?: Error
}): ChatbotLlmClient {
  return {
    tier: input.tier,
    isHealthy: vi.fn().mockResolvedValue(true),
    generate: vi.fn(async () => {
      if (input.error) throw input.error
      if (!input.response) throw new Error("missing fake response")
      return input.response
    }),
  }
}

async function runTier2OutputThroughSharedContract(input: {
  requestId: string
  rawText: string
}): Promise<{ result: ChatbotLlmResponse; events: LoggedTierAttempt[] }> {
  const request = llmRequest(input.requestId)
  const events: LoggedTierAttempt[] = []
  const tier1 = fakeClient({
    tier: "tier-1-hosted-chrome-notion-ai",
    error: new ChatbotLlmError({
      message: "Hosted Tier1 timed out.",
      code: "timeout",
      tier: "tier-1-hosted-chrome-notion-ai",
      isRetryable: true,
    }),
  })
  const tier2 = fakeClient({
    tier: "tier-2-gemini-flash",
    response: llmResponse("tier-2-gemini-flash", input.rawText),
  })
  const orchestrator = createChatbotLlmTierOrchestrator({
    clients: [tier1, tier2, createTier3FormFallbackClient()],
    onTierAttempt: (event) => events.push({ requestId: request.requestId, ...event }),
  })

  return { result: await orchestrator.generate(request), events }
}

function expectTier2ContractRejection(input: {
  events: LoggedTierAttempt[]
  requestId: string
  expectedReason: string
}): void {
  const rejection = input.events.find(
    (event) =>
      event.tier === "tier-2-gemini-flash" &&
      event.phase === "generate" &&
      event.outcome === "error",
  )

  expect.soft(rejection).toMatchObject({
    requestId: input.requestId,
    tier: "tier-2-gemini-flash",
    phase: "generate",
    outcome: "error",
    error: expect.objectContaining({
      code: "invalid-output",
      message: expect.stringContaining(input.expectedReason),
    }),
  })
}

function conversation(): ChatbotConversation {
  return {
    id: "regression_conversation",
    startedAt: "2026-08-02T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:00.000Z",
    status: "open",
    context: { sessionId: "regression_session" },
    messages: [],
  }
}

function message(role: ChatbotMessage["role"], content: string): ChatbotMessage {
  return {
    id: `${role}_message`,
    role,
    content,
    createdAt: "2026-08-02T00:00:00.000Z",
  }
}

function handlerHarness(rawText: string) {
  const existingConversation = conversation()
  const repository = {
    loadConversationBySessionId: vi.fn().mockResolvedValue(existingConversation),
    createConversation: vi.fn().mockResolvedValue(existingConversation),
    appendMessage: vi.fn(async (input: { role: ChatbotMessage["role"]; content: string }) =>
      message(input.role, input.content),
    ),
    truncateConversationFromMessage: vi.fn().mockResolvedValue({ deletedCount: 0 }),
    updateConversationRouting: vi.fn().mockResolvedValue(undefined),
    updateConversationSlackThreadTs: vi.fn().mockResolvedValue(undefined),
    linkConversationToUser: vi.fn().mockResolvedValue(undefined),
  }

  return {
    repository,
    options: {
      repository,
      orchestratorFactory: () => ({
        generate: vi.fn().mockResolvedValue(llmResponse("tier-2-gemini-flash", rawText)),
        isHealthy: vi.fn().mockResolvedValue(true),
      }),
      userContextLoader: vi.fn().mockResolvedValue(null),
      userContextFormatter: vi.fn().mockReturnValue(""),
      candidateWindowFinder: vi.fn().mockResolvedValue({ candidates: [], busyDateKeys: [] }),
      knowledgeSnapshotLoader: vi.fn().mockResolvedValue(createStaticChatbotKnowledgeSnapshot()),
      slackNotifier: vi.fn().mockResolvedValue({ status: "skipped", reason: "disabled" }),
    },
  }
}

function readJsonLogs(calls: ReadonlyArray<ReadonlyArray<unknown>>): Array<Record<string, unknown>> {
  return calls.flatMap(([value]) => {
    if (typeof value !== "string" || !value.startsWith("{")) return []
    try {
      return [JSON.parse(value) as Record<string, unknown>]
    } catch {
      return []
    }
  })
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe("lower-tier response without structured UI", () => {
  it("rejects a Tier2 body-only response after Tier1 failure and falls through to Tier3 form", async () => {
    const incident = tierFallbackOutputContractIncident
    const { result, events } = await runTier2OutputThroughSharedContract({
      requestId: incident.requestId,
      rawText: incident.tier2RawText,
    })

    expect.soft(result).toMatchObject({
      tier: incident.expected.tier,
      rawText: tier3FormFallbackDefaults.responseText,
    })
    expectTier2ContractRejection({
      events,
      requestId: incident.requestId,
      expectedReason: incident.expected.boundaryReason,
    })
  })
})

describe("invalid choice-set contract", () => {
  it.each(invalidChoiceSetRegressionCorpus)(
    "rejects $id and regenerates the structured intake UI with an auditable reason",
    async (regressionCase) => {
      vi.stubEnv("NODE_ENV", "production")
      const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => undefined)
      const harness = handlerHarness(regressionCase.rawText)

      const result = await handleChatbotMessage(
        {
          requestId: regressionCase.requestId,
          sessionId: "regression_session",
          message: "はじめまして。",
          conversationState: emptyConversationState(),
        },
        harness.options,
      )
      const boundaryEvent = readJsonLogs(consoleInfo.mock.calls).find(
        (event) =>
          event.requestId === regressionCase.requestId &&
          event.boundary === "llm-output-contract" &&
          event.decision === "reject-and-regenerate-structured-ui",
      )

      expect.soft(result).toMatchObject({
        assistantMessage: {
          content: `${jobKindChoices.question}\n下の選択肢から選んでください。`,
        },
        ui: {
          kind: "choice-panel",
          choiceSet: { id: jobKindChoices.id },
        },
      })
      expect.soft(result.assistantMessage.content).not.toContain(regressionCase.customerText)
      expect.soft(boundaryEvent).toMatchObject({
        requestId: regressionCase.requestId,
        boundary: "llm-output-contract",
        decision: "reject-and-regenerate-structured-ui",
        reason: regressionCase.expectedBoundaryReason,
      })
    },
  )
})

describe("canonical production tier order", () => {
  it("keeps the order exactly Tier1 hosted -> Tier2 Gemini -> Tier3 form", () => {
    expect(defaultLlmTierOrder).toEqual([
      "tier-1-hosted-chrome-notion-ai",
      "tier-2-gemini-flash",
      "tier-3-form-fallback",
    ])
  })
})
