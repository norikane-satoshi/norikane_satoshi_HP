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
    hasDeliveryFormat: true,
    hasDcpRequirement: true,
    dcpRequirement: "not-required",
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

  it("offers four attendance methods without studio choices", () => {
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
    expect(result.presentChoices?.choices.map((choice) => choice.label)).toEqual(["オンライン", "先方の場所で", "不要", "お任せ"])
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
      nextQuestion: "納期はいつごろをご希望ですか？ 日付か未定を選んでください。日付を選んだ場合、理由があれば任意でご記入ください。",
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
      suggestedMessage: expect.stringContaining("希望納期"),
    })
    expect(result).toMatchObject({
      kind: "to-direct-contact",
      suggestedMessage: expect.stringContaining("確約せず"),
    })
    expect(result).toMatchObject({
      kind: "to-direct-contact",
      suggestedMessage: expect.not.stringMatching(/\d+日/u),
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
      nextQuestion: expect.stringMatching(/素材が揃う日/u),
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

  it("keeps internal estimates out of final confirmation", () => {
    const result = decideRoutingFallback({ jobContext: jobContext({ jobKind: "feature-90m", projectLengthMinutes: 90, strictDeliveryClient: true }), conversationState: conversationState() })
    expect(result).toMatchObject({ kind: "continue", presentChoices: bookingFinalConfirmationChoices })
    if (result.kind === "continue") expect(result.nextQuestion).not.toMatch(/\d+日|コンフォーム|仕込み|QC/u)
  })
})


describe("delivery and cinema intake order", () => {
  it.each([
    [{ hasDeliveryFormat: false, hasWorkSite: false }, "web", "delivery-format"],
    [{ hasDcpRequirement: false, hasWorkSite: false }, "cinema", "dcp-required"],
    [{ dcpRequirement: "required", hasDcpCreator: false, hasWorkSite: false }, "cinema", "dcp-creator"],
    [{ hasDcpRequirement: false, hasWorkSite: false }, "web", "work-site"],
    [{ hasWorkSite: false }, "cinema", "work-site"],
  ] as const)("asks the next explicit intake item", (state, medium, id) => {
    const result = decideRoutingFallback({ jobContext: jobContext({ finalMedium: medium }), conversationState: conversationState(state), now: new Date("2026-10-05T00:00:00+09:00") })
    expect(result).toMatchObject({ kind: "continue", presentChoices: { id } })
  })
  it("keeps delivery, DCP and attendance together in readiness order", () => {
    expect(getMissingBookingReadinessSlots(conversationState({ hasDeliveryFormat: false, hasDcpRequirement: false, dcpRequirement: "required", hasDcpCreator: false, hasWorkSite: false }), { jobContext: jobContext({ finalMedium: "cinema", workSite: undefined }) }).slice(0, 4)).toEqual(["delivery-format", "dcp-required", "dcp-creator", "work-site"])
  })
})
