import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  findAccessibleSlot: vi.fn(),
  findConflictingBookings: vi.fn(),
  isAdmin: vi.fn(),
  invalidateCalendarFreeBusyCacheForUser: vi.fn(),
  getCachedCalendarAccessToken: vi.fn(),
  deleteCalendarEvent: vi.fn(),
  updateCalendarEvent: vi.fn(),
  sendBookingTimeChangedEmail: vi.fn(),
  prisma: {
    bookingGroup: {
      update: vi.fn(),
      delete: vi.fn(),
    },
    bookingTimeSlot: {
      update: vi.fn(),
    },
  },
}))

vi.mock("@/auth", () => ({ auth: mocks.auth }))
vi.mock("@/lib/auth/server/is-admin", () => ({ isAdmin: mocks.isAdmin }))
vi.mock("@/lib/booking/server/edit-access", () => ({ findAccessibleSlot: mocks.findAccessibleSlot }))
vi.mock("@/lib/booking/server/conflicts", () => ({ findConflictingBookings: mocks.findConflictingBookings }))
vi.mock("@/lib/booking/server/calendar-free-busy/free-busy", () => ({
  invalidateCalendarFreeBusyCacheForUser: mocks.invalidateCalendarFreeBusyCacheForUser,
}))
vi.mock("@/lib/booking/server/calendar-free-busy/google-token-cache", () => ({
  getCachedCalendarAccessToken: mocks.getCachedCalendarAccessToken,
}))
vi.mock("@/lib/booking/server/email", () => ({ sendBookingTimeChangedEmail: mocks.sendBookingTimeChangedEmail }))
vi.mock("@/lib/google-calendar/server", () => ({
  CALENDAR_TOKEN_USER_ID: "satoshi-calendar-owner",
  deleteCalendarEvent: mocks.deleteCalendarEvent,
  updateCalendarEvent: mocks.updateCalendarEvent,
}))
vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }))

import { DELETE, GET, PATCH } from "@/app/api/booking/[id]/route"

function request(method: string, body?: unknown, headers?: HeadersInit, url = "http://localhost/api/booking/slot_1") {
  const raw = body === undefined ? undefined : JSON.stringify(body)
  return new NextRequest(url, {
    method,
    body: raw,
    headers: headers ?? (raw === undefined ? undefined : { "Content-Length": String(Buffer.byteLength(raw)) }),
  })
}

function context(id = "slot_1") {
  return { params: Promise.resolve({ id }) }
}

function accessibleBooking(overrides: Record<string, unknown> = {}) {
  const detailsOverrides = (overrides.details ?? {}) as Record<string, unknown>
  return {
    bookingId: "slot_1",
    bookingGroupId: "group_1",
    scope: "owner",
    gcalEventId: null,
    details: {
      projectTitle: "Project",
      contactName: "Satoshi",
      customerEmail: "client@example.com",
      phone: null,
      companyName: null,
      memo: null,
      dueDate: null,
      teamId: null,
      customerUserId: "user_1",
      status: "CONFIRMED",
      ...detailsOverrides,
    },
    timeSlots: [
      {
        id: "slot_1",
        startTime: "2099-05-20T00:00:00.000Z",
        endTime: "2099-05-20T01:00:00.000Z",
        status: "CONFIRMED",
      },
    ],
    ...overrides,
  }
}

describe("/api/booking/[id] extra route coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.GOOGLE_CALENDAR_BUSY_SOURCE_ID
    mocks.auth.mockResolvedValue({ user: { id: "user_1", email: "user@example.com" } })
    mocks.isAdmin.mockReturnValue(false)
    mocks.findAccessibleSlot.mockResolvedValue(accessibleBooking())
    mocks.findConflictingBookings.mockResolvedValue([])
    mocks.prisma.bookingGroup.update.mockResolvedValue({ id: "group_1", bufferBeforeHours: 0.5, bufferAfterHours: 1 })
    mocks.prisma.bookingTimeSlot.update.mockResolvedValue({ id: "slot_1", bookingGroupId: "group_1" })
    mocks.getCachedCalendarAccessToken.mockResolvedValue({ token: "access-token" })
  })

  it("returns accessible booking details from GET", async () => {
    const response = await GET(request("GET"), context())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      bookingId: "slot_1",
      bookingGroupId: "group_1",
      scope: "owner",
    })
  })

  it("returns 413 for oversized PATCH before loading auth", async () => {
    const response = await PATCH(request("PATCH", {}, { "content-length": "65537" }), context())

    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toEqual({ error: "payload_too_large" })
    expect(mocks.auth).not.toHaveBeenCalled()
  })

  it("updates editable booking details and normalizes blank nullable fields", async () => {
    const response = await PATCH(
      request("PATCH", {
        action: "update_details",
        projectTitle: "  Updated Project  ",
        contactName: "  Updated Contact  ",
        phone: " ",
        companyName: " Studio ",
        memo: " ",
        dueDate: " ",
      }),
      context(),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      action: "update_details",
      bookingGroupId: "group_1",
    })
    expect(mocks.prisma.bookingGroup.update).toHaveBeenCalledWith({
      where: { id: "group_1" },
      data: {
        projectTitle: "Updated Project",
        contactName: "Updated Contact",
        phone: null,
        companyName: "Studio",
        memo: null,
        dueDate: null,
      },
    })
  })

  it("allows an admin hard delete and removes the calendar event", async () => {
    mocks.isAdmin.mockReturnValue(true)
    mocks.findAccessibleSlot.mockResolvedValue(accessibleBooking({ scope: "admin", gcalEventId: "gcal_1" }))
    mocks.deleteCalendarEvent.mockResolvedValue({})
    mocks.prisma.bookingGroup.delete.mockResolvedValue({})

    const response = await DELETE(request("DELETE", undefined, undefined, "http://localhost/api/booking/slot_1?mode=hard"), context())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ status: "ok", mode: "hard", bookingGroupId: "group_1" })
    expect(mocks.deleteCalendarEvent).toHaveBeenCalledWith("gcal_1")
    expect(mocks.prisma.bookingGroup.delete).toHaveBeenCalledWith({ where: { id: "group_1" } })
  })

  it("updates an admin before-buffer and refreshes the calendar event", async () => {
    process.env.GOOGLE_CALENDAR_BUSY_SOURCE_ID = "calendar_1"
    mocks.isAdmin.mockReturnValue(true)
    mocks.findAccessibleSlot.mockResolvedValue(accessibleBooking({ scope: "admin", gcalEventId: "gcal_1" }))
    mocks.updateCalendarEvent.mockResolvedValue({})

    const response = await PATCH(
      request("PATCH", { action: "resize_buffer", side: "before", hours: 0.5 }),
      context(),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      action: "resize_buffer",
      bookingGroupId: "group_1",
      side: "before",
      hours: 0.5,
    })
    expect(mocks.findConflictingBookings).toHaveBeenCalledWith(
      new Date("2099-05-19T23:30:00.000Z"),
      new Date("2099-05-20T00:00:00.000Z"),
      { excludeBookingId: "slot_1" },
    )
    expect(mocks.updateCalendarEvent).toHaveBeenCalledWith(expect.objectContaining({
      calendarId: "calendar_1",
      eventId: "gcal_1",
      accessToken: "access-token",
      bufferBeforeHours: 0.5,
      bufferAfterHours: 1,
    }))
    expect(mocks.invalidateCalendarFreeBusyCacheForUser).toHaveBeenCalledWith("user_1", null)
  })
})
