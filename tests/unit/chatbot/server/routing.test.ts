import { describe, expect, it } from "vitest"

import type { ConversationState, JobContext } from "@/lib/chatbot/domain"
import {
  additionalWorkChoices,
  cmProjectLengthChoices,
  dramaProjectLengthChoices,
  finalMediumChoices,
  jobKindChoices,
  liveProjectLengthChoices,
  mvProjectLengthChoices,
  workSiteChoices,
} from "@/lib/chatbot/domain"
import {
  complexConversationTurnThreshold,
  settledConversationTurnThreshold,
  tightDeadlineThresholdDays,
  tightishDeadlineMaxDays,
} from "@/lib/chatbot/knowledge/workflow-duration"
import { decideRoutingFallback } from "@/lib/chatbot/server/routing"

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
    hasReferenceUrls: true,
    hasContactEmail: true,
    hasDesiredSchedule: true,
    turnCount: settledConversationTurnThreshold,
    contactEmail: "client@example.com",
    customerName: "Client",
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

  it.each([
    ["drama-first", dramaProjectLengthChoices, ["話数・全体尺を相談したい"], ["30分", "60分", "90分", "2時間以上"]],
    ["live-60m", liveProjectLengthChoices, ["30分", "60分", "90分", "2時間以上"], ["1話30分前後", "15秒"]],
    ["cm-30s", cmProjectLengthChoices, ["15秒", "30秒", "60秒", "複数本"], ["90分", "1話30分前後"]],
    ["mv-5m", mvProjectLengthChoices, ["3〜5分", "5〜10分"], ["2時間以上", "15秒"]],
  ] as const)("continues with contextual project length choices for %s", (jobKind, expectedChoices, included, excluded) => {
    const result = decideRoutingFallback({
      jobContext: jobContext({ jobKind }),
      conversationState: conversationState({
        hasProjectLength: false,
        hasContactEmail: false,
        hasDesiredSchedule: false,
      }),
    })

    expect(result.kind).toBe("continue")
    if (result.kind !== "continue") return
    expect(result.nextQuestion).toBe(expectedChoices.question)
    expect(result.presentChoices).toBe(expectedChoices)
    const labels = result.presentChoices?.choices.map((choice) => choice.label) ?? []
    included.forEach((label) => expect(labels).toContain(label))
    excluded.forEach((label) => expect(labels).not.toContain(label))
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

  it("routes to email when contact email is collected and schedule is undecided", () => {
    const result = decideRoutingFallback({
      jobContext: jobContext(),
      conversationState: conversationState({
        hasDesiredSchedule: false,
        turnCount: settledConversationTurnThreshold + 2,
      }),
    })

    expect(result).toMatchObject({
      kind: "to-email",
      summary: {
        customerEmail: "client@example.com",
      },
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
      suggestedMessage: expect.stringContaining("正本ライン 1〜2日"),
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

  it("routes complex conversations to direct contact at the threshold", () => {
    const result = decideRoutingFallback({
      jobContext: jobContext(),
      conversationState: conversationState({ turnCount: complexConversationTurnThreshold }),
    })

    expect(result).toMatchObject({
      kind: "to-direct-contact",
      reason: "complex",
    })
  })
})
