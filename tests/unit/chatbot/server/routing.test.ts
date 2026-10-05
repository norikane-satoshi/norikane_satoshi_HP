import { describe, expect, it } from "vitest"

import type { ConversationState, JobContext } from "@/lib/chatbot/domain"
import {
  additionalWorkChoices,
  bookingFinalConfirmationChoices,
  finalMediumChoices,
  jobKindChoices,
  workSiteChoices,
} from "@/lib/chatbot/domain"
import {
  settledConversationTurnThreshold,
  tightDeadlineThresholdDays,
  tightishDeadlineMaxDays,
} from "@/lib/chatbot/knowledge/workflow-duration"
import { decideRoutingFallback } from "@/lib/chatbot/server/routing"
import { getMissingBookingReadinessSlots } from "@/lib/chatbot/server/flow-policy"

function jobContext(overrides: Partial<JobContext> = {}): JobContext {
  return {
    jobKind: "cm-30s",
    finalMedium: "web",
    workSite: "satoshi-studio",
    documentaryAttachment: { kind: "none" },
    preferredStartDate: "2026-07-01",
    ...overrides,
  }
}

function conversationState(overrides: Partial<ConversationState> = {}): ConversationState {
  return {
    hasFinalMedium: true,
    hasJobKind: true,
    hasProjectLength: true,
    hasAdditionalWork: true,
    hasDocumentaryAttachments: true,
    hasWorkSite: true,
    hasMaterialDetails: true,
    hasMaterialTiming: true,
    hasMaterialHandoff: true,
    hasReferenceUrls: true,
    hasContactEmail: true,
    hasDesiredSchedule: true,
    turnCount: settledConversationTurnThreshold,
    contactEmail: "client@example.com",
    customerName: "Client",
    materialHandoff: {
      contents: "撮影素材一式",
      timing: "未定",
      method: "アップローダー",
    },
    ...overrides,
  }
}

describe("chatbot fallback router", () => {
  it("starts production consultations with job kind choices", () => {
    const result = decideRoutingFallback({
      jobContext: jobContext({ jobKind: undefined }),
      conversationState: conversationState({
        hasJobKind: false,
        hasContactEmail: false,
        hasDesiredSchedule: false,
      }),
    })

    expect(result).toMatchObject({
      kind: "continue",
      presentChoices: jobKindChoices,
    })
    expect(result.kind).toBe("continue")
    if (result.kind !== "continue") return
    const labels = result.presentChoices?.choices.map((choice) => choice.label) ?? []
    expect(labels).not.toContain("カラーグレーディング相談")
    expect(labels).not.toContain("カラーコレクション相談")
  })

  it("continues with final medium choices when final medium is missing", () => {
    const result = decideRoutingFallback({
      jobContext: jobContext(),
      conversationState: conversationState({
        hasFinalMedium: false,
        hasContactEmail: false,
        hasDesiredSchedule: false,
      }),
    })

    expect(result).toMatchObject({
      kind: "continue",
      presentChoices: finalMediumChoices,
    })
  })

  it.each(["drama-first", "live-60m", "cm-30s", "mv-5m"] as const)("requests exact duration without buckets for %s", (jobKind) => {
    const result = decideRoutingFallback({ jobContext: jobContext({ jobKind }), conversationState: conversationState({ hasProjectLength: false }) })
    expect(result).toMatchObject({ kind: "continue", presentChoices: { id: "project-length", choices: [] } })
  })

  it("continues with additional work choices after final medium and job kind are collected", () => {
    const result = decideRoutingFallback({
      jobContext: jobContext(),
      conversationState: conversationState({
        hasAdditionalWork: false,
        hasContactEmail: false,
        hasDesiredSchedule: false,
      }),
    })

    expect(result).toMatchObject({
      kind: "continue",
      presentChoices: additionalWorkChoices,
    })
  })

  it("continues with work site choices when work site is missing", () => {
    const result = decideRoutingFallback({
      jobContext: jobContext(),
      conversationState: conversationState({
        hasWorkSite: false,
        hasContactEmail: false,
        hasDesiredSchedule: false,
      }),
      now: new Date("2026-06-25T10:00:00+09:00"),
    })

    expect(result.kind).toBe("continue")
    if (result.kind !== "continue") return
    expect(result.presentChoices).toMatchObject({ id: workSiteChoices.id })
    expect(result.presentChoices?.choices.map((choice) => choice.id)).not.toContain("satoshi-studio")
  })

  it("can surface studio work site choices from 2026-09-15 JST", () => {
    const result = decideRoutingFallback({
      jobContext: jobContext(),
      conversationState: conversationState({
        hasWorkSite: false,
        hasContactEmail: false,
        hasDesiredSchedule: false,
      }),
      now: new Date("2026-09-15T00:00:00+09:00"),
    })

    expect(result.kind).toBe("continue")
    if (result.kind !== "continue") return
    expect(result.presentChoices?.choices.map((choice) => choice.id)).toContain("satoshi-studio")
  })

  it("does not pre-route to inline booking when schedule and contact facts are ready", () => {
    const result = decideRoutingFallback({
      jobContext: jobContext(),
      conversationState: conversationState(),
    })

    expect(result).toMatchObject({
      kind: "continue",
    })
  })

  it("asks for a deadline before final booking confirmation when none was provided", () => {
    const result = decideRoutingFallback({
      jobContext: jobContext(),
      conversationState: conversationState({
        hasDesiredSchedule: false,
      }),
    })

    expect(result).toMatchObject({
      kind: "continue",
      nextQuestion: "納期はいつごろをご希望ですか？ カレンダーで日付を選ぶか、未定・相談したいを選んでください。",
    })
    if (result.kind === "continue") expect(result.presentChoices).toBeUndefined()
    expect(getMissingBookingReadinessSlots(conversationState({ hasDesiredSchedule: false }), { jobContext: jobContext() }))
      .toContain("desired-schedule")
  })

  it("does not reopen the deadline step for a previously confirmed booking", () => {
    const state = conversationState({
      hasDesiredSchedule: false,
      bookingFinalConfirmation: { status: "confirmed", confirmedAtTurn: 8 },
    })
    expect(getMissingBookingReadinessSlots(state, { jobContext: jobContext() })).not.toContain("desired-schedule")
    expect(decideRoutingFallback({ jobContext: jobContext(), conversationState: state })).toMatchObject({
      kind: "continue",
      nextQuestion: expect.stringContaining("予約カード"),
    })
  })

  it("routes heavy retouch to direct contact before other flags", () => {
    const result = decideRoutingFallback({
      jobContext: jobContext({ heavyRetouch: true }),
      conversationState: conversationState({ technicalQuestion: true }),
    })

    expect(result).toMatchObject({
      kind: "to-direct-contact",
      reason: "heavy-retouch",
    })
  })

  it("routes tight deadline to direct contact before vfx or cg flags", () => {
    const result = decideRoutingFallback({
      jobContext: jobContext(),
      conversationState: conversationState({
        daysUntilStart: tightDeadlineThresholdDays - 1,
        vfxCgHeavy: true,
      }),
    })

    expect(result).toMatchObject({
      kind: "to-direct-contact",
      reason: "tight-deadline",
    })
    expect(result).toMatchObject({
      kind: "to-direct-contact",
      suggestedMessage: expect.stringContaining("希望日数内でも"),
    })
    expect(result).toMatchObject({
      kind: "to-direct-contact",
      suggestedMessage: expect.stringContaining("確約せず"),
    })
    expect(result).toMatchObject({
      kind: "to-direct-contact",
      suggestedMessage: expect.stringContaining("尺が未確認"),
    })
    expect(result).toMatchObject({
      kind: "to-direct-contact",
      suggestedMessage: expect.not.stringContaining("受け付けできません"),
    })
  })

  it("keeps the tight deadline boundary inclusive and the next day as continue", () => {
    const boundary = decideRoutingFallback({
      jobContext: jobContext(),
      conversationState: conversationState({ daysUntilStart: tightDeadlineThresholdDays }),
    })
    const nextDay = decideRoutingFallback({
      jobContext: jobContext(),
      conversationState: conversationState({
        daysUntilStart: tightDeadlineThresholdDays + 1,
        hasContactEmail: false,
      }),
    })

    expect(boundary).toMatchObject({
      kind: "to-direct-contact",
      reason: "tight-deadline",
    })
    expect(nextDay).toMatchObject({
      kind: "continue",
      nextQuestion: "契約書条件を確認するため 1 点伸ばさせて下さい",
    })
  })

  it("keeps the tightish deadline boundary inclusive and the next day on the normal route", () => {
    const boundary = decideRoutingFallback({
      jobContext: jobContext(),
      conversationState: conversationState({ daysUntilStart: tightishDeadlineMaxDays }),
    })
    const nextDay = decideRoutingFallback({
      jobContext: jobContext(),
      conversationState: conversationState({
        daysUntilStart: tightishDeadlineMaxDays + 1,
      }),
    })

    expect(boundary).toMatchObject({
      kind: "continue",
      nextQuestion: "契約書条件を確認するため 1 点伸ばさせて下さい",
    })
    expect(nextDay).toMatchObject({
      kind: "continue",
    })
  })

  it("routes vfx and cg-heavy work to direct contact", () => {
    const result = decideRoutingFallback({
      jobContext: jobContext(),
      conversationState: conversationState({ vfxCgHeavy: true }),
    })

    expect(result).toMatchObject({
      kind: "to-direct-contact",
      reason: "vfx-cg-heavy",
    })
  })

  it("routes technical questions to direct contact", () => {
    const result = decideRoutingFallback({
      jobContext: jobContext(),
      conversationState: conversationState({ technicalQuestion: true }),
    })

    expect(result).toMatchObject({
      kind: "to-direct-contact",
      reason: "tech-question",
    })
  })

  it("routes work review requests to direct contact", () => {
    const result = decideRoutingFallback({
      jobContext: jobContext(),
      conversationState: conversationState({ workReviewRequest: true }),
    })

    expect(result).toMatchObject({
      kind: "to-direct-contact",
      reason: "review-request",
    })
  })

  it("routes incomplete edits to direct contact", () => {
    const result = decideRoutingFallback({
      jobContext: jobContext(),
      conversationState: conversationState({ editingIncomplete: true }),
    })

    expect(result).toMatchObject({
      kind: "to-direct-contact",
      reason: "raw-edit-included",
    })
  })

  it("routes Look Decomposer detail requests to direct contact", () => {
    const result = decideRoutingFallback({
      jobContext: jobContext(),
      conversationState: conversationState({ lookDecomposerDetail: true }),
    })

    expect(result).toMatchObject({
      kind: "to-direct-contact",
      reason: "plugin-detail",
    })
  })

  it("keeps a long incomplete intake on the next required question", () => {
    const result = decideRoutingFallback({
      jobContext: jobContext(),
      conversationState: conversationState({
        turnCount: 24,
        hasMaterialDetails: false,
        materialHandoff: undefined,
      }),
    })

    expect(result).toMatchObject({
      kind: "continue",
      nextQuestion: expect.stringMatching(/何の素材/u),
    })
  })

  it("keeps a complete complex intake on the Booking Order confirmation path", () => {
    const result = decideRoutingFallback({
      jobContext: jobContext(),
      conversationState: conversationState({ turnCount: 24 }),
    })

    expect(result).toMatchObject({
      kind: "continue",
      presentChoices: bookingFinalConfirmationChoices,
    })
  })

  it("recommends one more QC day only once the customer has named an NHK or OTT delivery", () => {
    const result = decideRoutingFallback({
      jobContext: jobContext({ jobKind: "feature-90m", projectLengthMinutes: 90, finalMedium: "ott", strictDeliveryClient: true }),
      conversationState: conversationState(),
    })

    expect(result.kind).toBe("continue")
    if (result.kind !== "continue") return
    expect(result.nextQuestion).toBe(
      "長編 1時間30分は、コンフォーム1日・仕込み3日・立ち会い1〜3日・QC 2日（納品先の検査に合わせて1日多め）が目安です。立ち会いは何日にしますか？",
    )
    expect(result.presentChoices?.choices.map((choice) => choice.label)).toEqual([
      "1日（全体で7日）",
      "2日（全体で8日）",
      "3日（全体で9日）",
      "未定・相談して決めたい",
    ])
  })

  it("shows the stage split and asks how many days the customer attends before the contact and final check", () => {
    const result = decideRoutingFallback({
      jobContext: jobContext({ jobKind: "feature-90m", projectLengthMinutes: 90 }),
      conversationState: conversationState(),
    })

    expect(result.kind).toBe("continue")
    if (result.kind !== "continue") return
    expect(result.presentChoices?.id).toBe("attendance-days")
    expect(result.nextQuestion).toBe(
      "長編 1時間30分は、コンフォーム1日・仕込み3日・立ち会い1〜3日・QC 1日が目安です。立ち会いは何日にしますか？",
    )
    expect(result.presentChoices?.choices).toEqual([
      { id: "1", label: "1日（全体で6日）" },
      { id: "2", label: "2日（全体で7日）" },
      { id: "3", label: "3日（全体で8日）" },
      { id: "undecided", label: "未定・相談して決めたい" },
    ])
  })

  it("does not ask for a job whose attendance is a fixed length, and closes with the fixed split", () => {
    const result = decideRoutingFallback({
      jobContext: jobContext({ projectLengthMinutes: 0.5 }),
      conversationState: conversationState(),
    })

    expect(result).toMatchObject({ kind: "continue", presentChoices: bookingFinalConfirmationChoices })
  })

  it("states the chosen split in the final check once the attendance days are chosen", () => {
    const result = decideRoutingFallback({
      jobContext: jobContext({ jobKind: "feature-90m", projectLengthMinutes: 90, attendanceDays: 2 }),
      conversationState: conversationState({ hasAttendanceDays: true }),
    })

    expect(result).toMatchObject({ kind: "continue", presentChoices: bookingFinalConfirmationChoices })
    if (result.kind !== "continue") return
    expect(result.nextQuestion).toContain("工程はコンフォーム1日・仕込み3日・立ち会い2日・QC 1日の全体7日です。")
  })
})
