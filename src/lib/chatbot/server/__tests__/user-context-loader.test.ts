import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  prisma: {
    chatbotConversation: {
      findMany: vi.fn(),
    },
    bookingGroup: {
      findMany: vi.fn(),
    },
  },
}))

vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }))

import {
  formatUserChatbotContextForPrompt,
  loadUserChatbotContext,
  type UserChatbotContext,
} from "@/lib/chatbot/server/user-context-loader"

const now = new Date("2026-05-26T00:00:00.000Z")

function conversation(overrides: Record<string, unknown> = {}) {
  return {
    id: "conv_a_1",
    sessionId: "session_a_1",
    userId: "user_a",
    startedAt: now,
    lastMessageAt: now,
    routingDecision: "to-email",
    inquirySentAt: null,
    bookingId: null,
    customerName: "User A",
    customerCompany: "A Studio",
    customerEmail: "a@example.com",
    customerPhone: null,
    finalMedium: "web",
    jobType: "web movie",
    mainDuration: "30",
    workSite: "remote-grading",
    workSiteDetails: null,
    attachments: null,
    additionalWork: null,
    referenceUrls: JSON.stringify(["https://a.example/ref"]),
    ndaFlag: false,
    inquiry: {
      jobType: "web movie summary",
      finalMedium: "web",
      workSite: "remote-grading",
      desiredDeadline: "2026-06-30",
      aiSummary: "User A scoped summary",
    },
    ...overrides,
  }
}

function booking(overrides: Record<string, unknown> = {}) {
  return {
    id: "booking_a_1",
    customerId: "customer_a",
    teamId: null,
    status: "CONFIRMED",
    projectTitle: "User A project",
    memo: null,
    contactName: "User A",
    companyName: "A Studio",
    customerEmail: "a@example.com",
    phone: null,
    dueDate: "2026-07-01",
    pendingExpiresAt: null,
    bufferBeforeHours: 1,
    bufferAfterHours: 1,
    gcalEventId: null,
    notionPageId: null,
    originatedFrom: "chatbot",
    chatConversationId: "conv_a_1",
    createdAt: now,
    updatedAt: now,
    timeSlots: [
      {
        id: "slot_a_1",
        bookingGroupId: "booking_a_1",
        startTime: new Date("2026-06-01T01:00:00.000Z"),
        endTime: new Date("2026-06-01T02:00:00.000Z"),
        previousStartTime: null,
        previousEndTime: null,
        status: "CONFIRMED",
        createdAt: now,
        updatedAt: now,
      },
    ],
    ...overrides,
  }
}

function emptyContext(overrides: Partial<UserChatbotContext> = {}): UserChatbotContext {
  return {
    userId: "user_a",
    recentConversations: [],
    recentBookings: [],
    knownProfile: { finalMediums: [], jobTypes: [], workSites: [] },
    referenceUrls: [],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.prisma.chatbotConversation.findMany.mockResolvedValue([conversation()])
  mocks.prisma.bookingGroup.findMany.mockResolvedValue([booking()])
})

describe("loadUserChatbotContext", () => {
  it("queries only the authenticated user's conversations", async () => {
    const context = await loadUserChatbotContext({ userId: "user_a" })

    expect(mocks.prisma.chatbotConversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user_a" },
      }),
    )
    expect(context.recentConversations).toHaveLength(1)
    expect(formatUserChatbotContextForPrompt(context)).not.toContain("User B")
  })

  it("queries bookings through Customer.userId only", async () => {
    const context = await loadUserChatbotContext({ userId: "user_a" })

    expect(mocks.prisma.bookingGroup.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { customer: { userId: "user_a" } },
      }),
    )
    expect(context.recentBookings).toEqual([
      expect.objectContaining({ projectTitle: "User A project" }),
    ])
  })

  it("excludes the current conversation from recentConversations", async () => {
    await loadUserChatbotContext({ userId: "user_a", currentConversationId: "conv_current" })

    expect(mocks.prisma.chatbotConversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user_a", id: { not: "conv_current" } },
      }),
    )
  })

  it("applies maxConversations and maxBookings caps", async () => {
    await loadUserChatbotContext({ userId: "user_a", maxConversations: 2, maxBookings: 3 })

    expect(mocks.prisma.chatbotConversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 2 }),
    )
    expect(mocks.prisma.bookingGroup.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 3 }))
  })

  it("caps maxConversations and maxBookings at the default privacy limit", async () => {
    await loadUserChatbotContext({ userId: "user_a", maxConversations: 99, maxBookings: 99 })

    expect(mocks.prisma.chatbotConversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 5 }),
    )
    expect(mocks.prisma.bookingGroup.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 5 }))
  })

  it("keeps formatted prompt within the requested maximum by dropping oldest rows", () => {
    const prompt = formatUserChatbotContextForPrompt(
      emptyContext({
        recentConversations: Array.from({ length: 8 }, (_, index) => ({
          id: `conv_${index}`,
          subject: `subject-${index}-${"x".repeat(40)}`,
          lastMessageAt: now.toISOString(),
        })),
      }),
      260,
    )

    expect(prompt.length).toBeLessThanOrEqual(260)
    expect(prompt).toContain("本人文脈")
  })

  it("formats empty context safely", () => {
    expect(formatUserChatbotContextForPrompt(emptyContext())).toContain("既存の本人文脈はありません")
  })

  it("collects referenceUrls only from scoped conversation rows", async () => {
    mocks.prisma.chatbotConversation.findMany.mockResolvedValue([
      conversation({ referenceUrls: JSON.stringify(["https://a.example/ref1", "https://a.example/ref2"]) }),
    ])

    const context = await loadUserChatbotContext({ userId: "user_a" })

    expect(context.referenceUrls).toEqual(["https://a.example/ref1", "https://a.example/ref2"])
    expect(mocks.prisma.chatbotConversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "user_a" } }),
    )
  })
})
