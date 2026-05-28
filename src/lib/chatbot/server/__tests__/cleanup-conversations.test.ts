import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => {
  const tx = {
    bookingGroup: { updateMany: vi.fn() },
    chatbotInquiry: { deleteMany: vi.fn() },
    chatbotSurveyResponse: { deleteMany: vi.fn() },
    chatbotMessage: { deleteMany: vi.fn() },
    chatbotConversation: { deleteMany: vi.fn() },
    user: { deleteMany: vi.fn() },
    customer: { deleteMany: vi.fn() },
    session: { deleteMany: vi.fn() },
    account: { deleteMany: vi.fn() },
    calendarToken: { deleteMany: vi.fn() },
  }

  return {
    tx,
    prisma: {
      chatbotConversation: { findMany: vi.fn() },
      $transaction: vi.fn(async (callback: (txArg: typeof tx) => unknown) => callback(tx)),
    },
  }
})

vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }))

import {
  CHATBOT_CONVERSATION_RETENTION_DAYS,
  cleanupExpiredChatbotConversations,
} from "@/lib/chatbot/server/cleanup-conversations"

describe("cleanupExpiredChatbotConversations", () => {
  const now = new Date("2026-05-26T00:00:00.000Z")

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.tx.bookingGroup.updateMany.mockResolvedValue({ count: 1 })
    mocks.tx.chatbotInquiry.deleteMany.mockResolvedValue({ count: 1 })
    mocks.tx.chatbotSurveyResponse.deleteMany.mockResolvedValue({ count: 2 })
    mocks.tx.chatbotMessage.deleteMany.mockResolvedValue({ count: 3 })
    mocks.tx.chatbotConversation.deleteMany.mockResolvedValue({ count: 1 })
  })

  it("deletes conversations older than the retention cutoff and returns counts", async () => {
    mocks.prisma.chatbotConversation.findMany.mockResolvedValue([{ id: "conversation-old" }])

    const result = await cleanupExpiredChatbotConversations({ now, batchSize: 10 })

    expect(mocks.prisma.chatbotConversation.findMany).toHaveBeenCalledWith({
      where: { lastMessageAt: { lt: new Date("2026-05-25T00:00:00.000Z") } },
      select: { id: true },
      orderBy: { lastMessageAt: "asc" },
      take: 10,
    })
    expect(mocks.tx.bookingGroup.updateMany).toHaveBeenCalledWith({
      where: { chatConversationId: { in: ["conversation-old"] } },
      data: { chatConversationId: null },
    })
    expect(mocks.tx.chatbotInquiry.deleteMany).toHaveBeenCalledWith({
      where: { conversationId: { in: ["conversation-old"] } },
    })
    expect(mocks.tx.chatbotSurveyResponse.deleteMany).toHaveBeenCalledWith({
      where: { conversationId: { in: ["conversation-old"] } },
    })
    expect(mocks.tx.chatbotMessage.deleteMany).toHaveBeenCalledWith({
      where: { conversationId: { in: ["conversation-old"] } },
    })
    expect(mocks.tx.chatbotConversation.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["conversation-old"] } },
    })
    expect(result).toEqual({
      cutoffIso: "2026-05-25T00:00:00.000Z",
      retentionDays: CHATBOT_CONVERSATION_RETENTION_DAYS,
      scannedConversationCount: 1,
      deletedConversationCount: 1,
      deletedMessageCount: 3,
      deletedSurveyResponseCount: 2,
      deletedInquiryCount: 1,
      unlinkedBookingGroupCount: 1,
    })
  })

  it("keeps conversations at or newer than the cutoff by relying on the selection query", async () => {
    mocks.prisma.chatbotConversation.findMany.mockResolvedValue([])

    const result = await cleanupExpiredChatbotConversations({ now })

    expect(result).toMatchObject({
      scannedConversationCount: 0,
      deletedConversationCount: 0,
      deletedMessageCount: 0,
      deletedSurveyResponseCount: 0,
      deletedInquiryCount: 0,
      unlinkedBookingGroupCount: 0,
    })
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  })

  it("does not delete user, customer, booking group, session, account, or calendar token records", async () => {
    mocks.prisma.chatbotConversation.findMany.mockResolvedValue([{ id: "conversation-old" }])

    await cleanupExpiredChatbotConversations({ now })

    expect(mocks.tx.user.deleteMany).not.toHaveBeenCalled()
    expect(mocks.tx.customer.deleteMany).not.toHaveBeenCalled()
    expect(mocks.tx.bookingGroup.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { chatConversationId: null },
    }))
    expect(mocks.tx.session.deleteMany).not.toHaveBeenCalled()
    expect(mocks.tx.account.deleteMany).not.toHaveBeenCalled()
    expect(mocks.tx.calendarToken.deleteMany).not.toHaveBeenCalled()
  })
})
