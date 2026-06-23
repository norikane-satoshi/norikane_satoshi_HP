import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({ prisma: {} }))

import { __chatbotRepositoryTestUtils } from "@/lib/chatbot/server/repository"

const now = new Date("2026-05-23T10:00:00.000Z")

function conversationRow(overrides = {}) {
  return {
    id: "conv_1",
    sessionId: "session_1",
    userId: "user_1",
    startedAt: now,
    lastMessageAt: new Date("2026-05-23T10:03:00.000Z"),
    routingDecision: "to-email",
    inquirySentAt: null,
    bookingId: null,
    customerName: "Satoshi",
    customerCompany: "Studio",
    customerEmail: "satoshi@example.com",
    customerPhone: null,
    slackThreadTs: null,
    slackChannelId: null,
    slackNotifiedAt: null,
    finalMedium: "cinema",
    jobType: "本編",
    mainDuration: "90",
    workSite: "remote-grading",
    workSiteDetails: null,
    attachments: JSON.stringify({ kind: "none" }),
    additionalWork: JSON.stringify(["retouch", "skin-retouch"]),
    referenceUrls: JSON.stringify(["https://example.com/ref"]),
    ndaFlag: false,
    currentQuestion: null,
    activeChoices: null,
    conversationState: null,
    messages: [
      {
        id: "msg_1",
        conversationId: "conv_1",
        role: "user",
        content: "相談したいです",
        confidence: null,
        llmModel: null,
        llmThinking: false,
        createdAt: new Date("2026-05-23T10:01:00.000Z"),
      },
    ],
    ...overrides,
  }
}

describe("chatbot repository mapping helpers", () => {
  it("maps a DB conversation row into the domain conversation shape", () => {
    const result = __chatbotRepositoryTestUtils.toDomainConversation(conversationRow())

    expect(result).toEqual({
      id: "conv_1",
      startedAt: "2026-05-23T10:00:00.000Z",
      updatedAt: "2026-05-23T10:03:00.000Z",
      status: "handoff-email",
      context: {
        sessionId: "session_1",
        userId: "user_1",
        customerEmail: "satoshi@example.com",
        jobContext: {
          finalMedium: "cinema",
          workSite: "remote-grading",
          documentaryAttachment: { kind: "none" },
          additionalWork: ["retouch", "skin-retouch"],
          referenceUrls: ["https://example.com/ref"],
          projectLengthMinutes: 90,
        },
      },
      messages: [
        {
          id: "msg_1",
          role: "user",
          content: "相談したいです",
          createdAt: "2026-05-23T10:01:00.000Z",
        },
      ],
    })
  })

  it("restores persisted workflow jobKind from jobType when it is a known duration enum", () => {
    const result = __chatbotRepositoryTestUtils.toDomainConversation(
      conversationRow({ jobType: "feature-90m" }),
    )

    expect(result.context.jobContext).toMatchObject({
      jobKind: "feature-90m",
      finalMedium: "cinema",
      projectLengthMinutes: 90,
    })
  })

  it("maps routing decisions to conversation statuses", () => {
    expect(
      __chatbotRepositoryTestUtils.toDomainConversation(
        conversationRow({ routingDecision: "continue", messages: [] }),
      ).status,
    ).toBe("open")
    expect(
      __chatbotRepositoryTestUtils.toDomainConversation(
        conversationRow({ routingDecision: "to-booking-inline", messages: [] }),
      ).status,
    ).toBe("handoff-booking")
    expect(
      __chatbotRepositoryTestUtils.toDomainConversation(
        conversationRow({ routingDecision: "to-direct-contact", messages: [] }),
      ).status,
    ).toBe("direct-contact")
  })

  it("maps Slack thread ts into the conversation context", () => {
    const result = __chatbotRepositoryTestUtils.toDomainConversation(
      conversationRow({ slackThreadTs: "1700000000.000100" }),
    )

    expect(result.context.slackThreadTs).toBe("1700000000.000100")
  })

  it("normalizes legacy active choices without selectionMode as single-select", () => {
    const result = __chatbotRepositoryTestUtils.toDomainConversation(
      conversationRow({
        routingDecision: "continue",
        activeChoices: JSON.stringify({
          id: "final-medium",
          question: "最終媒体を教えてください",
          choices: [
            { id: "web", label: "Web" },
            { id: "cinema", label: "劇場公開" },
          ],
        }),
        messages: [],
      }),
    )

    expect(result.context.activeChoices).toMatchObject({
      id: "final-medium",
      selectionMode: "single",
      choices: [
        { id: "web", label: "Web" },
        { id: "cinema", label: "劇場公開" },
      ],
    })
  })

  it("serializes repository-owned JSON context fields through typed helpers", () => {
    const activeChoices = {
      id: "final-medium",
      question: "最終媒体を教えてください",
      selectionMode: "single" as const,
      choices: [{ id: "web", label: "Web" }],
    }
    const conversationState = {
      hasFinalMedium: true,
      hasJobKind: false,
      hasAdditionalWork: false,
      hasDocumentaryAttachments: false,
      hasWorkSite: false,
      hasReferenceUrls: false,
      hasContactEmail: false,
      hasDesiredSchedule: false,
      turnCount: 2,
    }

    expect(JSON.parse(__chatbotRepositoryTestUtils.serializeActiveChoices(activeChoices) ?? "")).toMatchObject(activeChoices)
    expect(JSON.parse(__chatbotRepositoryTestUtils.serializeConversationState(conversationState) ?? "")).toMatchObject({
      hasFinalMedium: true,
      turnCount: 2,
    })
    expect(__chatbotRepositoryTestUtils.serializeActiveChoices(null)).toBeNull()
    expect(__chatbotRepositoryTestUtils.serializeConversationState(null)).toBeNull()
  })

  it("maps a conversation summary into ChatbotInquiry create data", () => {
    const sentAt = new Date("2026-05-23T11:00:00.000Z")
    const result = __chatbotRepositoryTestUtils.toInquiryCreateData({
      conversationId: "conv_1",
      routingDecisionKind: "to-email",
      sentAt,
      summary: {
        subject: "本編カラーグレーディング",
        customerEmail: "satoshi@example.com",
        customerName: "Satoshi",
        companyName: "Studio",
        jobContext: {
          finalMedium: "cinema",
          workSite: "remote-grading",
          documentaryAttachment: { kind: "none" },
          projectLengthMinutes: 90,
          publicReleaseDate: "2026-10-01",
          referenceUrls: ["https://example.com/ref"],
          additionalWork: ["retouch"],
        },
        summaryText: "本編のカラーグレーディング相談。",
        openQuestions: ["素材形式未確認", "立ち会い日未確認"],
      },
    })

    expect(result).toMatchObject({
      conversation: { connect: { id: "conv_1" } },
      customerEmail: "satoshi@example.com",
      finalMedium: "cinema",
      jobType: "本編カラーグレーディング",
      mainDuration: "90",
      workSite: "remote-grading",
      attachments: JSON.stringify({ kind: "none" }),
      additionalWork: JSON.stringify(["retouch"]),
      referenceUrls: JSON.stringify(["https://example.com/ref"]),
      desiredDeadline: "2026-10-01",
      freeText: "素材形式未確認\n立ち会い日未確認",
      aiSummary: "本編のカラーグレーディング相談。",
      sentReason: "to-email",
      sentAt,
    })
  })
})
