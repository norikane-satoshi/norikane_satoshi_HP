import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  cleanupExpiredChatbotConversations: vi.fn(),
  getCachedCalendarAccessToken: vi.fn(),
  getCalendarEvent: vi.fn(),
  prisma: {
    bookingGroup: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    bookingTimeSlot: { updateMany: vi.fn() },
    adminActionLog: { create: vi.fn() },
  },
}))

vi.mock("@/lib/chatbot/server/cleanup-conversations", () => ({
  cleanupExpiredChatbotConversations: mocks.cleanupExpiredChatbotConversations,
}))
vi.mock("@/lib/booking/server/calendar-free-busy/google-token-cache", () => ({
  getCachedCalendarAccessToken: mocks.getCachedCalendarAccessToken,
}))
vi.mock("@/lib/google-calendar/server", () => ({
  CALENDAR_TOKEN_USER_ID: "satoshi-calendar-owner",
  getCalendarEvent: mocks.getCalendarEvent,
}))
vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }))

import { GET } from "./route"

function request(token = "secret") {
  return new NextRequest("http://localhost/api/cron/reconcile-pending-gcal", {
    headers: { authorization: `Bearer ${token}` },
  })
}

describe("GET /api/cron/reconcile-pending-gcal", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    vi.stubEnv("CRON_SECRET", "secret")
    vi.stubEnv("GOOGLE_CALENDAR_BUSY_SOURCE_ID", "primary")
    mocks.getCachedCalendarAccessToken.mockResolvedValue({ token: "access-token" })
    mocks.prisma.bookingGroup.findMany.mockResolvedValue([])
    mocks.prisma.adminActionLog.create.mockResolvedValue({})
    mocks.cleanupExpiredChatbotConversations.mockResolvedValue({
      cutoffIso: "2026-04-26T00:00:00.000Z",
      retentionDays: 30,
      scannedConversationCount: 1,
      deletedConversationCount: 1,
      deletedMessageCount: 2,
      deletedSurveyResponseCount: 0,
      deletedInquiryCount: 1,
      unlinkedBookingGroupCount: 1,
    })
  })

  it("returns cleanup summary from the daily reconcile cron", async () => {
    const response = await GET(request())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      reconciledCount: 0,
      failedCount: 0,
      rollbackCount: 0,
      chatbotCleanup: {
        ok: true,
        cutoffIso: "2026-04-26T00:00:00.000Z",
        retentionDays: 30,
        scannedConversationCount: 1,
        deletedConversationCount: 1,
        deletedMessageCount: 2,
        deletedSurveyResponseCount: 0,
        deletedInquiryCount: 1,
        unlinkedBookingGroupCount: 1,
      },
    })
    expect(mocks.cleanupExpiredChatbotConversations).toHaveBeenCalledTimes(1)
  })

  it("still runs cleanup when calendar env is missing", async () => {
    vi.stubEnv("GOOGLE_CALENDAR_BUSY_SOURCE_ID", "")

    const response = await GET(request())

    expect(response.status).toBe(200)
    expect(mocks.getCachedCalendarAccessToken).not.toHaveBeenCalled()
    expect(mocks.cleanupExpiredChatbotConversations).toHaveBeenCalledTimes(1)
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      chatbotCleanup: { ok: true },
    })
  })

  it("does not fail the reconcile response when cleanup fails", async () => {
    mocks.cleanupExpiredChatbotConversations.mockRejectedValue(new Error("cleanup failed"))

    const response = await GET(request())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      reconciledCount: 0,
      failedCount: 0,
      rollbackCount: 0,
      chatbotCleanup: { ok: false, error: "cleanup_failed" },
    })
  })

  it("still runs cleanup when reconcile throws", async () => {
    mocks.getCachedCalendarAccessToken.mockRejectedValue(new Error("calendar token failed"))

    const response = await GET(request())

    expect(response.status).toBe(200)
    expect(mocks.cleanupExpiredChatbotConversations).toHaveBeenCalledTimes(1)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      reconciledCount: 0,
      failedCount: 0,
      rollbackCount: 0,
      chatbotCleanup: {
        ok: true,
        cutoffIso: "2026-04-26T00:00:00.000Z",
        retentionDays: 30,
        scannedConversationCount: 1,
        deletedConversationCount: 1,
        deletedMessageCount: 2,
        deletedSurveyResponseCount: 0,
        deletedInquiryCount: 1,
        unlinkedBookingGroupCount: 1,
      },
    })
  })
})
