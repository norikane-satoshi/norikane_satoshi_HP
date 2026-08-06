import { describe, expect, it } from "vitest"

import type { ConversationState, JobContext } from "@/lib/chatbot/domain"
import { decideRoutingFallback } from "@/lib/chatbot/server/routing"

function conversationState(overrides: Partial<ConversationState> = {}): ConversationState {
  return {
    hasFinalMedium: false,
    hasJobKind: false,
    hasAdditionalWork: false,
    hasDocumentaryAttachments: false,
    hasWorkSite: false,
    hasReferenceUrls: false,
    hasContactEmail: false,
    hasDesiredSchedule: false,
    turnCount: 1,
    ...overrides,
  }
}

function jobContext(overrides: Partial<JobContext> = {}): JobContext {
  return { documentaryAttachment: { kind: "none" }, ...overrides } as JobContext
}

function route(latestUserMessage: string) {
  return decideRoutingFallback({
    jobContext: jobContext(),
    conversationState: conversationState(),
    latestUserMessage,
  })
}

// Production requestId 1727da5a-d9ac-4cfc-8acb-0f8396a97d1d asked for a rate card and stayed in
// plain conversation with ui=none. The protective branch existed but nothing ever fed it, so the
// only thing keeping prices out of the answer was the prompt.
describe("pricing questions reach the protective branch", () => {
  it("routes a direct rate request to the direct contact card", () => {
    const decision = route("カラーグレーディングの料金はいくらですか？単価表を見せてください。")

    expect(decision.kind).toBe("to-direct-contact")
    if (decision.kind !== "to-direct-contact") return
    expect(decision.reason).toBe("pricing")
    expect(decision.requireEmail).toBe(true)
  })

  it("recognises the common ways customers ask about money", () => {
    for (const message of [
      "費用はどのくらいかかりますか",
      "おいくらになりますか？",
      "お見積りをお願いできますか",
      "How much would colour grading cost?",
      "ギャラはいくらでしょうか",
    ]) {
      expect(route(message).kind, message).toBe("to-direct-contact")
    }
  })

  it("leaves ordinary project talk in the normal flow", () => {
    for (const message of [
      "Web公開の30秒CMのカラーグレーディングをお願いしたいです。",
      "納期はいつごろになりますか",
      "素材は編集済みで、9月中旬までに納品したいです。",
      "予算内に収まるよう内容を相談したいです",
      "選択: Web CM / CM",
    ]) {
      expect(route(message).kind, message).not.toBe("to-direct-contact")
    }
  })

  it("keeps honouring an explicit state flag", () => {
    const decision = decideRoutingFallback({
      jobContext: jobContext(),
      conversationState: conversationState({ asksPricing: true }),
    })

    expect(decision.kind).toBe("to-direct-contact")
  })
})
