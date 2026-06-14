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
    finalMedium: "cinema",
    jobType: "本編",
    mainDuration: "90",
    workSite: "remote-grading",
    workSiteDetails: null,
    attachments: JSON.stringify({ kind: "none" }),
    additionalWork: JSON.stringify(["retouch", "skin-retouch"]),
    referenceUrls: JSON.stringify(["https://example.com/ref"]),
    ndaFlag: false,
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
