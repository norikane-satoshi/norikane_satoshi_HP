import { describe, expect, it } from "vitest"

import type { ConversationState, JobContext } from "@/lib/chatbot/domain"
import {
  applyBookingFinalConfirmationPolicy,
  getMissingBookingReadinessSlots,
} from "@/lib/chatbot/server/flow-policy"
import { applyMaterialHandoffAnswer } from "@/lib/chatbot/server/material-handoff"
import { decideRoutingFallback } from "@/lib/chatbot/server/routing"

function readyState(overrides: Partial<ConversationState> = {}): ConversationState {
  return {
    hasFinalMedium: true,
    hasJobKind: true,
    hasProjectLength: true,
    hasMaterialHandoff: false,
    hasMaterialDetails: false,
    hasMaterialTiming: false,
    hasAdditionalWork: true,
    hasDocumentaryAttachments: true,
    hasWorkSite: true,
    hasReferenceUrls: true,
    hasContactEmail: true,
    hasDesiredSchedule: false,
    contactEmail: "client@example.jp",
    turnCount: 8,
    ...overrides,
  }
}

const jobContext: JobContext = {
  jobKind: "live-60m",
  finalMedium: "youtube",
  projectLengthMinutes: 90,
  workSite: "remote-grading",
  documentaryAttachment: { kind: "none" },
}

describe("material handoff before Booking Order", () => {
  it("stores what, when, and how from the three guided answers", () => {
    const withContents = applyMaterialHandoffAnswer({
      conversationState: readyState(),
      previousAssistantMessage: "何の素材をお送りいただく予定ですか？",
      latestUserMessage: "ProRes書き出しと撮影素材の使用クリップです",
    })
    const withTiming = applyMaterialHandoffAnswer({
      conversationState: withContents,
      previousAssistantMessage: "その素材は、いつお送りいただけそうですか？",
      latestUserMessage: "9月1日です",
    })
    const complete = applyMaterialHandoffAnswer({
      conversationState: withTiming,
      previousAssistantMessage: "素材の受け渡し方法を教えてください",
      latestUserMessage: "SSDをバイク便で送ります",
    })

    expect(complete).toMatchObject({
      hasMaterialDetails: true,
      hasMaterialTiming: true,
      hasMaterialHandoff: true,
      materialHandoff: {
        contents: "ProRes書き出しと撮影素材の使用クリップです",
        timing: "9月1日です",
        method: "SSDをバイク便で送ります",
      },
    })
  })

  it("asks what material will be sent first", () => {
    expect(decideRoutingFallback({ jobContext, conversationState: readyState() })).toMatchObject({
      kind: "continue",
      nextQuestion: expect.stringMatching(/何の素材/u),
    })
  })

  it("asks when the material will be sent after its contents are known", () => {
    expect(
      decideRoutingFallback({
        jobContext,
        conversationState: readyState({
          hasMaterialDetails: true,
          materialHandoff: { contents: "ProResと使用クリップ" },
        }),
      }),
    ).toMatchObject({
      kind: "continue",
      nextQuestion: expect.stringMatching(/いつ/u),
    })
  })

  it("asks how the material will be sent after contents and timing are known", () => {
    expect(
      decideRoutingFallback({
        jobContext,
        conversationState: readyState({
          hasMaterialDetails: true,
          hasMaterialTiming: true,
          materialHandoff: { contents: "ProResと使用クリップ", timing: "9月1日" },
        }),
      }),
    ).toMatchObject({
      kind: "continue",
      nextQuestion: expect.stringMatching(/どういう方法|受け渡し方法/u),
    })
  })

  it("does not consider booking ready until what, when, and how are all stored", () => {
    expect(getMissingBookingReadinessSlots(readyState(), { jobContext })).toEqual(
      expect.arrayContaining(["material-contents", "material-timing", "material-method"]),
    )

    expect(
      getMissingBookingReadinessSlots(
        readyState({
          hasMaterialDetails: true,
          hasMaterialTiming: true,
          hasMaterialHandoff: true,
          materialHandoff: {
            contents: "撮影素材一式",
            timing: "9月1日",
            method: "SSDをバイク便",
          },
        }),
        { jobContext },
      ),
    ).not.toEqual(expect.arrayContaining(["material-contents", "material-timing", "material-method"]))
  })

  it.each([
    [readyState(), /何の素材/u],
    [
      readyState({
        hasMaterialDetails: true,
        materialHandoff: { contents: "ProResと使用クリップ" },
      }),
      /いつ/u,
    ],
    [
      readyState({
        hasMaterialDetails: true,
        hasMaterialTiming: true,
        materialHandoff: { contents: "ProResと使用クリップ", timing: "9月1日" },
      }),
      /受け渡し方法/u,
    ],
  ] as const)("normalizes an early LLM material-method prompt into the required order", (conversationState, expected) => {
    const methodFirstDecision = {
      kind: "continue" as const,
      nextQuestion: "素材はどの方法でお渡しいただく予定ですか？",
      presentChoices: {
        id: "material-method",
        question: "素材はどの方法でお渡しいただく予定ですか？",
        choices: [
          { id: "courier", label: "バイク便" },
          { id: "uploader", label: "アップローダー・クラウド共有" },
        ],
      },
    }

    const result = applyBookingFinalConfirmationPolicy({
      routingDecision: methodFirstDecision,
      fallbackRoutingDecision: decideRoutingFallback({ jobContext, conversationState }),
      conversationState,
      jobContext,
      latestUserMessage: "追加作業はありません",
      assistantText: methodFirstDecision.nextQuestion,
    })

    expect(result.routingDecision).toMatchObject({
      kind: "continue",
      nextQuestion: expect.stringMatching(expected),
    })
    expect(result.routingDecision?.kind === "continue" ? result.routingDecision.presentChoices : undefined).toBeUndefined()
  })
})
