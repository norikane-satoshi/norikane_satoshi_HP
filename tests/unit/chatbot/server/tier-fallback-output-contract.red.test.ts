import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({ prisma: {} }))

import { jobKindChoices, type ChatbotConversation, type ChatbotMessage, type ConversationState } from "@/lib/chatbot/domain"
import {
  ChatbotLlmError,
  defaultLlmTierOrder,
  type ChatbotLlmClient,
  type ChatbotLlmResponse,
  type ChatbotLlmTier,
} from "@/lib/chatbot/server/llm-client"
import { createTier3FormFallbackClient } from "@/lib/chatbot/server/llm-clients/tier3-form-fallback"
import { createChatbotLlmTierOrchestrator } from "@/lib/chatbot/server/llm-orchestrator"
import { handleChatbotMessage } from "@/lib/chatbot/server/message-handler"
import { createChatbotLlmDisplayEnvelope } from "@/lib/chatbot/server/llm-response-normalizer"
import { createStaticChatbotKnowledgeSnapshot } from "@/lib/chatbot/server/notion-knowledge-sync"
import {
  invalidChoiceSetRegressionCorpus,
  tierFallbackOutputContractIncident,
} from "../../../fixtures/chatbot/tier-fallback-output-contract-corpus"

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
  it("repairs a Tier2 body-only response with the deterministic intake UI without demoting to Tier3", async () => {
    const incident = tierFallbackOutputContractIncident
    vi.stubEnv("NODE_ENV", "production")
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => undefined)
    const harness = handlerHarness(incident.tier2RawText)
    const orchestrator = createChatbotLlmTierOrchestrator({
      clients: [
        fakeClient({
          tier: "tier-1-hosted-chrome-notion-ai",
          error: new ChatbotLlmError({
            message: "Hosted Tier1 was rate limited.",
            code: "rate-limit",
            tier: "tier-1-hosted-chrome-notion-ai",
            isRetryable: true,
          }),
        }),
        fakeClient({
          tier: "tier-2-gemini-flash",
          response: llmResponse("tier-2-gemini-flash", incident.tier2RawText),
        }),
        createTier3FormFallbackClient(),
      ],
    })
    const result = await handleChatbotMessage(
      {
        requestId: incident.requestId,
        sessionId: "regression_session",
        message: incident.userMessage,
        conversationState: emptyConversationState(),
      },
      { ...harness.options, orchestratorFactory: () => orchestrator },
    )
    const boundaryEvent = readJsonLogs(consoleInfo.mock.calls).find(
      (event) =>
        event.requestId === incident.requestId &&
        event.boundary === "llm-output-contract",
    )

    expect.soft(result).toMatchObject({
      tier: incident.expected.tier,
      assistantMessage: {
        content: "内容を確認しました。続けて相談内容を送ってください。",
      },
      ui: {
        kind: "direct-contact-card",
        reason: "pricing",
      },
    })
    expect.soft(boundaryEvent).toMatchObject({
      requestId: incident.requestId,
      boundary: "llm-output-contract",
      decision: "reject-and-regenerate-structured-ui",
      reason: incident.expected.boundaryReason,
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
