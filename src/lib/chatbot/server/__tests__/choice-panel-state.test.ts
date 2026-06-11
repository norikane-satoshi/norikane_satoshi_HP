import { describe, expect, it } from "vitest"

import type { ConversationState, JobContext, SurveyChoiceSet } from "@/lib/chatbot/domain"
import {
  additionalWorkChoices,
  documentaryAttachmentChoices,
  finalMediumChoices,
  productionOptionChoices,
  workSiteChoices,
} from "@/lib/chatbot/domain"
import { applyActiveChoiceAnswer } from "@/lib/chatbot/server/choice-panel-state"
import { decideRoutingFallback } from "@/lib/chatbot/server/routing"

function baseState(overrides: Partial<ConversationState> = {}): ConversationState {
  return {
    hasFinalMedium: false,
    hasJobKind: false,
    hasProjectLength: false,
    hasMaterialHandoff: true,
    hasAdditionalWork: false,
    hasDocumentaryAttachments: false,
    hasWorkSite: false,
    hasReferenceUrls: false,
    hasContactEmail: false,
    hasDesiredSchedule: false,
    hasCustomerIdentity: true,
    turnCount: 2,
    ...overrides,
  }
}

function baseJobContext(overrides: Partial<JobContext> = {}): JobContext {
  return {
    finalMedium: "other",
    workSite: "remote-grading",
    documentaryAttachment: { kind: "none" },
    ...overrides,
  }
}

describe("choice panel state", () => {
  it("confirms live final medium and does not ask final medium again", () => {
    const patch = applyActiveChoiceAnswer({
      activeChoices: finalMediumChoices,
      message: "選択: live",
    })

    expect(patch).toMatchObject({
      conversationState: { hasFinalMedium: true },
      jobContext: { finalMedium: "live" },
    })

    const routingDecision = decideRoutingFallback({
      jobContext: baseJobContext({ ...patch?.jobContext }),
      conversationState: baseState({ ...patch?.conversationState }),
      latestUserMessage: "選択: live",
    })

    expect(routingDecision).toMatchObject({ kind: "continue", nextQuestion: "案件種別と尺を教えてください" })
    expect(routingDecision).not.toMatchObject({ presentChoices: finalMediumChoices })
  })

  it("keeps forward progress when the same choice is sent three times", () => {
    let conversationState = baseState()
    let jobContext = baseJobContext()

    for (let index = 0; index < 3; index += 1) {
      const patch = applyActiveChoiceAnswer({
        activeChoices: finalMediumChoices,
        message: "live",
      })
      conversationState = { ...conversationState, ...patch?.conversationState }
      jobContext = { ...jobContext, ...patch?.jobContext }

      const routingDecision = decideRoutingFallback({
        jobContext,
        conversationState,
        latestUserMessage: "live",
      })

      expect(routingDecision).not.toMatchObject({ presentChoices: finalMediumChoices })
    }
  })

  it.each([
    [finalMediumChoices, "live", { hasFinalMedium: true }, { finalMedium: "live" }],
    [additionalWorkChoices, "retouch", { hasAdditionalWork: true }, { additionalWork: ["retouch"] }],
    [additionalWorkChoices, "選択: retouch, skin-retouch", { hasAdditionalWork: true }, { additionalWork: ["retouch", "skin-retouch"] }],
    [additionalWorkChoices, "選択: none, retouch", { hasAdditionalWork: true }, { additionalWork: undefined }],
    [additionalWorkChoices, "なし", { hasAdditionalWork: true }, { additionalWork: undefined }],
    [
      productionOptionChoices,
      "選択: captions, narration",
      { hasProductionOptions: true, productionOptions: ["captions", "narration"] },
      {},
    ],
    [productionOptionChoices, "選択: none, music", { hasProductionOptions: true, productionOptions: [] }, {}],
    [
      documentaryAttachmentChoices,
      "interview",
      { hasDocumentaryAttachments: true },
      { documentaryAttachment: { kind: "interview", count: 1 } },
    ],
    [documentaryAttachmentChoices, "なし", { hasDocumentaryAttachments: true }, { documentaryAttachment: { kind: "none" } }],
    [workSiteChoices, "satoshi-studio", { hasWorkSite: true }, { workSite: "satoshi-studio" }],
    [workSiteChoices, "client-facility-attended", { hasWorkSite: true }, { workSite: "on-site" }],
  ] as const)(
    "maps %s choice %s to conversation state and job context",
    (choiceSet: SurveyChoiceSet, message, expectedState, expectedJobContext) => {
      expect(applyActiveChoiceAnswer({ activeChoices: choiceSet, message })).toMatchObject({
        conversationState: expectedState,
        jobContext: expectedJobContext,
      })
    },
  )
})
