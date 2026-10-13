import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({ prisma: {} }))

import { jobKindChoices, type ChatbotConversation, type ChatbotMessage, type ConversationState } from "@/lib/chatbot/domain"
import {
  defaultLlmTierOrder,
  type ChatbotLlmResponse,
  type ChatbotLlmTier,
} from "@/lib/chatbot/server/llm-client"
import { handleChatbotMessage } from "@/lib/chatbot/server/message-handler"
import { createChatbotLlmDisplayEnvelope } from "@/lib/chatbot/server/llm-response-normalizer"
import { createStaticChatbotKnowledgeSnapshot } from "@/lib/chatbot/server/notion-knowledge-sync"
import { invalidChoiceSetRegressionCorpus } from "../../../fixtures/chatbot/tier-fallback-output-contract-corpus"

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
    loadOrCreateConversationBySessionId: vi.fn().mockResolvedValue(existingConversation),
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
      // The code shows its own panel here, so the model's improvised panel is set aside, not a failure.
      expect(result.auditEvidence?.tierAttempts.filter((attempt) => attempt.result === "failure")).toEqual([])
    },
  )
})

describe("canonical production tier order", () => {
  it("keeps the order exactly Tier2 Gemini -> Tier3 form", () => {
    expect(defaultLlmTierOrder).toEqual([
      "tier-2-gemini-flash",
      "tier-3-form-fallback",
    ])
  })
})
