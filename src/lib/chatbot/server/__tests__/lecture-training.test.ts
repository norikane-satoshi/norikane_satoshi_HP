import { describe, expect, it } from "vitest"

import type { ChatbotConversation, ConversationState, JobContext } from "@/lib/chatbot/domain"
import {
  applyLectureTrainingConversationState,
  decideLectureTrainingRouting,
} from "@/lib/chatbot/server/lecture-training"

function conversation(message = "相談です"): ChatbotConversation {
  return {
    id: "conv_lecture",
    startedAt: "2026-06-21T00:00:00.000Z",
    updatedAt: "2026-06-21T00:00:00.000Z",
    status: "open",
    context: { sessionId: "session_lecture" },
    messages: [{ id: "user_1", role: "user", content: message, createdAt: "2026-06-21T00:00:00.000Z" }],
  }
}

function baseState(overrides: Partial<ConversationState> = {}): ConversationState {
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
  return {
    finalMedium: "other",
    workSite: "on-site",
    documentaryAttachment: { kind: "none" },
    ...overrides,
  }
}

describe("lecture and training inquiry support", () => {
  it.each([
    "講演会の依頼を相談したいです。",
    "カラーグレーディング講習をお願いしたいです。",
    "DaVinci Resolve 講習を開催したいです。",
    "講師依頼です。",
    "社内研修をお願いできますか。",
    "ワークショップの相談です。",
    "セミナー登壇をお願いしたいです。",
  ])("classifies lecture/training terms as a separate request kind: %s", (message) => {
    const state = applyLectureTrainingConversationState({
      conversation: conversation(),
      latestUserMessage: message,
      conversationState: baseState(),
    })

    expect(state).toMatchObject({
      requestKind: "lecture-training",
      hasLectureTrainingIntent: true,
      requiresNorikaneConfirmation: true,
    })
  })

  it("asks the lecture/training required slots in the safe order", () => {
    expect(
      decideLectureTrainingRouting({
        jobContext: jobContext(),
        conversationState: baseState({ requestKind: "lecture-training", hasLectureTrainingIntent: true }),
      }),
    ).toMatchObject({ kind: "continue", nextQuestion: expect.stringContaining("内容") })

    expect(
      decideLectureTrainingRouting({
        jobContext: jobContext(),
        conversationState: baseState({
          requestKind: "lecture-training",
          hasLectureTrainingIntent: true,
          hasLectureTrainingContent: true,
        }),
      }),
    ).toMatchObject({
      kind: "continue",
      nextQuestion: "開催形式を選んでください。",
      presentChoices: { id: "lecture-training-format" },
    })

    expect(
      decideLectureTrainingRouting({
        jobContext: jobContext(),
        conversationState: baseState({
          requestKind: "lecture-training",
          hasLectureTrainingIntent: true,
          hasLectureTrainingContent: true,
          hasLectureTrainingVenue: true,
          lectureTrainingInquiry: { unsupportedSoftware: "Premiere Pro" },
        }),
      }),
    ).toMatchObject({
      kind: "continue",
      nextQuestion: expect.stringContaining("DaVinci Resolve Studio または DaVinci Resolve のみ"),
    })
  })

  it("tracks DaVinci Resolve version, panel, GUI display, instructor monitors, and preferred time", () => {
    const state = applyLectureTrainingConversationState({
      conversation: conversation(),
      conversationState: baseState(),
      latestUserMessage:
        "DaVinci Resolve Studio 20 のカラーグレーディング講習です。開催場所は渋谷の会議室、コントロールパネルはありません。参加者は大画面でGUIを見られます。講師側はデュアルモニター2枚とメインモニター、マスモニあり。希望日程は7/10 10:00開始で18:00までです。client@example.com",
    })

    expect(state).toMatchObject({
      requestKind: "lecture-training",
      hasLectureTrainingContent: true,
      hasLectureTrainingVenue: true,
      hasLectureTrainingSoftware: true,
      hasResolveVersion: true,
      hasControlPanel: true,
      hasAudienceGuiDisplay: true,
      hasInstructorMonitorSetup: true,
      hasPreferredLectureSchedule: true,
      hasContactEmail: true,
      contactEmail: "client@example.com",
      lectureTrainingInquiry: expect.objectContaining({
        software: "davinci-resolve-studio",
        resolveVersion: "20",
        controlPanel: expect.stringContaining("Micro Color Panel"),
      }),
    })
  })

  it("routes complete lecture/training inquiries to consultation email, not booking", () => {
    const result = decideLectureTrainingRouting({
      jobContext: jobContext(),
      conversationState: baseState({
        requestKind: "lecture-training",
        hasLectureTrainingIntent: true,
        hasLectureTrainingContent: true,
        hasLectureTrainingVenue: true,
        hasLectureTrainingSoftware: true,
        hasResolveVersion: true,
        hasControlPanel: true,
        hasAudienceGuiDisplay: true,
        hasInstructorMonitorSetup: true,
        hasPreferredLectureSchedule: true,
        hasContactEmail: true,
        contactEmail: "client@example.com",
        lectureTrainingInquiry: {
          content: "DaVinci Resolve カラーグレーディング講習",
          venue: "渋谷の会議室",
          software: "davinci-resolve-studio",
          resolveVersion: "20",
          controlPanel: "現場になし。Micro Color Panel 持参可否を本人確認",
          audienceGuiDisplay: "大画面でGUIを見られる",
          instructorMonitorSetup: "デュアルモニター2枚、メインモニター、マスモニ",
          preferredSchedule: "7/10 10:00-18:00",
        },
      }),
    })

    expect(result).toMatchObject({
      kind: "to-email",
      summary: {
        subject: "講演・講習・講師依頼",
        customerEmail: "client@example.com",
        summaryText: expect.stringContaining("基本対応時間: 10:00〜18:00"),
      },
    })
    expect(JSON.stringify(result)).toContain("本人")
    expect(JSON.stringify(result)).not.toContain("to-booking-inline")
  })
})
