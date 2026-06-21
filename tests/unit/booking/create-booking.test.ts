import { afterEach, describe, expect, it, vi } from "vitest"

import type { BookingApiInput } from "@/lib/booking/domain/api-schema"

function bookingInput(overrides: Partial<BookingApiInput> = {}): BookingApiInput {
  return {
    projectTitle: "Color grading",
    dueDate: "2026-06-30",
    companyName: "NCS",
    contactName: "Satoshi",
    sessionEmail: "satoshi@example.com",
    phone: "",
    memo: "",
    agreed: true,
    selectedSlots: [],
    ...overrides,
  }
}

async function loadCreateBooking() {
  vi.resetModules()
  vi.stubEnv("GOOGLE_CALENDAR_BUSY_SOURCE_ID", "calendar_1")

  const createCalendarEvent = vi.fn().mockResolvedValue({ id: "gcal_1" })
  const invalidateCalendarFreeBusyCacheForUser = vi.fn()
  const sendBookingConfirmedEmail = vi.fn().mockResolvedValue({ skipped: true })
  const prisma = {
    $transaction: vi.fn((callback) => callback(prisma)),
    customer: {
      upsert: vi.fn().mockResolvedValue({ id: "customer_1" }),
    },
    bookingTimeSlot: {
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    bookingGroup: {
      create: vi.fn().mockResolvedValue({
        id: "group_1",
        timeSlots: [],
      }),
      update: vi.fn().mockResolvedValue({}),
    },
    calendarToken: {
      findUnique: vi.fn().mockResolvedValue({ refreshToken: "refresh_token" }),
      update: vi.fn().mockResolvedValue({}),
    },
    adminActionLog: {
      create: vi.fn().mockResolvedValue({ id: "log_1" }),
    },
  }

  vi.doMock("@/lib/prisma", () => ({ prisma }))
  vi.doMock("@/lib/google-calendar/server", () => ({
    CALENDAR_TOKEN_USER_ID: "satoshi-calendar-owner",
    createCalendarEvent,
    refreshCalendarAccessToken: vi.fn().mockResolvedValue({
      accessToken: "access_token",
      expiresAt: new Date("2026-06-10T00:00:00.000Z"),
      scope: "scope",
    }),
  }))
  vi.doMock("@/lib/booking/server/calendar-free-busy/free-busy", () => ({
    invalidateCalendarFreeBusyCacheForUser,
  }))
  vi.doMock("@/lib/booking/server/email", () => ({ sendBookingConfirmedEmail }))

  const createBookingModule = await import("@/lib/booking/server/create-booking")
  return {
    createBookingFromApiInput: createBookingModule.createBookingFromApiInput,
    prisma,
    createCalendarEvent,
    invalidateCalendarFreeBusyCacheForUser,
    sendBookingConfirmedEmail,
  }
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
  vi.clearAllMocks()
})

describe("createBookingFromApiInput", () => {
  it("persists zero selected slots as an unscheduled chatbot booking request without creating a calendar event", async () => {
    const service = await loadCreateBooking()

    const result = await service.createBookingFromApiInput({
      input: bookingInput(),
      userId: "user_1",
      userEmail: "satoshi@example.com",
    })

    expect(result).toEqual({
      status: 200,
      body: {
        status: "schedule_unselected",
        bookingGroupId: "group_1",
        bookingIds: [],
        bookingStatus: "NEEDS_SCHEDULE",
        scheduleStatus: "unscheduled",
        scheduleLabel: "候補日未選択",
      },
    })
    expect(service.prisma.bookingGroup.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "NEEDS_SCHEDULE",
          pendingExpiresAt: null,
          memo: "候補日未選択",
          timeSlots: { create: [] },
        }),
      }),
    )
    expect(service.createCalendarEvent).not.toHaveBeenCalled()
    expect(service.invalidateCalendarFreeBusyCacheForUser).not.toHaveBeenCalled()
    expect(service.sendBookingConfirmedEmail).not.toHaveBeenCalled()
  })
})
