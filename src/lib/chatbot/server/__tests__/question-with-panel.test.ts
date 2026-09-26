import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({ prisma: {} }))

import type { ChatbotConversation, ChatbotMessage, ConversationState, SurveyChoiceSet } from "@/lib/chatbot/domain"
import { cmProjectLengthChoices } from "@/lib/chatbot/domain"
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

function harness(
  existing: ChatbotConversation,
  reply: { raw: string; tier: (typeof chatbotLlmTierIds)[keyof typeof chatbotLlmTierIds] } = {
    raw: "<customer_reply>LLM本文</customer_reply>",
    tier: chatbotLlmTierIds.tier1HostedChromeNotionAi,
  },
) {
  const generate = vi.fn(async () => ({
    rawText: reply.raw,
    displayEnvelope: createChatbotLlmDisplayEnvelope(reply.raw),
    tier: reply.tier,
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

const projectLengthPanelConversation = () =>
  conversation({
    messages: [
      msg("u1", "user", "選択: Web CM / CM"),
      msg("a1", "assistant", "CM / Web CM の尺・本数を選んでください\n下の選択肢から選んでください。"),
    ],
    activeChoices: cmProjectLengthChoices,
    conversationState: { hasJobKind: true, turnCount: 1 },
    jobContext: { jobKind: "cm-30s" },
  })

const answer = "<customer_reply>作業期間は尺と素材の状態で変わります。尺を選んでいただければ目安をお伝えします。</customer_reply>"

describe("a question typed while a panel is shown", () => {
  it("shows the model's answer above the panel prompt instead of dropping it", async () => {
    const h = harness(projectLengthPanelConversation(), { raw: answer, tier: chatbotLlmTierIds.tier1HostedChromeNotionAi })
    const result = await handleChatbotMessage({ sessionId: "session_det", message: "作業期間はどれくらいですか？" }, h.options)

    expect(h.generate).toHaveBeenCalledOnce()
    expect(result.ui).toMatchObject({ kind: "choice-panel", choiceSet: { id: cmProjectLengthChoices.id } })
    expect(result.assistantMessage.content).toContain("作業期間は尺と素材の状態で変わります")
    expect(result.assistantMessage.content).toContain("下の選択肢から選んでください。")
  })

  it("keeps a Tier 2 answer that came without structured UI", async () => {
    const h = harness(projectLengthPanelConversation(), { raw: answer, tier: chatbotLlmTierIds.tier2GeminiFlash })
    const result = await handleChatbotMessage({ sessionId: "session_det", message: "作業期間はどれくらいですか？" }, h.options)

    expect(result.ui).toMatchObject({ kind: "choice-panel", choiceSet: { id: cmProjectLengthChoices.id } })
    expect(result.assistantMessage.content).toContain("作業期間は尺と素材の状態で変わります")
    expect(result.assistantMessage.content).toContain("下の選択肢から選んでください。")
  })

  it("still shows only the panel prompt when the customer did not ask anything", async () => {
    const h = harness(projectLengthPanelConversation(), { raw: answer, tier: chatbotLlmTierIds.tier1HostedChromeNotionAi })
    const result = await handleChatbotMessage({ sessionId: "session_det", message: "よろしくお願いします" }, h.options)

    expect(result.assistantMessage.content).not.toContain("作業期間は尺と素材の状態で変わります")
  })

  it("shows a duration answer that matches the workflow estimate", async () => {
    const h = harness(projectLengthPanelConversation(), {
      raw: "<customer_reply>Web CM 30秒なら、作業期間の目安は1〜2日です。</customer_reply>",
      tier: chatbotLlmTierIds.tier2GeminiFlash,
    })
    const result = await handleChatbotMessage({ sessionId: "session_det", message: "作業期間はどれくらいですか？" }, h.options)

    expect(result.assistantMessage.content).toContain("1〜2日")
    expect(result.ui).toMatchObject({ kind: "choice-panel" })
  })

  it("drops a closing counter-question so the panel prompt is the only ask", async () => {
    const h = harness(projectLengthPanelConversation(), {
      raw: "<customer_reply>作業期間は尺と素材の状態で変わります。ご予定の媒体を詳しく教えていただけますでしょうか？</customer_reply>",
      tier: chatbotLlmTierIds.tier2GeminiFlash,
    })
    const result = await handleChatbotMessage({ sessionId: "session_det", message: "作業期間はどれくらいですか？" }, h.options)

    expect(result.assistantMessage.content).toContain("作業期間は尺と素材の状態で変わります。")
    expect(result.assistantMessage.content).not.toContain("教えていただけますでしょうか")
    expect(result.assistantMessage.content).toContain("下の選択肢から選んでください。")
    expect(result.ui).toMatchObject({ kind: "choice-panel" })
  })

  it("drops a closing request phrased without a question mark", async () => {
    const h = harness(projectLengthPanelConversation(), {
      raw: "<customer_reply>作業期間は尺と素材の状態で変わります。\nご予定の本数も教えてください。</customer_reply>",
      tier: chatbotLlmTierIds.tier1HostedChromeNotionAi,
    })
    const result = await handleChatbotMessage({ sessionId: "session_det", message: "作業期間はどれくらいですか？" }, h.options)

    expect(result.assistantMessage.content).toContain("作業期間は尺と素材の状態で変わります。")
    expect(result.assistantMessage.content).not.toContain("教えてください")
  })

  it("shows only the panel prompt when the answer is nothing but a counter-question", async () => {
    const h = harness(projectLengthPanelConversation(), {
      raw: "<customer_reply>どの媒体で使う予定ですか？</customer_reply>",
      tier: chatbotLlmTierIds.tier2GeminiFlash,
    })
    const result = await handleChatbotMessage({ sessionId: "session_det", message: "作業期間はどれくらいですか？" }, h.options)

    expect(result.assistantMessage.content).not.toContain("どの媒体で使う予定ですか")
    expect(result.assistantMessage.content).toContain("下の選択肢から選んでください。")
  })

  it("tells the model to answer without asking back while a panel waits", async () => {
    const h = harness(projectLengthPanelConversation(), { raw: answer, tier: chatbotLlmTierIds.tier2GeminiFlash })
    await handleChatbotMessage({ sessionId: "session_det", message: "作業期間はどれくらいですか？" }, h.options)

    const request = (h.generate.mock.calls[0] as unknown as [{ systemPrompt: string }])[0]
    expect(request.systemPrompt).toContain("選択肢パネルの回答待ちの間に質問された場合")
  })
})
