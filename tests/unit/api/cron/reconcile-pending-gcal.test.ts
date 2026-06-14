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
    bookingTimeSlot: {
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    adminActionLog: {
      create: vi.fn(),
    },
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

function request(token = "secret") {
  return new NextRequest("http://localhost/api/cron/reconcile-pending-gcal", {
    headers: { authorization: `Bearer ${token}` },
  })
}

function group(overrides: Record<string, unknown> = {}) {
  return {
    id: "clwxyz123abc",
    status: "PENDING_GCAL",
    gcalEventId: null,
    timeSlots: [
      {
        id: "slot_1",
        previousStartTime: null,
        previousEndTime: null,
      },
    ],
    ...overrides,
  }
}

async function loadGet() {
  vi.resetModules()
  vi.stubEnv("CRON_SECRET", "secret")
  vi.stubEnv("GOOGLE_CALENDAR_BUSY_SOURCE_ID", "calendar_1")
  const route = await import("@/app/api/cron/reconcile-pending-gcal/route")
  return route.GET
}

describe("GET /api/cron/reconcile-pending-gcal", () => {
  const chatbotCleanup = {
    cutoffIso: "2026-04-26T00:00:00.000Z",
    retentionDays: 30,
    scannedConversationCount: 0,
    deletedConversationCount: 0,
    deletedMessageCount: 0,
    deletedSurveyResponseCount: 0,
    deletedInquiryCount: 0,
    unlinkedBookingGroupCount: 0,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    mocks.cleanupExpiredChatbotConversations.mockResolvedValue(chatbotCleanup)
    mocks.getCachedCalendarAccessToken.mockResolvedValue({ token: "access_token" })
    mocks.prisma.bookingGroup.findMany.mockResolvedValue([])
    mocks.prisma.bookingGroup.update.mockResolvedValue({})
    mocks.prisma.bookingTimeSlot.update.mockResolvedValue({})
    mocks.prisma.bookingTimeSlot.updateMany.mockResolvedValue({ count: 1 })
    mocks.prisma.adminActionLog.create.mockResolvedValue({ id: "log_1" })
  })

  it("repairs PENDING_GCAL to CONFIRMED when the Google Calendar event exists", async () => {
    mocks.prisma.bookingGroup.findMany.mockResolvedValue([group()])
    mocks.getCalendarEvent.mockResolvedValue({ id: "cl123abc" })
    const GET = await loadGet()

    const response = await GET(request())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      reconciledCount: 1,
      failedCount: 0,
      rollbackCount: 0,
      chatbotCleanup: { ok: true, ...chatbotCleanup },
    })
    expect(mocks.getCalendarEvent).toHaveBeenCalledWith({
      calendarId: "calendar_1",
      eventId: "cl123abc",
      accessToken: "access_token",
    })
    expect(mocks.prisma.bookingGroup.update).toHaveBeenCalledWith({
      where: { id: "clwxyz123abc" },
      data: {
        status: "CONFIRMED",
        gcalEventId: "cl123abc",
        pendingExpiresAt: null,
      },
    })
  })

  it("marks PENDING_GCAL as FAILED when the Google Calendar event is missing", async () => {
    mocks.prisma.bookingGroup.findMany.mockResolvedValue([group()])
    mocks.getCalendarEvent.mockResolvedValue(null)
    const GET = await loadGet()

    const response = await GET(request())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      reconciledCount: 0,
      failedCount: 1,
      rollbackCount: 0,
      chatbotCleanup: { ok: true, ...chatbotCleanup },
    })
    expect(mocks.prisma.bookingGroup.update).toHaveBeenCalledWith({
      where: { id: "clwxyz123abc" },
      data: {
        status: "FAILED",
        pendingExpiresAt: null,
      },
    })
    expect(mocks.prisma.bookingTimeSlot.updateMany).toHaveBeenCalledWith({
      where: { bookingGroupId: "clwxyz123abc" },
      data: { status: "FAILED" },
    })
  })

  it("rolls PENDING_GCAL_MOVE back to previousStartTime and previousEndTime when the event is missing", async () => {
    const previousStartTime = new Date("2026-06-10T01:00:00.000Z")
    const previousEndTime = new Date("2026-06-10T02:00:00.000Z")
    mocks.prisma.bookingGroup.findMany.mockResolvedValue([
      group({
        status: "PENDING_GCAL_MOVE",
        gcalEventId: "gcal_1",
        timeSlots: [{ id: "slot_1", previousStartTime, previousEndTime }],
      }),
    ])
    mocks.getCalendarEvent.mockResolvedValue(null)
    const GET = await loadGet()

    const response = await GET(request())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      reconciledCount: 0,
      failedCount: 0,
      rollbackCount: 1,
      chatbotCleanup: { ok: true, ...chatbotCleanup },
    })
    expect(mocks.prisma.bookingTimeSlot.update).toHaveBeenCalledWith({
      where: { id: "slot_1" },
      data: {
        startTime: previousStartTime,
        endTime: previousEndTime,
        previousStartTime: null,
        previousEndTime: null,
        status: "CONFIRMED",
      },
    })
    expect(mocks.prisma.bookingGroup.update).toHaveBeenCalledWith({
      where: { id: "clwxyz123abc" },
      data: {
        status: "CONFIRMED",
        gcalEventId: "gcal_1",
        pendingExpiresAt: null,
      },
    })
  })

  it("returns 401 without bearer authorization", async () => {
    const GET = await loadGet()

    const response = await GET(new NextRequest("http://localhost/api/cron/reconcile-pending-gcal"))

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" })
    expect(mocks.prisma.bookingGroup.findMany).not.toHaveBeenCalled()
  })
})
