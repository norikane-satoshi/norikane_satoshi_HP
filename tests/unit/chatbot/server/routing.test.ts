import { describe, expect, it } from "vitest"

import type { ConversationState, JobContext } from "@/lib/chatbot/domain"
import {
  additionalWorkChoices,
  finalMediumChoices,
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
    ...overrides,
  }
}

function conversationState(overrides: Partial<ConversationState> = {}): ConversationState {
  return {
    hasFinalMedium: true,
    hasJobKind: true,
    hasAdditionalWork: true,
    hasDocumentaryAttachments: true,
    hasWorkSite: true,
    hasReferenceUrls: true,
    hasContactEmail: true,
    hasDesiredSchedule: true,
    hasCustomerIdentity: true,
    turnCount: settledConversationTurnThreshold,
    contactEmail: "client@example.com",
    ...overrides,
  }
}

describe("chatbot fallback router", () => {
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

  it("starts with the required three intake questions on the first turn", () => {
    const result = decideRoutingFallback({
      jobContext: jobContext(),
      conversationState: conversationState({
        hasJobKind: false,
        hasDesiredSchedule: false,
        hasCustomerIdentity: false,
        hasContactEmail: false,
        turnCount: 1,
      }),
    })

    expect(result).toMatchObject({
      kind: "continue",
      nextQuestion: expect.stringContaining("案件種類"),
    })
    expect(result).toMatchObject({
      nextQuestion: expect.stringContaining("スケジュールがだいたい決まっているか"),
    })
    expect(result).toMatchObject({
      nextQuestion: expect.stringContaining("お名前・会社名"),
    })
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
    })

    expect(result).toMatchObject({
      kind: "continue",
      presentChoices: workSiteChoices,
    })
  })

  it("routes to inline booking when schedule, job context, and email are ready", () => {
    const context = jobContext()
    const result = decideRoutingFallback({
      jobContext: context,
      conversationState: conversationState(),
    })

    expect(result).toMatchObject({
      kind: "to-booking-inline",
      suggestedSlots: expect.arrayContaining([
        expect.objectContaining({ note: "1時間候補" }),
      ]),
      jobContext: expect.objectContaining(context),
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

  it("does not route to email when required consultation slots are missing", () => {
    const result = decideRoutingFallback({
      jobContext: jobContext({ finalMedium: "other", jobKind: undefined }),
      conversationState: conversationState({
        hasFinalMedium: false,
        hasJobKind: false,
        hasWorkSite: false,
        hasDesiredSchedule: false,
        turnCount: settledConversationTurnThreshold + 2,
      }),
    })

    expect(result).toMatchObject({
      kind: "continue",
      presentChoices: finalMediumChoices,
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
      kind: "to-booking-inline",
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

  it("routes pricing questions to direct contact without returning amounts", () => {
    const result = decideRoutingFallback({
      jobContext: jobContext(),
      conversationState: conversationState({ asksPricing: true }),
    })

    expect(result).toMatchObject({
      kind: "to-direct-contact",
      reason: "pricing",
      suggestedMessage: expect.not.stringMatching(/\d+円|万円|¥|￥/u),
    })
  })

  it("routes contract, personal, other-client, and private-technique boundaries to direct contact", () => {
    const cases: Array<[Partial<ConversationState>, string]> = [
      [{ contractDecision: true }, "contract-decision"],
      [{ personalQuestion: true }, "personal-life"],
      [{ otherClientInformation: true }, "other-client"],
      [{ confidentialTechniqueQuestion: true }, "confidential-technique"],
      [{ privateMethodNameExposure: true }, "confidential-technique"],
    ]

    for (const [state, reason] of cases) {
      const result = decideRoutingFallback({
        jobContext: jobContext(),
        conversationState: conversationState(state),
      })

      expect(result).toMatchObject({
        kind: "to-direct-contact",
        reason,
      })
    }
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

  it("routes private method detail requests to direct contact", () => {
    const result = decideRoutingFallback({
      jobContext: jobContext(),
      conversationState: conversationState({ privateMethodNameExposure: true }),
    })

    expect(result).toMatchObject({
      kind: "to-direct-contact",
      reason: "confidential-technique",
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
