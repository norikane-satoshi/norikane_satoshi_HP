import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { BookingApiInput } from "@/lib/booking/domain/api-schema"
import { bookingDetailsMemo } from "@/lib/chatbot/domain/booking-details"

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
    requestedDates: [],
    ...overrides,
  }
}

async function loadCreateBooking() {
  vi.resetModules()
  vi.stubEnv("GOOGLE_CALENDAR_BUSY_SOURCE_ID", "calendar_1")

  const createCalendarEvent = vi.fn().mockResolvedValue({ id: "gcal_1" })
  const invalidateCalendarFreeBusyCacheForUser = vi.fn()
  const sendBookingConfirmedEmail = vi.fn().mockResolvedValue({ skipped: true })
  const calendarEventRows: Array<Record<string, unknown>> = []
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
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({
        id: "group_1",
        timeSlots: [],
      }),
      update: vi.fn().mockResolvedValue({}),
    },
    bookingCalendarEvent: {
      createMany: vi.fn().mockImplementation(({ data }) => {
        calendarEventRows.push(...data.map((row: Record<string, unknown>, index: number) => ({
          id: `intent_${calendarEventRows.length + index + 1}`,
          attemptCount: 0,
          lastErrorCode: null,
          lastAttemptAt: null,
          lastVerifiedAt: null,
          createdAt: new Date("2026-06-01T00:00:00.000Z"),
          updatedAt: new Date("2026-06-01T00:00:00.000Z"),
          ...row,
        })))
        return { count: data.length }
      }),
      findMany: vi.fn().mockImplementation(({ where }) => calendarEventRows.filter((row) => {
        if (row.bookingGroupId !== where.bookingGroupId) return false
        if (where.eventId?.in && !where.eventId.in.includes(row.eventId)) return false
        if (where.status?.in && !where.status.in.includes(row.status)) return false
        if (where.status?.not && row.status === where.status.not) return false
        return true
      })),
      update: vi.fn().mockImplementation(({ where, data }) => {
        const row = calendarEventRows.find((candidate) => candidate.eventId === where.eventId)
        if (row) Object.assign(row, data, {
          attemptCount: typeof data.attemptCount?.increment === "number"
            ? Number(row.attemptCount ?? 0) + data.attemptCount.increment
            : data.attemptCount ?? row.attemptCount,
        })
        return row ?? {}
      }),
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
    calendarEventRows,
  }
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
  vi.clearAllMocks()
})

describe("createBookingFromApiInput", () => {
  let service: Awaited<ReturnType<typeof loadCreateBooking>>

  beforeEach(async () => {
    service = await loadCreateBooking()
  })

  it.each([[], ["2026-10-13"]])("keeps desired and unavailable dates before the canonical details in persisted sync notes (%j)", async (...requestedDates) => {
    const memo = bookingDetailsMemo("都合の悪い日: 10月20日", [
      { label: "納品希望日の理由", value: "映画祭応募" }, { label: "納品希望日", value: "2026-10-25" },
    ])
    await service.createBookingFromApiInput({ input: bookingInput({ memo, requestedDates }), originatedFrom: "chatbot", userId: "user_1", userEmail: "client@example.com" })
    const storedMemo = service.prisma.bookingGroup.create.mock.calls[0][0].data.memo
    expect(storedMemo.split("\n").map((line: string) => line.split(":")[0])).toEqual(["希望日", "都合の悪い日", "納品希望日", "納品希望日の理由"])
  })

  it.each([["0時間18分", "18分"], ["1時間18分", "1時間18分"], ["未定", "未確認"]])("carries reviewed duration %s into calendar descriptions and booking mail", async (value, canonical) => {
    const memo = bookingDetailsMemo("", [{ label: "尺", value }])
    await service.createBookingFromApiInput({
      input: bookingInput({ memo, requestedDates: ["2026-10-13"] }),
      originatedFrom: "chatbot", userId: "user_1", userEmail: "satoshi@example.com",
    })
    expect(memo).toContain(`尺: ${canonical}`)
    expect(service.prisma.bookingGroup.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ memo: expect.stringContaining(memo) }),
    }))
    expect(service.createCalendarEvent).toHaveBeenCalledWith(expect.objectContaining({ description: expect.stringContaining(memo) }))
    expect(service.sendBookingConfirmedEmail).toHaveBeenCalledWith(expect.objectContaining({ memo }))
  })
  it("carries confirmed and unconfirmed chatbot facts unchanged into storage, calendar descriptions and booking mail", async () => {
    const memo = "案件種別: 短編ドキュメンタリー\n尺: 約18分\n最終媒体: 未確認\n納品形式: ProRes 422 HQ（Rec.709）、DCP不要"
    await service.createBookingFromApiInput({
      input: bookingInput({ memo, requestedDates: ["2026-10-13"] }),
      originatedFrom: "chatbot", userId: "user_1", userEmail: "satoshi@example.com",
    })
    expect(service.prisma.bookingGroup.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ memo: expect.stringContaining(memo) }),
    }))
    expect(service.createCalendarEvent).toHaveBeenCalledWith(expect.objectContaining({ description: expect.stringContaining(memo) }))
    expect(service.sendBookingConfirmedEmail).toHaveBeenCalledWith(expect.objectContaining({ memo }))
  })
  it("returns the existing chatbot booking for the same idempotency key without repeating side effects", async () => {
    service.prisma.bookingGroup.findUnique.mockResolvedValueOnce({
      id: "group_existing",
      status: "NEEDS_SCHEDULE",
      timeSlots: [],
    })

    const result = await service.createBookingFromApiInput({
      input: bookingInput(),
      originatedFrom: "chatbot",
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
      userId: "public_chatbot_user_1",
      userEmail: "client@example.com",
    })

    expect(result).toMatchObject({
      status: 200,
      body: {
        status: "schedule_unselected",
        bookingGroupId: "group_existing",
        bookingIds: [],
        bookingStatus: "NEEDS_SCHEDULE",
        scheduleStatus: "unscheduled",
        idempotentReplay: true,
      },
    })
    expect(service.prisma.customer.upsert).not.toHaveBeenCalled()
    expect(service.prisma.$transaction).not.toHaveBeenCalled()
    expect(service.createCalendarEvent).not.toHaveBeenCalled()
    expect(service.sendBookingConfirmedEmail).not.toHaveBeenCalled()
  })

  it("passes confirmed condition memo to the customer receipt without estimates", async () => {
    const memo = "尺: 18分\n納品形式: ProRes 422 HQ、Rec.709\n納品希望日: 2026-10-25"
    await service.createBookingFromApiInput({ input: bookingInput({ memo }), originatedFrom: "chatbot", userId: "public_user", userEmail: "client@example.com" })
    expect(service.sendBookingConfirmedEmail).toHaveBeenCalledWith(expect.objectContaining({ memo }))
    const args = service.sendBookingConfirmedEmail.mock.calls[0][0]
    expect(args).not.toHaveProperty("scheduleLines")
    expect(args).not.toHaveProperty("otherWorkDetail")
  })

  it("recovers an idempotency race from the unique database constraint", async () => {
    service.prisma.bookingGroup.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "group_winner", status: "NEEDS_SCHEDULE", timeSlots: [] })
    service.prisma.bookingGroup.create.mockRejectedValueOnce(
      Object.assign(new Error("unique"), { code: "P2002" }),
    )

    const result = await service.createBookingFromApiInput({
      input: bookingInput(),
      originatedFrom: "chatbot",
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
      userId: "public_chatbot_user_1",
      userEmail: "client@example.com",
    })

    expect(result).toMatchObject({
      status: 200,
      body: { bookingGroupId: "group_winner", idempotentReplay: true },
    })
    expect(service.prisma.bookingGroup.create).toHaveBeenCalledOnce()
    expect(service.createCalendarEvent).not.toHaveBeenCalled()
    expect(service.sendBookingConfirmedEmail).not.toHaveBeenCalled()
  })

  it("creates selected-slot calendar entries as tentative holds", async () => {

    await service.createBookingFromApiInput({
      input: bookingInput({
        selectedSlots: [
          {
            start: "2026-06-10T01:00:00.000Z",
            end: "2026-06-10T03:00:00.000Z",
          },
        ],
      }),
      userId: "user_1",
      userEmail: "satoshi@example.com",
    })

    expect(service.createCalendarEvent).toHaveBeenCalledWith(expect.objectContaining({
      summary: "【仮キープ】Color grading / Satoshi",
      notionTaskType: "仮押さえ",
    }))
    expect(service.sendBookingConfirmedEmail).toHaveBeenCalledWith(expect.objectContaining({
      bookingGroupId: "group_1",
      selectedSlots: [
        {
          start: "2026-06-10T01:00:00.000Z",
          end: "2026-06-10T03:00:00.000Z",
        },
      ],
    }))
  })

  it("passes chatbot Notion task type to the Google Calendar event for reverse sync only when requested", async () => {

    await service.createBookingFromApiInput({
      input: bookingInput({
        selectedSlots: [
          {
            start: "2026-06-10T01:00:00.000Z",
            end: "2026-06-10T03:00:00.000Z",
          },
        ],
      }),
      notionTaskType: "仮押さえ",
      userId: "public_chatbot_user_1",
      userEmail: "client@example.com",
    })

    expect(service.createCalendarEvent).toHaveBeenCalledWith(expect.objectContaining({
      notionTaskType: "仮押さえ",
    }))
  })

  it("persists zero selected slots as an unscheduled chatbot booking request without creating a calendar event when no candidate date exists", async () => {

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
        scheduleLabel: "未定（日程は則兼と相談）",
      },
    })
    expect(service.prisma.bookingGroup.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "NEEDS_SCHEDULE",
          pendingExpiresAt: null,
          memo: "希望日: 未定（日程は則兼と相談）",
          timeSlots: { create: [] },
        }),
      }),
    )
    expect(service.createCalendarEvent).not.toHaveBeenCalled()
    expect(service.invalidateCalendarFreeBusyCacheForUser).not.toHaveBeenCalled()
    expect(service.sendBookingConfirmedEmail).toHaveBeenCalledWith(expect.objectContaining({
      bookingGroupId: "group_1",
      selectedSlots: [],
    }))
  })

  it("creates a transparent all-day tentative hold for requested date arrays", async () => {

    const result = await service.createBookingFromApiInput({
      input: bookingInput({
        selectedSlots: [],
        requestedDates: ["2026-07-10", "2026-07-12", "2026-07-15"],
      }),
      userId: "user_1",
      userEmail: "satoshi@example.com",
    })

    expect(result).toMatchObject({
      status: 200,
      body: {
        status: "schedule_unselected",
        bookingGroupId: "group_1",
        bookingIds: [],
        bookingStatus: "NEEDS_SCHEDULE",
        scheduleStatus: "unscheduled",
      },
    })
    expect(result.body).toMatchObject({
      scheduleLabel: expect.stringContaining("3日間"),
    })
    expect(result.body).toMatchObject({
      scheduleLabel: expect.not.stringContaining("7/11"),
    })
    expect(service.prisma.bookingGroup.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "NEEDS_SCHEDULE",
          pendingExpiresAt: null,
          memo: expect.stringContaining("希望日:"),
          timeSlots: { create: [] },
        }),
      }),
    )
    expect(service.createCalendarEvent).toHaveBeenCalledTimes(3)
    expect(service.createCalendarEvent).toHaveBeenNthCalledWith(1, expect.objectContaining({
      summary: "【仮キープ】Color grading / Satoshi",
      start: "2026-07-10",
      end: "2026-07-11",
      colorId: "4",
      eventId: "group1",
      notionTaskType: "仮押さえ",
      dateOnly: true,
      transparency: "transparent",
    }))
    expect(service.createCalendarEvent).toHaveBeenNthCalledWith(2, expect.objectContaining({
      start: "2026-07-12",
      end: "2026-07-13",
      eventId: "group120260712",
    }))
    expect(service.createCalendarEvent).toHaveBeenNthCalledWith(3, expect.objectContaining({
      start: "2026-07-15",
      end: "2026-07-16",
      eventId: "group120260715",
    }))
    expect(service.prisma.bookingGroup.update).toHaveBeenCalledWith({
      where: { id: "group_1" },
      data: { gcalEventId: "group1", pendingExpiresAt: null },
    })
    expect(service.sendBookingConfirmedEmail).toHaveBeenCalledWith(expect.objectContaining({
      bookingGroupId: "group_1",
      requestedDates: ["2026-07-10", "2026-07-12", "2026-07-15"],
      selectedSlots: [],
    }))
  })

  it("creates one all-day event per requested date without holding unrequested gap days", async () => {
    service.createCalendarEvent.mockImplementation(async ({ eventId }: { eventId: string }) => ({ id: eventId }))

    await service.createBookingFromApiInput({
      input: bookingInput({
        selectedSlots: [],
        requestedDates: [
          "2026-11-01",
          "2026-11-03",
          "2026-11-04",
          "2026-11-05",
          "2026-11-06",
        ],
      }),
      userId: "user_1",
      userEmail: "satoshi@example.com",
    })

    expect(service.createCalendarEvent).toHaveBeenCalledTimes(5)
    expect(service.createCalendarEvent.mock.calls.map(([arg]) => ({
      start: arg.start,
      end: arg.end,
      eventId: arg.eventId,
    }))).toEqual([
      { start: "2026-11-01", end: "2026-11-02", eventId: "group1" },
      { start: "2026-11-03", end: "2026-11-04", eventId: "group120261103" },
      { start: "2026-11-04", end: "2026-11-05", eventId: "group120261104" },
      { start: "2026-11-05", end: "2026-11-06", eventId: "group120261105" },
      { start: "2026-11-06", end: "2026-11-07", eventId: "group120261106" },
    ])
    expect(service.prisma.bookingGroup.update).toHaveBeenCalledWith({
      where: { id: "group_1" },
      data: { gcalEventId: "group1", pendingExpiresAt: null },
    })
  })

  it("retries only an unfinished requested-date event on an idempotent replay", async () => {
    service.createCalendarEvent
      .mockResolvedValueOnce({ id: "group1" })
      .mockRejectedValueOnce(Object.assign(new Error("temporary"), { code: "ETIMEDOUT" }))
      .mockResolvedValueOnce({ id: "group120260712" })

    const args = {
      input: bookingInput({ requestedDates: ["2026-07-10", "2026-07-12"] }),
      originatedFrom: "chatbot" as const,
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
      userId: "public_chatbot_user_1",
      userEmail: "client@example.com",
    }
    const first = await service.createBookingFromApiInput(args)
    expect(first).toMatchObject({ status: 202, body: { status: "pending_reconcile" } })

    service.prisma.bookingGroup.findUnique.mockResolvedValueOnce({
      id: "group_1",
      status: "NEEDS_SCHEDULE",
      timeSlots: [],
      calendarEvents: service.calendarEventRows,
    })
    const replay = await service.createBookingFromApiInput(args)

    expect(replay).toMatchObject({
      status: 200,
      body: { bookingGroupId: "group_1", idempotentReplay: true },
    })
    expect(service.createCalendarEvent).toHaveBeenCalledTimes(3)
    expect(service.createCalendarEvent.mock.calls.map(([call]) => call.eventId)).toEqual([
      "group1",
      "group120260712",
      "group120260712",
    ])
  })
})
