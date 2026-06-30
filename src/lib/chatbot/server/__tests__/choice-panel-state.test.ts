import { describe, expect, it } from "vitest"

import type { ConversationState, JobContext, SurveyChoiceSet } from "@/lib/chatbot/domain"
import {
  additionalWorkChoices,
  cmProjectLengthChoices,
  documentaryAttachmentChoices,
  dramaProjectLengthChoices,
  finalMediumChoices,
  jobKindChoices,
  liveProjectLengthChoices,
  lectureTrainingContentChoices,
  lectureTrainingFormatChoices,
  mvProjectLengthChoices,
  projectLengthChoices,
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
  it("treats documentary attachments as a multiple-choice set", () => {
    expect((documentaryAttachmentChoices as SurveyChoiceSet).selectionMode).toBe("multiple")
  })

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

    expect(routingDecision).toMatchObject({
      kind: "continue",
      nextQuestion: "まず案件種別を選んでください",
      presentChoices: jobKindChoices,
    })
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
    [jobKindChoices, "選択: Web CM / CM", { hasJobKind: true }, { jobKind: "cm-30s" }],
    [jobKindChoices, "選択: Web CMです", { hasJobKind: true }, { jobKind: "cm-30s" }],
    [jobKindChoices, "選択: 映画 / 長編 / 本編", { hasJobKind: true }, { jobKind: "feature-90m" }],
    [jobKindChoices, "選択: ドラマ / シリーズです", { hasJobKind: true }, { jobKind: "drama-first" }],
    [jobKindChoices, "選択: ドラマシリーズ", { hasJobKind: true }, { jobKind: "drama-first" }],
    [jobKindChoices, "選択: ライブ / コンサート / 舞台収録", { hasJobKind: true }, { jobKind: "live-60m" }],
    [jobKindChoices, "選択: MVです", { hasJobKind: true }, { jobKind: "mv-5m" }],
    [
      jobKindChoices,
      "選択: 講演会 / 講習会 / 教育 / 研修 / 講師依頼",
      { hasJobKind: true, requestKind: "lecture-training", hasLectureTrainingIntent: true },
      {},
    ],
    [projectLengthChoices, "選択: ライブ 150分前後", { hasProjectLength: true }, { projectLengthMinutes: 150 }],
    [projectLengthChoices, "選択: 未定", { hasProjectLength: true }, {}],
    [dramaProjectLengthChoices, "選択: 1話30分前後", { hasProjectLength: true }, { projectLengthMinutes: 30 }],
    [dramaProjectLengthChoices, "選択: 話数・全体尺を相談したい", { hasProjectLength: true }, {}],
    [liveProjectLengthChoices, "選択: 90分", { hasProjectLength: true }, { projectLengthMinutes: 90 }],
    [cmProjectLengthChoices, "選択: 15秒", { hasProjectLength: true }, { projectLengthMinutes: 0.25 }],
    [mvProjectLengthChoices, "選択: 5〜10分", { hasProjectLength: true }, { projectLengthMinutes: 10 }],
    [finalMediumChoices, "live", { hasFinalMedium: true }, { finalMedium: "live" }],
    [finalMediumChoices, "選択: ライブ", { hasFinalMedium: true }, { finalMedium: "live" }],
    [additionalWorkChoices, "retouch", { hasAdditionalWork: true }, { additionalWork: ["retouch"] }],
    [additionalWorkChoices, "選択: retouch, skin-retouch", { hasAdditionalWork: true }, { additionalWork: ["retouch", "skin-retouch"] }],
    [additionalWorkChoices, "選択: 消し物、肌修正", { hasAdditionalWork: true }, { additionalWork: ["retouch", "skin-retouch"] }],
    [additionalWorkChoices, "なし", { hasAdditionalWork: true }, { additionalWork: undefined }],
    [
      productionOptionChoices,
      "選択: captions, narration",
      { hasProductionOptions: true, productionOptions: ["captions", "narration"] },
      {},
    ],
    [
      documentaryAttachmentChoices,
      "選択: digest, interview",
      { hasDocumentaryAttachments: true },
      {
        documentaryAttachment: {
          kind: "mixed",
          items: [
            { kind: "digest", count: 1 },
            { kind: "interview", count: 1 },
          ],
        },
      },
    ],
    [
      documentaryAttachmentChoices,
      "interview",
      { hasDocumentaryAttachments: true },
      { documentaryAttachment: { kind: "interview", count: 1 } },
    ],
    [documentaryAttachmentChoices, "なし", { hasDocumentaryAttachments: true }, { documentaryAttachment: { kind: "none" } }],
    [workSiteChoices, "satoshi-studio", { hasWorkSite: true }, { workSite: "satoshi-studio" }],
    [workSiteChoices, "client-facility-attended", { hasWorkSite: true }, { workSite: "on-site" }],
    [
      lectureTrainingContentChoices,
      "選択: カラーグレーディング、DaVinci Resolve 基礎",
      { requestKind: "lecture-training", hasLectureTrainingContent: true },
      {},
    ],
    [
      lectureTrainingFormatChoices,
      "選択: オンライン",
      { requestKind: "lecture-training", hasLectureTrainingVenue: true },
      {},
    ],
  ] as const)(
    "maps %s choice %s to conversation state and job context",
    (choiceSet: SurveyChoiceSet, message, expectedState, expectedJobContext) => {
      expect(applyActiveChoiceAnswer({ activeChoices: choiceSet, message })).toMatchObject({
        conversationState: expectedState,
        jobContext: expectedJobContext,
      })
    },
  )

  it("does not expose color correction as a standalone customer-facing survey choice", () => {
    const customerFacingLabels = [jobKindChoices, lectureTrainingContentChoices]
      .flatMap((choiceSet) => choiceSet.choices.map((choice) => choice.label))

    expect(customerFacingLabels).not.toContain("カラーコレクション相談")
    expect(customerFacingLabels).not.toContain("カラーコレクション")
    expect(jobKindChoices.choices.map((choice) => choice.label)).not.toContain("カラーグレーディング相談")
    expect(lectureTrainingContentChoices.choices.map((choice) => choice.label)).toContain("カラーグレーディング")
  })

  it("maps legacy color consultation job-kind ids without restoring split choices", () => {
    const legacyJobKindChoices = {
      ...jobKindChoices,
      choices: [
        ...jobKindChoices.choices,
        { id: "grading-consultation", label: "カラーグレーディング相談" },
        { id: "correction-consultation", label: "カラーコレクション相談" },
      ],
    } as const satisfies SurveyChoiceSet

    expect(
      applyActiveChoiceAnswer({
        activeChoices: legacyJobKindChoices,
        message: "選択: correction-consultation",
      }),
    ).toMatchObject({
      choiceId: "grading-consultation",
      choiceIds: ["grading-consultation"],
      conversationState: {
        hasJobKind: true,
        otherChoiceComments: { "job-kind": "カラーグレーディング相談" },
      },
      jobContext: {},
    })
  })

  it("maps legacy lecture color correction content to the unified grading content", () => {
    const legacyLectureTrainingContentChoices = {
      ...lectureTrainingContentChoices,
      choices: [
        { id: "grading", label: "カラーグレーディング" },
        { id: "correction", label: "カラーコレクション" },
        ...lectureTrainingContentChoices.choices.filter((choice) => choice.id !== "grading"),
      ],
    } as const satisfies SurveyChoiceSet

    expect(
      applyActiveChoiceAnswer({
        activeChoices: legacyLectureTrainingContentChoices,
        message: "選択: correction",
      }),
    ).toMatchObject({
      choiceIds: ["grading"],
      conversationState: {
        requestKind: "lecture-training",
        hasLectureTrainingContent: true,
        lectureTrainingInquiry: { content: "カラーグレーディング" },
      },
    })
  })

  it("marks ambiguous choice answers as clarification state without advancing the slot", () => {
    expect(
      applyActiveChoiceAnswer({
        activeChoices: additionalWorkChoices,
        message: "選択: none, retouch",
      }),
    ).toMatchObject({
      conversationState: {
        activeIntakeClarification: {
          status: "needs-clarification",
          choiceSetId: "additional-work",
          reason: "exclusive-choice-conflict",
        },
      },
      jobContext: {},
    })

    expect(
      applyActiveChoiceAnswer({
        activeChoices: projectLengthChoices,
        message: "2.5",
      }),
    ).toMatchObject({
      conversationState: {
        activeIntakeClarification: {
          status: "needs-clarification",
          choiceSetId: "project-length",
          reason: "quantity-needs-unit",
        },
      },
      jobContext: {},
    })

    expect(
      applyActiveChoiceAnswer({
        activeChoices: dramaProjectLengthChoices,
        message: "選択: ライブ 60分前後",
      }),
    ).toMatchObject({
      conversationState: {
        activeIntakeClarification: {
          status: "needs-clarification",
          choiceSetId: "project-length",
          reason: "project-length-choice-mismatch",
        },
      },
      jobContext: {},
    })
  })

  it("keeps other comments in conversation state and maps them to server state", () => {
    expect(
      applyActiveChoiceAnswer({
        activeChoices: jobKindChoices,
        message: "選択: その他\nその他コメント: 展示用インスタレーション映像",
      }),
    ).toMatchObject({
      conversationState: {
        hasJobKind: true,
        otherChoiceComments: { "job-kind": "展示用インスタレーション映像" },
      },
      jobContext: {},
    })

    expect(
      applyActiveChoiceAnswer({
        activeChoices: projectLengthChoices,
        message: "選択: その他\nその他コメント: 12分が3本",
      }),
    ).toMatchObject({
      conversationState: {
        hasProjectLength: true,
        otherChoiceComments: { "project-length": "12分が3本" },
      },
      jobContext: {},
    })

    expect(
      applyActiveChoiceAnswer({
        activeChoices: additionalWorkChoices,
        message: "選択: その他\nその他コメント: MA も相談したい",
      }),
    ).toMatchObject({
      conversationState: {
        hasAdditionalWork: true,
        otherChoiceComments: { "additional-work": "MA も相談したい" },
      },
      jobContext: { additionalWork: ["other"] },
    })

    expect(
      applyActiveChoiceAnswer({
        activeChoices: documentaryAttachmentChoices,
        message: "選択: その他\nその他コメント: 舞台裏の短尺あり",
      }),
    ).toMatchObject({
      conversationState: {
        hasDocumentaryAttachments: true,
        otherChoiceComments: { "documentary-attachment": "舞台裏の短尺あり" },
      },
      jobContext: {
        documentaryAttachment: { kind: "other", count: 1, note: "舞台裏の短尺あり" },
      },
    })

    expect(
      applyActiveChoiceAnswer({
        activeChoices: documentaryAttachmentChoices,
        message: "選択: 特典映像だよ",
      }),
    ).toMatchObject({
      conversationState: {
        hasDocumentaryAttachments: true,
        otherChoiceComments: { "documentary-attachment": "特典映像だよ" },
      },
      jobContext: {
        documentaryAttachment: { kind: "other", count: 1, note: "特典映像だよ" },
      },
    })

    expect(
      applyActiveChoiceAnswer({
        activeChoices: productionOptionChoices,
        message: "選択: 字幕、その他\nその他コメント: 英語版ナレーション",
      }),
    ).toMatchObject({
      conversationState: {
        hasProductionOptions: true,
        productionOptions: ["captions", "other"],
        otherChoiceComments: { "production-options": "英語版ナレーション" },
      },
    })
  })

  it("uses a pending other-choice clarification answer as the free-text comment", () => {
    expect(
      applyActiveChoiceAnswer({
        activeChoices: additionalWorkChoices,
        message: "MA も相談したい",
        activeIntakeClarification: {
          status: "needs-clarification",
          choiceSetId: "additional-work",
          selectedChoiceIds: ["other"],
          question: "「その他」の内容を1つだけ補足してください。",
          reason: "other-choice-needs-detail",
        },
      }),
    ).toMatchObject({
      conversationState: {
        hasAdditionalWork: true,
        otherChoiceComments: { "additional-work": "MA も相談したい" },
        intakeClarifications: { "additional-work": { status: "clear" } },
      },
      jobContext: { additionalWork: ["other"] },
    })
  })
})
