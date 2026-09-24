import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({ prisma: {} }))

import type { ChatbotConversation, ChatbotMessage, ConversationState, SurveyChoiceSet } from "@/lib/chatbot/domain"
import { finalMediumChoices, jobKindChoices } from "@/lib/chatbot/domain"
import { handleChatbotMessage } from "@/lib/chatbot/server/message-handler"
import { chatbotLlmTierIds } from "@/lib/chatbot/server/llm-client"
import { createChatbotLlmDisplayEnvelope } from "@/lib/chatbot/server/llm-response-normalizer"
import { createStaticChatbotKnowledgeSnapshot } from "@/lib/chatbot/server/notion-knowledge-sync"

const at = "2026-09-25T00:00:00.000Z"

function msg(id: string, role: ChatbotMessage["role"], content: string): ChatbotMessage {
  return { id, role, content, createdAt: at }
}

function conversation(input: {
  messages: ChatbotMessage[]
  activeChoices?: SurveyChoiceSet
  conversationState?: Partial<ConversationState>
  jobContext?: ChatbotConversation["context"]["jobContext"]
}): ChatbotConversation {
  return {
    id: "conv_det",
    startedAt: at,
    updatedAt: at,
    status: "open",
    context: {
      sessionId: "session_det",
      ...(input.activeChoices ? { activeChoices: input.activeChoices, currentQuestion: input.activeChoices.question } : {}),
      ...(input.conversationState ? { conversationState: input.conversationState } : {}),
      ...(input.jobContext ? { jobContext: input.jobContext } : {}),
    },
    messages: input.messages,
  }
}

function harness(existing: ChatbotConversation) {
  const raw = "<customer_reply>LLM本文</customer_reply>"
  const generate = vi.fn(async () => ({
    rawText: raw,
    displayEnvelope: createChatbotLlmDisplayEnvelope(raw),
    tier: chatbotLlmTierIds.tier1HostedChromeNotionAi,
  }))
  const repository = {
    loadOrCreateConversationBySessionId: vi.fn(async () => existing),
    appendMessage: vi.fn(async (input: { id?: string; role: ChatbotMessage["role"]; content: string }) =>
      msg(input.id ?? `${input.role}_new`, input.role, input.content)),
    truncateConversationFromMessage: vi.fn().mockResolvedValue({ deletedCount: 0 }),
    updateConversationRouting: vi.fn(),
    updateConversationSlackThreadTs: vi.fn(),
    linkConversationToUser: vi.fn(),
  }
  const snapshot = createStaticChatbotKnowledgeSnapshot()
  const options = {
    repository,
    orchestratorFactory: () => ({ generate, isHealthy: vi.fn(async () => true) }),
    knowledgeSnapshotLoader: async () => snapshot,
    slackNotifier: vi.fn().mockResolvedValue({ status: "skipped", reason: "disabled" }),
    candidateWindowFinder: vi.fn().mockResolvedValue([]),
    choiceInterpreter: vi.fn().mockResolvedValue(null),
  }
  return { generate, options }
}

const jobKindPanelConversation = () =>
  conversation({
    messages: [
      msg("u1", "user", "Web CMのカラーグレーディングをお願いしたいです"),
      msg("a1", "assistant", "まず案件種別を選んでください\n下の選択肢から選んでください。"),
    ],
    activeChoices: jobKindChoices,
  })

const finalMediumPanelConversation = () =>
  conversation({
    messages: [
      msg("u1", "user", "CMの相談です"),
      msg("a1", "assistant", "最終媒体をすべて選んでください\n下の選択肢から選んでください。"),
    ],
    activeChoices: finalMediumChoices,
    conversationState: { hasJobKind: true, hasProjectLength: true, turnCount: 3 },
    jobContext: { jobKind: "cm-30s" },
  })

describe("deterministic intake replies (Tier 0)", () => {
  it("answers a confirmed choice-panel submission without calling the LLM", async () => {
    const h = harness(jobKindPanelConversation())
    const result = await handleChatbotMessage({ sessionId: "session_det", message: "選択: Web CM / CM" }, h.options)

    expect(h.generate).not.toHaveBeenCalled()
    expect(result.tier).toBe(chatbotLlmTierIds.tier0DeterministicIntake)
    expect(result.ui.kind).toBe("choice-panel")
    expect(result.assistantMessage.content).not.toContain("LLM本文")
    expect(result.auditEvidence.tierAttempts).toEqual([
      expect.objectContaining({ tier: chatbotLlmTierIds.tier0DeterministicIntake, phase: "generate", result: "success" }),
    ])
  })

  it("answers a captured free-text intake answer without calling the LLM", async () => {
    const h = harness(conversation({
      messages: [
        msg("u1", "user", "CMの相談です"),
        msg("a1", "assistant", "その素材は、いつお送りいただけそうですか？未定の場合は「未定」とお答えください。"),
      ],
      conversationState: {
        hasJobKind: true,
        hasProjectLength: true,
        hasFinalMedium: true,
        hasAdditionalWork: true,
        hasDocumentaryAttachments: true,
        hasWorkSite: true,
        hasMaterialDetails: true,
        materialHandoff: { contents: "ProRes書き出し" },
        turnCount: 8,
      },
      jobContext: { jobKind: "cm-30s", finalMedium: "web" },
    }))
    const result = await handleChatbotMessage({ sessionId: "session_det", message: "来週中に送れます" }, h.options)

    expect(h.generate).not.toHaveBeenCalled()
    expect(result.tier).toBe(chatbotLlmTierIds.tier0DeterministicIntake)
    expect(result.assistantMessage.content).toContain("受け渡し方法")
  })

  it("keeps the LLM for a question typed while a panel is shown", async () => {
    const h = harness(jobKindPanelConversation())
    const result = await handleChatbotMessage({ sessionId: "session_det", message: "作業期間はどれくらいかかりますか？" }, h.options)

    expect(h.generate).toHaveBeenCalledOnce()
    expect(result.tier).toBe(chatbotLlmTierIds.tier1HostedChromeNotionAi)
  })

  it("keeps the LLM for the first consultation message", async () => {
    const h = harness(conversation({ messages: [] }))
    await handleChatbotMessage({ sessionId: "session_det", message: "CMのカラーグレーディングの相談です" }, h.options)

    expect(h.generate).toHaveBeenCalledOnce()
  })

  it("maps a free-text panel answer through the choice interpreter and skips the LLM", async () => {
    const h = harness(finalMediumPanelConversation())
    h.options.choiceInterpreter.mockResolvedValue({ choiceIds: ["youtube"] })
    const result = await handleChatbotMessage({ sessionId: "session_det", message: "YouTubeで公開します" }, h.options)

    expect(h.options.choiceInterpreter).toHaveBeenCalledWith(expect.objectContaining({
      choiceSet: expect.objectContaining({ id: "final-medium" }),
      message: "YouTubeで公開します",
    }))
    expect(h.generate).not.toHaveBeenCalled()
    expect(result.tier).toBe(chatbotLlmTierIds.tier0DeterministicIntake)
    expect(result.assistantMessage.content).not.toContain("最終媒体")
  })

  it("falls back to the LLM when the choice interpreter abstains", async () => {
    const h = harness(finalMediumPanelConversation())
    const result = await handleChatbotMessage({ sessionId: "session_det", message: "まだ決まっていなくて相談したいです" }, h.options)

    expect(h.options.choiceInterpreter).toHaveBeenCalledOnce()
    expect(h.generate).toHaveBeenCalledOnce()
    expect(result.tier).toBe(chatbotLlmTierIds.tier1HostedChromeNotionAi)
  })

  it("does not ask the choice interpreter about explicit panel submissions", async () => {
    const h = harness(jobKindPanelConversation())
    await handleChatbotMessage({ sessionId: "session_det", message: "選択: Web CM / CM" }, h.options)

    expect(h.options.choiceInterpreter).not.toHaveBeenCalled()
  })
})
