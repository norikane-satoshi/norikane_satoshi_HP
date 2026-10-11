import { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { chatbotDiagnosticHeader, chatbotDiagnosticToken } from "@/lib/chatbot/server/diagnostic-request"

afterEach(() => vi.unstubAllEnvs())

const mocks = vi.hoisted(() => ({
  cleanupExpiredChatbotConversations: vi.fn(),
  getCachedCalendarAccessToken: vi.fn(),
  getCalendarEvent: vi.fn(),
  continueBookingGroupCalendarReplacement: vi.fn(),
  prisma: {
    bookingGroup: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    bookingCalendarEvent: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    bookingTimeSlot: { updateMany: vi.fn() },
    adminActionLog: { create: vi.fn() },
    $transaction: vi.fn(),
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
vi.mock("@/lib/booking/server/calendar-event-lifecycle", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/booking/server/calendar-event-lifecycle")>()
  return {
    ...original,
    continueBookingGroupCalendarReplacement: mocks.continueBookingGroupCalendarReplacement,
  }
})
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
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("VERCEL", "1")
    vi.stubEnv("VERCEL_ENV", "production")
    vi.stubEnv("VITEST", "")
    vi.stubEnv("BOOKING_EXTERNAL_WRITES", "")

    vi.stubEnv("CRON_SECRET", "secret")
    vi.stubEnv("GOOGLE_CALENDAR_BUSY_SOURCE_ID", "primary")
    mocks.getCachedCalendarAccessToken.mockResolvedValue({ token: "access-token" })
    mocks.prisma.bookingGroup.findMany.mockResolvedValue([])
    mocks.prisma.bookingGroup.findUnique.mockResolvedValue(null)
    mocks.prisma.bookingCalendarEvent.findMany.mockResolvedValue([])
    mocks.prisma.bookingCalendarEvent.update.mockResolvedValue({})
    mocks.continueBookingGroupCalendarReplacement.mockResolvedValue({
      complete: true,
      deleteResults: [],
    })
    mocks.prisma.$transaction.mockImplementation(async (input) => Promise.all(input))
    mocks.prisma.adminActionLog.create.mockResolvedValue({})
    mocks.cleanupExpiredChatbotConversations.mockResolvedValue({
      cutoffIso: "2026-04-26T00:00:00.000Z",
      retentionDays: 30,
      scannedConversationCount: 1,
      deletedConversationCount: 1,
      deletedMessageCount: 2,
      deletedAuditEventCount: 3,
      deletedSurveyResponseCount: 0,
      deletedInquiryCount: 1,
      unlinkedBookingGroupCount: 1,
    })
  })

  it("does not replay production intents during local verification", async () => {
    vi.stubEnv("VERCEL", "")
    const response = await GET(request())
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ error: "booking_external_writes_disabled" })
    expect(mocks.getCachedCalendarAccessToken).not.toHaveBeenCalled()
    expect(mocks.prisma.bookingCalendarEvent.findMany).not.toHaveBeenCalled()
    expect(mocks.prisma.bookingGroup.update).not.toHaveBeenCalled()
    expect(mocks.cleanupExpiredChatbotConversations).not.toHaveBeenCalled()
  })

  it("does not replay production intents for authenticated diagnostic verification", async () => {
    vi.stubEnv("CHATBOT_HOSTED_NOTION_AI_WORKER_TOKEN", "diagnostic-test-secret")
    const diagnostic = request()
    diagnostic.headers.set(chatbotDiagnosticHeader, chatbotDiagnosticToken()!)
    const response = await GET(diagnostic)
    expect(response.status).toBe(503)
    expect(mocks.getCachedCalendarAccessToken).not.toHaveBeenCalled()
    expect(mocks.prisma.bookingCalendarEvent.findMany).not.toHaveBeenCalled()
    expect(mocks.cleanupExpiredChatbotConversations).not.toHaveBeenCalled()
  })

  it("returns cleanup summary from the daily reconcile cron", async () => {
    const response = await GET(request())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      reconciledCount: 0,
      failedCount: 0,
      rollbackCount: 0,
      eventVerifiedCount: 0,
      eventRecreatedCount: 0,
      eventUpdatedCount: 0,
      eventDeletedCount: 0,
      eventPendingCount: 0,
      chatbotCleanup: {
        ok: true,
        cutoffIso: "2026-04-26T00:00:00.000Z",
        retentionDays: 30,
        scannedConversationCount: 1,
        deletedConversationCount: 1,
        deletedMessageCount: 2,
        deletedAuditEventCount: 3,
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
      eventVerifiedCount: 0,
      eventRecreatedCount: 0,
      eventUpdatedCount: 0,
      eventDeletedCount: 0,
      eventPendingCount: 0,
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
      eventVerifiedCount: 0,
      eventRecreatedCount: 0,
      eventUpdatedCount: 0,
      eventDeletedCount: 0,
      eventPendingCount: 0,
      chatbotCleanup: {
        ok: true,
        cutoffIso: "2026-04-26T00:00:00.000Z",
        retentionDays: 30,
        scannedConversationCount: 1,
        deletedConversationCount: 1,
        deletedMessageCount: 2,
        deletedAuditEventCount: 3,
        deletedSurveyResponseCount: 0,
        deletedInquiryCount: 1,
        unlinkedBookingGroupCount: 1,
      },
    })
  })

  it("resumes a durable calendar replacement even when no event is currently pending", async () => {
    mocks.prisma.bookingGroup.findMany
      .mockResolvedValueOnce([{ id: "group_replace" }])
      .mockResolvedValueOnce([])

    const response = await GET(request())

    expect(response.status).toBe(200)
    expect(mocks.continueBookingGroupCalendarReplacement).toHaveBeenCalledWith({
      bookingGroupId: "group_replace",
      calendarId: "primary",
      accessToken: "access-token",
    })
  })
})
