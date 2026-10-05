import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({ prisma: {} }))

import type { ChatbotConversation, ChatbotMessage, ConversationState, SurveyChoiceSet } from "@/lib/chatbot/domain"
import {
  jobKindChoices,
  deliveryFormatChoices,
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
  hasDeliveryFormat: true,
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

describe("delivery and material date intake", () => {
  it("asks only the material ready date before reference URLs", () => {
    const jobContext = { jobKind: "cm-30s" as const, finalMedium: "web" as const, documentaryAttachment: { kind: "none" as const }, workSite: "remote-grading" as const }
    const state = { hasReferenceUrls: false, hasContactEmail: false, hasDesiredSchedule: false, ...beforeMaterials } as ConversationState
    expect(decideRoutingFallback({ jobContext, conversationState: state })).toMatchObject({ kind: "continue", presentChoices: { id: "material-timing" } })
    expect(decideRoutingFallback({ jobContext, conversationState: { ...state, hasMaterialTiming: true, materialHandoff: { timing: "未確認" } } })).toMatchObject({ kind: "continue", presentChoices: { id: "reference-urls" } })
  })

  it.each(["ProRes 422 HQ / Rec.709", "未定"])("records an explicit delivery format without the LLM: %s", async (answer) => {
    const h = harness(conversation({ messages: [msg("a1", "assistant", panelText(deliveryFormatChoices))], activeChoices: deliveryFormatChoices, conversationState: { ...beforeMaterials, hasDeliveryFormat: false } }))
    const result = await handleChatbotMessage({ sessionId: "session_panels", message: `納品形式: ${answer}` }, h.options)
    expect(h.generate).not.toHaveBeenCalled()
    expect(persistedState(h)).toMatchObject({ hasDeliveryFormat: true, deliveryFormat: answer === "未定" ? "未確認" : answer })
    expect(result.ui).toMatchObject({ kind: "choice-panel", choiceSet: { id: "material-timing" } })
  })

  it.each(["2026-10-15", "未定"])("records the material date without the LLM: %s", async (answer) => {
    const h = harness(conversation({ messages: [msg("a1", "assistant", panelText(materialTimingChoices))], activeChoices: materialTimingChoices, conversationState: beforeMaterials }))
    await handleChatbotMessage({ sessionId: "session_panels", message: `素材が揃う日: ${answer}` }, h.options)
    expect(h.generate).not.toHaveBeenCalled()
    expect(persistedState(h)).toMatchObject({ hasMaterialTiming: true, materialHandoff: { timing: answer === "未定" ? "未確認" : answer } })
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
    expect(result.ui).toMatchObject({ kind: "duration-input" })
  })

  it("still uses the LLM for a typed first message", async () => {
    const h = harness({ ...conversation({ messages: [] }), context: { sessionId: "session_panels" } })
    await handleChatbotMessage({ sessionId: "session_panels", message: "CMのカラーグレーディングの相談です" }, h.options)

    expect(h.generate).toHaveBeenCalledOnce()
  })
})

describe("time choices", () => {
  it("offers the approved timing labels", () => {
    expect(materialTimingChoices.choices.map((choice) => choice.label)).toEqual(["未定"])
  })
})
