import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({ prisma: {} }))

import type { ChatbotConversation, ChatbotMessage, ConversationState, SurveyChoiceSet } from "@/lib/chatbot/domain"
import {
  jobKindChoices,
  materialContentsChoices,
  materialHandoffMethodChoices,
  materialTimingChoices,
  referenceUrlChoices,
} from "@/lib/chatbot/domain"
import { handleChatbotMessage } from "@/lib/chatbot/server/message-handler"
import { chatbotLlmTierIds } from "@/lib/chatbot/server/llm-client"
import { createChatbotLlmDisplayEnvelope } from "@/lib/chatbot/server/llm-response-normalizer"
import { createStaticChatbotKnowledgeSnapshot } from "@/lib/chatbot/server/notion-knowledge-sync"
import { decideRoutingFallback } from "@/lib/chatbot/server/routing"

const at = "2026-09-25T00:00:00.000Z"
const msg = (id: string, role: ChatbotMessage["role"], content: string): ChatbotMessage => ({ id, role, content, createdAt: at })
const panelText = (choiceSet: SurveyChoiceSet) => `${choiceSet.question}\n下の選択肢から選んでください。`

const beforeMaterials: Partial<ConversationState> = {
  hasJobKind: true,
  hasProjectLength: true,
  hasFinalMedium: true,
  hasAdditionalWork: true,
  hasDocumentaryAttachments: true,
  hasWorkSite: true,
  turnCount: 7,
}

function conversation(input: {
  messages: ChatbotMessage[]
  activeChoices?: SurveyChoiceSet
  conversationState?: Partial<ConversationState>
}): ChatbotConversation {
  return {
    id: "conv_panels",
    startedAt: at,
    updatedAt: at,
    status: "open",
    context: {
      sessionId: "session_panels",
      ...(input.activeChoices ? { activeChoices: input.activeChoices, currentQuestion: input.activeChoices.question } : {}),
      ...(input.conversationState ? { conversationState: input.conversationState } : {}),
      jobContext: { jobKind: "cm-30s", finalMedium: "web", documentaryAttachment: { kind: "none" }, workSite: "remote-grading" },
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
  return {
    generate,
    repository,
    options: {
      repository,
      orchestratorFactory: () => ({ generate, isHealthy: vi.fn(async () => true) }),
      knowledgeSnapshotLoader: async () => snapshot,
      slackNotifier: vi.fn().mockResolvedValue({ status: "skipped", reason: "disabled" }),
      candidateWindowFinder: vi.fn().mockResolvedValue([]),
      choiceInterpreter: vi.fn().mockResolvedValue(null),
    },
  }
}

function persistedState(h: ReturnType<typeof harness>) {
  return h.repository.updateConversationRouting.mock.calls.at(-1)?.[0]?.conversationState as ConversationState
}

describe("material and reference intake questions are choice panels", () => {
  it("asks materials, timing, handoff method and reference URLs with choice panels", () => {
    const base = { jobContext: { jobKind: "cm-30s" as const, finalMedium: "web" as const, documentaryAttachment: { kind: "none" as const }, workSite: "remote-grading" as const } }
    const state = (patch: Partial<ConversationState>) => ({
      hasReferenceUrls: false,
      hasContactEmail: false,
      hasDesiredSchedule: false,
      ...beforeMaterials,
      ...patch,
    }) as ConversationState
    const ids = [
      decideRoutingFallback({ ...base, conversationState: state({}) }),
      decideRoutingFallback({ ...base, conversationState: state({ hasMaterialDetails: true, materialHandoff: { contents: "撮影素材一式" } }) }),
      decideRoutingFallback({ ...base, conversationState: state({ hasMaterialDetails: true, hasMaterialTiming: true, materialHandoff: { contents: "a", timing: "b" } }) }),
      decideRoutingFallback({ ...base, conversationState: state({ hasMaterialDetails: true, hasMaterialTiming: true, hasMaterialHandoff: true, materialHandoff: { contents: "a", timing: "b", method: "c" } }) }),
    ].map((decision) => (decision.kind === "continue" ? decision.presentChoices?.id : decision.kind))
    expect(ids).toEqual(["material-contents", "material-timing", "material-handoff-method", "reference-urls"])
  })

  it("records a material choice without calling the LLM and moves to the timing panel", async () => {
    const h = harness(conversation({
      messages: [msg("u1", "user", "CMの相談です"), msg("a1", "assistant", panelText(materialContentsChoices))],
      activeChoices: materialContentsChoices,
      conversationState: beforeMaterials,
    }))
    const result = await handleChatbotMessage({ sessionId: "session_panels", message: "選択: 撮影素材一式" }, h.options)

    expect(h.generate).not.toHaveBeenCalled()
    expect(result.tier).toBe(chatbotLlmTierIds.tier0DeterministicIntake)
    expect(persistedState(h).materialHandoff?.contents).toBe("撮影素材一式")
    expect(result.ui).toMatchObject({ kind: "choice-panel", choiceSet: { id: "material-timing" } })
  })

  it("stores the other comment itself as the handoff method", async () => {
    const h = harness(conversation({
      messages: [msg("u1", "user", "CMの相談です"), msg("a1", "assistant", panelText(materialHandoffMethodChoices))],
      activeChoices: materialHandoffMethodChoices,
      conversationState: { ...beforeMaterials, hasMaterialDetails: true, hasMaterialTiming: true, materialHandoff: { contents: "a", timing: "b" } },
    }))
    await handleChatbotMessage({ sessionId: "session_panels", message: "選択: その他\nその他コメント: 共有ドライブ" }, h.options)

    expect(h.generate).not.toHaveBeenCalled()
    expect(persistedState(h).materialHandoff?.method).toBe("共有ドライブ")
    expect(persistedState(h).hasMaterialHandoff).toBe(true)
  })

  it("accepts a reference URL entered through the panel", async () => {
    const h = harness(conversation({
      messages: [msg("u1", "user", "CMの相談です"), msg("a1", "assistant", panelText(referenceUrlChoices))],
      activeChoices: referenceUrlChoices,
      conversationState: { ...beforeMaterials, hasMaterialDetails: true, hasMaterialTiming: true, hasMaterialHandoff: true, materialHandoff: { contents: "a", timing: "b", method: "c" } },
    }))
    const result = await handleChatbotMessage(
      { sessionId: "session_panels", message: "選択: URLを入力する\nその他コメント: https://example.com/ref" },
      h.options,
    )

    expect(h.generate).not.toHaveBeenCalled()
    expect(persistedState(h).hasReferenceUrls).toBe(true)
    expect(result.assistantMessage.content).toContain("メール")
  })

  it("accepts a reference URL typed into the chat input", async () => {
    const h = harness(conversation({
      messages: [msg("u1", "user", "CMの相談です"), msg("a1", "assistant", panelText(referenceUrlChoices))],
      activeChoices: referenceUrlChoices,
      conversationState: { ...beforeMaterials, hasMaterialDetails: true, hasMaterialTiming: true, hasMaterialHandoff: true, materialHandoff: { contents: "a", timing: "b", method: "c" } },
    }))
    const result = await handleChatbotMessage({ sessionId: "session_panels", message: "https://example.com/ref" }, h.options)

    expect(h.generate).not.toHaveBeenCalled()
    expect(persistedState(h).hasReferenceUrls).toBe(true)
    expect(result.assistantMessage.content).toContain("メール")
  })
})

describe("job-kind panel shown before the first message", () => {
  it("answers a click on the opening panel without calling the LLM", async () => {
    const h = harness({ ...conversation({ messages: [] }), context: { sessionId: "session_panels" } })
    const result = await handleChatbotMessage({ sessionId: "session_panels", message: `選択: ${jobKindChoices.choices[0].label}` }, h.options)

    expect(h.generate).not.toHaveBeenCalled()
    expect(result.tier).toBe(chatbotLlmTierIds.tier0DeterministicIntake)
    expect(persistedState(h).hasJobKind).toBe(true)
    expect(result.ui).toMatchObject({ kind: "choice-panel", choiceSet: { id: "project-length" } })
  })

  it("still uses the LLM for a typed first message", async () => {
    const h = harness({ ...conversation({ messages: [] }), context: { sessionId: "session_panels" } })
    await handleChatbotMessage({ sessionId: "session_panels", message: "CMのカラーグレーディングの相談です" }, h.options)

    expect(h.generate).toHaveBeenCalledOnce()
  })
})

describe("time choices", () => {
  it("offers the approved timing labels", () => {
    expect(materialTimingChoices.choices.map((choice) => choice.label)).toEqual(["1週間以内", "2〜3週間以内", "1か月以上先", "未定"])
  })
})
