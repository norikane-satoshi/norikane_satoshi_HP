import { conditionChoiceSet } from "@/lib/chatbot/domain/survey-choice"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

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
  conditionAnswers: {
    "job-kind": { status: "answered", selectedIds: ["cm"] },
    "project-length": { status: "answered", composition: [{ count: 1, durationSeconds: 30 }] },
    "final-medium": { status: "answered", selectedIds: ["web"] },
    "delivery-format": { status: "answered", text: "ProRes" },
    "additional-work": { status: "answered", selectedIds: ["none"] },
    "documentary-attachment": { status: "answered", selectedIds: ["none"] },
    "work-site": { status: "answered", selectedIds: ["remote-grading"] },
  },
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

describe("structured condition persistence and editing", () => {
  it.each([
    { jobKind: "cm" as const, composition: [{ name: "Main", count: 3, durationSeconds: 15 }, { name: "Extra", count: 2, durationSeconds: 30 }], message: "Opaque display text", minutes: 1.75 },
    { jobKind: "cm" as const, composition: [{ name: "CM", count: 3, durationSeconds: 30 }], message: "CM 30秒 × 3本", minutes: 1.5 },
    { jobKind: "live" as const, composition: [{ name: "Main", count: 1, durationSeconds: 120 * 60 }, { name: "Extra", count: 1, durationSeconds: 20 * 60 }], message: "ライブ120分＋20分", minutes: 140 },
  ])("stores $jobKind composition as $minutes minutes without reparsing display text", async ({ jobKind, composition, message, minutes }) => {
    const existing = conversation({ messages: [msg("a1", "assistant", "old arbitrary copy")], activeChoices: conditionChoiceSet("project-length"), conversationState: { conditionAnswers: { "job-kind": { status: "answered", selectedIds: [jobKind] } }, hasJobKind: true } })
    existing.context.jobContext = { ...existing.context.jobContext, jobKind }
    const h = harness(existing)
    const result = await handleChatbotMessage({ sessionId: "session_panels", message, clientUserMessageId: "native-duration", conditionAnswer: { conditionId: "project-length", answer: { status: "answered", composition, sourceMessageId: "forged" } } }, h.options)
    expect(h.generate).not.toHaveBeenCalled()
    expect(persistedState(h).conditionAnswers?.["project-length"]).toEqual({ status: "answered", composition, sourceMessageId: result.userMessage.id })
    expect(h.repository.updateConversationRouting.mock.calls.at(-1)?.[0]?.jobContext?.projectLengthMinutes).toBe(minutes)
  })

  it("replays stored IDs after copy changes and removes future answers when editing", async () => {
    const lengthPanel = conditionChoiceSet("project-length")
    const kindPanel = conditionChoiceSet("job-kind")
    const h = harness(conversation({ messages: [msg("kind", "user", "Opaque kind"), msg("a1", "assistant", "changed question copy"), msg("length", "user", "Opaque composition"), msg("a2", "assistant", "changed material copy"), msg("future", "user", "Opaque material")], activeChoices: referenceUrlChoices, conversationState: {
      conditionAnswers: { "job-kind": { status: "answered", selectedIds: ["cm"], sourceMessageId: "kind" }, "project-length": { status: "answered", composition: [{ count: 1, durationSeconds: 90 }], sourceMessageId: "length" }, "material-timing": { status: "answered", date: "2026-10-15", sourceMessageId: "future" } },
      choiceAnswers: { kind: { choiceSet: kindPanel, selectedIds: ["cm"], selectedLabels: ["Web CM / CM"] }, length: { choiceSet: lengthPanel, selectedIds: [], selectedLabels: [] }, future: { choiceSet: materialTimingChoices, selectedIds: [], selectedLabels: [] } },
    } }))
    await handleChatbotMessage({ sessionId: "session_panels", message: "New opaque composition", editTargetMessageId: "length", clientUserMessageId: "edited-length", conditionAnswer: { conditionId: "project-length", answer: { composition: [{ count: 2, durationSeconds: 60 }] } } }, h.options)
    const state = persistedState(h)
    expect(state.conditionAnswers?.["job-kind"]?.selectedIds).toEqual(["cm"])
    expect(state.conditionAnswers?.["project-length"]?.composition).toEqual([{ count: 2, durationSeconds: 60 }])
    expect(state.conditionAnswers).not.toHaveProperty("material-timing")
    expect(state.choiceAnswers).not.toHaveProperty("future")
    expect(h.repository.updateConversationRouting.mock.calls.at(-1)?.[0]?.jobContext?.projectLengthMinutes).toBe(2)
  })
})

describe("delivery and material date intake", () => {
  it("asks only the material ready date before reference URLs", () => {
    const jobContext = { jobKind: "cm-30s" as const, finalMedium: "web" as const, documentaryAttachment: { kind: "none" as const }, workSite: "remote-grading" as const }
    const state = { hasReferenceUrls: false, hasContactEmail: false, hasDesiredSchedule: false, ...beforeMaterials } as ConversationState
    expect(decideRoutingFallback({ jobContext, conversationState: state })).toMatchObject({ kind: "continue", presentChoices: { id: "material-timing" } })
    expect(decideRoutingFallback({ jobContext, conversationState: { ...state, hasMaterialTiming: true, conditionAnswers: { ...state.conditionAnswers, "material-timing": { status: "unknown" } }, materialHandoff: { timing: "未確認" } } })).toMatchObject({ kind: "continue", presentChoices: { id: "reference-urls" } })
  })

  it.each(["ProRes 422 HQ / Rec.709", "未定"])("records an explicit delivery format without the LLM: %s", async (answer) => {
    const h = harness(conversation({ messages: [msg("a1", "assistant", panelText(deliveryFormatChoices))], activeChoices: deliveryFormatChoices, conversationState: { ...beforeMaterials, hasDeliveryFormat: false, conditionAnswers: Object.fromEntries(Object.entries(beforeMaterials.conditionAnswers ?? {}).filter(([id]) => id !== "delivery-format")) } }))
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
      conversationState: { ...beforeMaterials, hasMaterialDetails: true, hasMaterialTiming: true, hasMaterialHandoff: true, conditionAnswers: { ...beforeMaterials.conditionAnswers, "material-timing": { status: "unknown" } }, materialHandoff: { contents: "a", timing: "b", method: "c" } },
    }))
    const result = await handleChatbotMessage(
      { sessionId: "session_panels", message: "選択: URLを入力する\nその他コメント: https://example.com/ref" },
      h.options,
    )

    expect(h.generate).not.toHaveBeenCalled()
    expect(persistedState(h).hasReferenceUrls).toBe(true)
    expect(persistedState(h).conditionAnswers?.["reference-urls"]).toMatchObject({ selectedIds: ["other"], otherComment: "https://example.com/ref", sourceMessageId: result.userMessage.id })
    expect(result.assistantMessage.content).toContain("メール")
  })

  it("accepts a reference URL typed into the chat input", async () => {
    const h = harness(conversation({
      messages: [msg("u1", "user", "CMの相談です"), msg("a1", "assistant", panelText(referenceUrlChoices))],
      activeChoices: referenceUrlChoices,
      conversationState: { ...beforeMaterials, hasMaterialDetails: true, hasMaterialTiming: true, hasMaterialHandoff: true, conditionAnswers: { ...beforeMaterials.conditionAnswers, "material-timing": { status: "unknown" } }, materialHandoff: { contents: "a", timing: "b", method: "c" } },
    }))
    const result = await handleChatbotMessage({ sessionId: "session_panels", message: "https://example.com/ref" }, h.options)

    expect(h.generate).not.toHaveBeenCalled()
    expect(persistedState(h).hasReferenceUrls).toBe(true)
    expect(persistedState(h).conditionAnswers?.["reference-urls"]).toMatchObject({ selectedIds: ["other"], otherComment: "https://example.com/ref", sourceMessageId: result.userMessage.id })
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


describe("delivery deadline condition intake", () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-11T00:00:00Z")) })
  afterEach(() => { vi.useRealTimers() })
  const ready = { ...beforeMaterials, hasMaterialTiming: true, hasReferenceUrls: true, hasContactEmail: true, contactEmail: "client@example.com", conditionAnswers: { ...beforeMaterials.conditionAnswers, "material-timing": { status: "unknown" as const }, "reference-urls": { status: "answered" as const, selectedIds: ["none"] } } }
  it.each(["未定", "まだ決まっていない", "相談したい", "10/25", "10月25日", "2026/10/25", "納品希望日: 未定", "納期: 10/25"])("stores a typed deadline and offers its optional reason: %s", async (answer) => {
    const panel = conditionChoiceSet("desired-delivery-date")
    const h = harness(conversation({ messages: [msg("a1", "assistant", panelText(panel))], activeChoices: panel, conversationState: ready }))
    const result = await handleChatbotMessage({ sessionId: "session_panels", message: answer }, h.options)
    expect(h.generate).not.toHaveBeenCalled()
    expect(persistedState(h).conditionAnswers?.[panel.id]).toMatchObject(/25/u.test(answer) ? { status: "answered", date: "2026-10-25", sourceMessageId: result.userMessage.id } : { status: "unknown", sourceMessageId: result.userMessage.id })
    expect(result.ui).toMatchObject({ kind: "choice-panel", choiceSet: { id: "delivery-date-reason" } })
  })
  it.each([{ status: "unknown" as const }, { date: "2026-10-25" }])("uses the structured button answer instead of its display text: %j", async (answer) => {
    const panel = conditionChoiceSet("desired-delivery-date")
    const h = harness(conversation({ messages: [msg("a1", "assistant", panelText(panel))], activeChoices: panel, conversationState: ready }))
    const result = await handleChatbotMessage({ sessionId: "session_panels", message: "Opaque button display", conditionAnswer: { conditionId: panel.id, answer } }, h.options)
    expect(h.generate).not.toHaveBeenCalled()
    expect(persistedState(h).conditionAnswers?.[panel.id]).toMatchObject(answer)
    expect(result.ui).toMatchObject({ kind: "choice-panel", choiceSet: { id: "delivery-date-reason" } })
  })
  it.each(["試写会に合わせたい", "スキップ"])("finishes the optional reason without repeating the deadline: %s", async (answer) => {
    const panel = conditionChoiceSet("delivery-date-reason")
    const h = harness(conversation({ messages: [msg("a1", "assistant", panelText(panel))], activeChoices: panel, conversationState: { ...ready, conditionAnswers: { ...ready.conditionAnswers, "desired-delivery-date": { status: "unknown" } } } }))
    const result = await handleChatbotMessage({ sessionId: "session_panels", message: answer }, h.options)
    expect(h.generate).not.toHaveBeenCalled()
    expect(persistedState(h).conditionAnswers?.[panel.id]).toMatchObject(answer === "スキップ" ? { status: "unknown" } : { status: "answered", text: answer })
    expect(result.ui).toMatchObject({ kind: "booking-card" })
  })
})
