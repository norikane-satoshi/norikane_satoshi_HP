import { conditionChoiceSet } from "@/lib/chatbot/domain/survey-choice"
import { describe, expect, it, vi } from "vitest"

const transaction = vi.hoisted(() => vi.fn())
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: transaction } }))

import { __chatbotRepositoryTestUtils, linkChatToBookingGroup } from "@/lib/chatbot/server/repository"

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
    activeMessageRequestKey: null,
    activeMessageRequestOwner: null,
    messageRequestLeaseExpiresAt: null,
    messageRequestVersion: 0,
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
  it("persists edited condition IDs when linking a booking and retains them on reload", async () => {
    const existing = { conditionAnswers: { "project-length": { status: "answered", composition: [{ count: 2, durationSeconds: 30 }], sourceMessageId: "duration" }, "final-medium": { status: "answered", selectedIds: ["cinema"] }, "dcp-required": { status: "answered", selectedIds: ["required"] } } }
    const executeRaw = vi.fn().mockResolvedValue(1)
    transaction.mockImplementation(async (callback) => callback({
      $queryRaw: vi.fn().mockResolvedValue([{ currentQuestion: null, activeChoices: null, conversationState: JSON.stringify(existing) }]),
      $executeRaw: executeRaw, bookingGroup: { update: vi.fn() }, chatbotConversation: { update: vi.fn() },
    }))
    await linkChatToBookingGroup({ conversationId: "conv_1", bookingGroupId: "booking_1", conditionAnswers: { "final-medium": { status: "answered", selectedIds: ["web"] }, "retouch-cut-count": { status: "unknown" } } })
    const stateJson = executeRaw.mock.calls[0][3]
    const reloaded = __chatbotRepositoryTestUtils.toDomainConversation(conversationRow({ bookingId: "booking_1", jobType: "short-film", conversationState: stateJson })).context
    expect(reloaded.conversationState?.conditionAnswers).toEqual({ "project-length": existing.conditionAnswers["project-length"], "final-medium": { status: "answered", selectedIds: ["web"] } })
    expect(reloaded.conversationState?.conditionAnswers).not.toHaveProperty("dcp-required")
    expect(reloaded.conversationState?.bookingSubmission?.status).toBe("submitted")
    expect(reloaded.jobContext?.jobKind).toBe("short-film")
  })

  it.each(["cm", "mv", "feature", "short-film", "documentary", "drama", "vertical", "live"])("restores the canonical job kind %s and structured answers", (jobKind) => {
    const answers = { "job-kind": { status: "answered", selectedIds: [jobKind], sourceMessageId: "kind" }, "project-length": { status: "answered", composition: [{ count: 3, durationSeconds: 45 }, { name: "Unknown", count: 1 }], sourceMessageId: "length" } }
    const activeChoices = { id: "project-length", question: "Copy", choices: [], input: "composition" }
    const result = __chatbotRepositoryTestUtils.toDomainConversation(conversationRow({ jobType: jobKind, conversationState: JSON.stringify({ conditionAnswers: answers }), activeChoices: JSON.stringify(activeChoices) }))
    expect(result.context.jobContext?.jobKind).toBe(jobKind)
    expect(result.context.conversationState?.conditionAnswers).toEqual(answers)
    expect(result.context.activeChoices?.input).toBe("composition")
  })

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
      jobKind: "feature",
      finalMedium: "cinema",
      projectLengthMinutes: 90,
    })
  })

  it.each(["blu-ray", "youtube"] as const)(
    "restores the current final-medium choice %s from the canonical DB field",
    (finalMedium) => {
      const result = __chatbotRepositoryTestUtils.toDomainConversation(
        conversationRow({ finalMedium }),
      )

      expect(result.context.jobContext?.finalMedium).toBe(finalMedium)
    },
  )

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

  it("restores a submitted booking terminal state from bookingId without keeping sticky final confirmation", () => {
    const result = __chatbotRepositoryTestUtils.toDomainConversation(
      conversationRow({
        routingDecision: "to-booking-inline",
        bookingId: "booking_1",
        conversationState: JSON.stringify({
          hasFinalMedium: true,
          hasJobKind: true,
          hasAdditionalWork: false,
          hasDocumentaryAttachments: false,
          hasWorkSite: false,
          hasReferenceUrls: false,
          hasContactEmail: true,
          hasDesiredSchedule: false,
          turnCount: 8,
          bookingFinalConfirmation: {
            status: "confirmed",
            confirmedAtTurn: 7,
            bookingPrefill: { projectTitle: "案件T", contactEmail: "client@example.com" },
          },
        }),
      }),
    )

    expect(result.context.conversationState).toMatchObject({
      bookingSubmission: {
        status: "submitted",
        reservationNumber: "booking_1",
      },
    })
    expect(result.context.conversationState).not.toHaveProperty("bookingFinalConfirmation")
  })

  it("rehydrates a legacy active panel from its stable definition ID", () => {
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

    expect(result.context.activeChoices).toEqual(conditionChoiceSet("final-medium"))
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
