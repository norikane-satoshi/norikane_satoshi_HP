import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  createCalendarEvent: vi.fn(),
  deleteCalendarEventWithAccessToken: vi.fn(),
  getCalendarEvent: vi.fn(),
  requestCalendarEventCancellation: vi.fn(),
  updateCalendarEvent: vi.fn(),
  bookingCalendarEvent: {
    update: vi.fn(),
    updateMany: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    count: vi.fn(),
    upsert: vi.fn(),
    createMany: vi.fn(),
  },
  bookingGroup: { findUnique: vi.fn(), update: vi.fn() },
  bookingTimeSlot: { updateMany: vi.fn() },
  transaction: vi.fn(),
}))

vi.mock("@/lib/google-calendar/server", () => ({
  HP_BOOKING_CANCEL_ACK_KEY: "hp_booking_cancel_acknowledged",
  createCalendarEvent: mocks.createCalendarEvent,
  deleteCalendarEventWithAccessToken: mocks.deleteCalendarEventWithAccessToken,
  getCalendarEvent: mocks.getCalendarEvent,
  requestCalendarEventCancellation: mocks.requestCalendarEventCancellation,
  updateCalendarEvent: mocks.updateCalendarEvent,
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    bookingCalendarEvent: mocks.bookingCalendarEvent,
    bookingGroup: mocks.bookingGroup,
    bookingTimeSlot: mocks.bookingTimeSlot,
    $transaction: mocks.transaction,
  },
}))

import {
  BOOKING_CALENDAR_EVENT_STATUS,
  buildRequestedDateCalendarEventIntents,
  cancelBookingGroupCalendarEvents,
  continueBookingGroupCalendarReplacement,
  replaceBookingGroupCalendarEventIntents,
  requestedDateRanges,
  syncCalendarEventIntent,
} from "../calendar-event-lifecycle"

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: "intent_1",
    bookingGroupId: "group_1",
    eventId: "group1",
    startValue: "2026-11-01",
    endValue: "2026-11-02",
    dateOnly: true,
    summary: "summary",
    description: "description",
    colorId: "4",
    notionTaskType: "仮押さえ",
    transparency: "transparent",
    status: BOOKING_CALENDAR_EVENT_STATUS.pendingCreate,
    attemptCount: 0,
    lastErrorCode: null,
    lastAttemptAt: null,
    lastVerifiedAt: null,
    createdAt: new Date("2026-09-12T00:00:00.000Z"),
    updatedAt: new Date("2026-09-12T00:00:00.000Z"),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.bookingCalendarEvent.update.mockResolvedValue({})
  mocks.bookingGroup.update.mockResolvedValue({})
  mocks.bookingGroup.findUnique.mockResolvedValue({ contactName: "Client", companyName: "Studio" })
  mocks.bookingTimeSlot.updateMany.mockResolvedValue({ count: 0 })
  mocks.bookingCalendarEvent.count.mockResolvedValue(0)
  mocks.createCalendarEvent.mockResolvedValue({ id: "group1" })
  mocks.deleteCalendarEventWithAccessToken.mockResolvedValue(undefined)
  mocks.requestCalendarEventCancellation.mockResolvedValue(undefined)
  mocks.transaction.mockImplementation(async (input) => {
    if (Array.isArray(input)) return Promise.all(input)
    return input({
      bookingCalendarEvent: mocks.bookingCalendarEvent,
      bookingGroup: mocks.bookingGroup,
    })
  })
})

describe("booking calendar event lifecycle", () => {
  it("normalizes arbitrary dates into consecutive exclusive-end ranges", () => {
    expect(requestedDateRanges([
      "2026-11-06",
      "2026-11-01",
      "2026-11-04",
      "2026-11-03",
      "2026-11-05",
      "2026-11-03",
    ])).toEqual([
      { start: "2026-11-01", end: "2026-11-02" },
      { start: "2026-11-03", end: "2026-11-07" },
    ])
  })

  it("builds one all-day event with a stable id per requested date", () => {
    const intents = buildRequestedDateCalendarEventIntents({
      bookingGroupId: "group_1",
      dates: ["2026-11-04", "2026-11-01", "2026-11-03", "2026-11-03"],
      summary: "summary",
      description: "description",
    })
    expect(intents.map((intent) => ({ id: intent.eventId, start: intent.startValue, end: intent.endValue }))).toEqual([
      { id: "group1", start: "2026-11-01", end: "2026-11-02" },
      { id: "group120261103", start: "2026-11-03", end: "2026-11-04" },
      { id: "group120261104", start: "2026-11-04", end: "2026-11-05" },
    ])
    expect(intents.every((intent) => intent.dateOnly)).toBe(true)
  })

  it("recreates a confirmed event that disappeared from Google Calendar", async () => {
    mocks.getCalendarEvent.mockResolvedValue(null)
    const result = await syncCalendarEventIntent({
      event: event({ status: BOOKING_CALENDAR_EVENT_STATUS.confirmed }),
      calendarId: "calendar_1",
      accessToken: "token",
      verifyConfirmed: true,
    })
    expect(result).toEqual({ eventId: "group1", action: "created", ok: true })
    expect(mocks.createCalendarEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventId: "group1", customerName: "Client", customerCompany: "Studio",
    }))
    expect(mocks.bookingCalendarEvent.update).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { eventId: "group1" },
      data: expect.objectContaining({ status: BOOKING_CALENDAR_EVENT_STATUS.confirmed }),
    }))
  })

  it("repairs managed-field drift while retaining an observed booking confirmation", async () => {
    mocks.getCalendarEvent.mockResolvedValue({
      id: "group1",
      bookingGroupId: "group_1",
      privateProperties: { booking_group_id: "group_1" },
      start: "2026-11-08",
      end: "2026-11-09",
      dateOnly: true,
      summary: "drifted",
      description: "drifted",
      colorId: "9",
      notionTaskType: "本予約",
      transparency: "opaque",
    })

    const result = await syncCalendarEventIntent({
      event: event({ status: BOOKING_CALENDAR_EVENT_STATUS.confirmed }),
      calendarId: "calendar_1",
      accessToken: "token",
      verifyConfirmed: true,
    })

    expect(result).toEqual({ eventId: "group1", action: "updated", ok: true })
    expect(mocks.updateCalendarEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventId: "group1",
      start: "2026-11-01",
      end: "2026-11-02",
      dateOnly: true,
      summary: "summary",
      description: "description",
      colorId: "4",
      notionTaskType: "本予約",
      bookingGroupId: "group_1",
      transparency: "opaque",
    }))
  })

  it.each([
    BOOKING_CALENDAR_EVENT_STATUS.confirmed,
    BOOKING_CALENDAR_EVENT_STATUS.pendingUpdate,
  ])("preserves an externally promoted booking during %s synchronization", async (status) => {
    const oldHold = event({ status, summary: "【仮キープ】案件 / Client（候補 1/2）（立ち会い）" })
    mocks.getCalendarEvent.mockResolvedValue({
      id: oldHold.eventId, bookingGroupId: oldHold.bookingGroupId,
      start: oldHold.startValue, end: oldHold.endValue, dateOnly: true,
      summary: "案件 / Client（立ち会い）", description: oldHold.description,
      colorId: oldHold.colorId, notionTaskType: "本予約", transparency: "opaque",
      privateProperties: { customer_name: "Client", customer_company: "Studio", notion_task_type: "本予約" },
    })
    const result = await syncCalendarEventIntent({
      event: oldHold, calendarId: "calendar_1", accessToken: "token", verifyConfirmed: true,
    })
    expect(result.ok).toBe(true)
    expect(mocks.bookingCalendarEvent.update).toHaveBeenCalledWith({
      where: { eventId: oldHold.eventId },
      data: { notionTaskType: "本予約", summary: "案件 / Client（立ち会い）", transparency: "opaque" },
    })
    if (status === BOOKING_CALENDAR_EVENT_STATUS.confirmed) {
      expect(result.action).toBe("verified")
      expect(mocks.updateCalendarEvent).not.toHaveBeenCalled()
    } else {
      expect(result.action).toBe("updated")
      expect(mocks.updateCalendarEvent).toHaveBeenCalledWith(expect.objectContaining({
        eventId: oldHold.eventId, notionTaskType: "本予約",
        summary: "案件 / Client（立ち会い）", transparency: "opaque",
      }))
    }
    expect(mocks.createCalendarEvent).not.toHaveBeenCalled()
    expect(mocks.bookingGroup.update).not.toHaveBeenCalled()
  })

  it("refuses to overwrite a deterministic event id owned by another group", async () => {
    mocks.getCalendarEvent.mockResolvedValue({
      id: "group1",
      bookingGroupId: "another_group",
      privateProperties: { booking_group_id: "another_group" },
    })

    const result = await syncCalendarEventIntent({
      event: event({ status: BOOKING_CALENDAR_EVENT_STATUS.confirmed }),
      calendarId: "calendar_1",
      accessToken: "token",
      verifyConfirmed: true,
    })

    expect(result.ok).toBe(false)
    expect(mocks.updateCalendarEvent).not.toHaveBeenCalled()
    expect(mocks.bookingCalendarEvent.update).toHaveBeenLastCalledWith({
      where: { eventId: "group1" },
      data: { lastErrorCode: "calendar_event_ownership_mismatch" },
    })
  })

  it("keeps a failed create pending and records an operational error", async () => {
    mocks.createCalendarEvent.mockRejectedValue(Object.assign(new Error("temporary"), { code: "ETIMEDOUT" }))
    const result = await syncCalendarEventIntent({
      event: event(),
      calendarId: "calendar_1",
      accessToken: "token",
    })
    expect(result.ok).toBe(false)
    expect(mocks.bookingCalendarEvent.update).toHaveBeenLastCalledWith({
      where: { eventId: "group1" },
      data: { lastErrorCode: "ETIMEDOUT" },
    })
  })

  it("updates an existing all-day event without losing its group identity", async () => {
    mocks.getCalendarEvent.mockResolvedValue({ id: "group1" })
    const result = await syncCalendarEventIntent({
      event: event({ status: BOOKING_CALENDAR_EVENT_STATUS.pendingUpdate }),
      calendarId: "calendar_1",
      accessToken: "token",
    })

    expect(result).toEqual({ eventId: "group1", action: "updated", ok: true })
    expect(mocks.updateCalendarEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventId: "group1",
      start: "2026-11-01",
      end: "2026-11-02",
      dateOnly: true,
      customerName: "Client",
      customerCompany: "Studio",
    }))
  })

  it("confirms the same booking day in place while preserving its stage", async () => {
    mocks.getCalendarEvent.mockResolvedValue({ id: "group1", bookingGroupId: "group_1" })
    const result = await syncCalendarEventIntent({
      event: event({
        status: BOOKING_CALENDAR_EVENT_STATUS.pendingUpdate,
        notionTaskType: "本予約",
        summary: "【仮キープ】案件 / Client（候補 1/2）（立ち会い）",
      }),
      calendarId: "calendar_1",
      accessToken: "token",
    })
    expect(result).toEqual({ eventId: "group1", action: "updated", ok: true })
    expect(mocks.createCalendarEvent).not.toHaveBeenCalled()
    expect(mocks.updateCalendarEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventId: "group1", bookingGroupId: "group_1", notionTaskType: "本予約",
      summary: "案件 / Client（立ち会い）", customerName: "Client", customerCompany: "Studio",
    }))
  })

  it("repairs missing customer metadata and accepts the repaired confirmed title", async () => {
    const confirmed = event({
      status: BOOKING_CALENDAR_EVENT_STATUS.confirmed,
      notionTaskType: "本予約",
      summary: "【仮キープ】案件 / Client（候補 1/2）（QC）",
    })
    const snapshot = {
      id: "group1", bookingGroupId: "group_1", start: confirmed.startValue,
      end: confirmed.endValue, dateOnly: true, summary: "案件 / Client（QC）",
      description: confirmed.description, colorId: confirmed.colorId,
      notionTaskType: "本予約", transparency: "transparent", privateProperties: {},
    }
    mocks.getCalendarEvent.mockResolvedValue(snapshot)
    expect((await syncCalendarEventIntent({ event: confirmed, calendarId: "calendar_1", accessToken: "token", verifyConfirmed: true })).action).toBe("updated")
    mocks.updateCalendarEvent.mockClear()
    mocks.getCalendarEvent.mockResolvedValue({
      ...snapshot, privateProperties: { customer_name: "Client", customer_company: "Studio" },
    })
    expect((await syncCalendarEventIntent({ event: confirmed, calendarId: "calendar_1", accessToken: "token", verifyConfirmed: true })).action).toBe("verified")
    expect(mocks.updateCalendarEvent).not.toHaveBeenCalled()
  })

  it("treats an unchanged confirmed replacement as complete before deleting obsolete events", async () => {
    const existing = event({ status: BOOKING_CALENDAR_EVENT_STATUS.confirmed })
    mocks.bookingCalendarEvent.findUnique.mockResolvedValue(existing)
    mocks.bookingCalendarEvent.upsert.mockResolvedValue(existing)
    mocks.bookingCalendarEvent.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ eventId: "group1", status: BOOKING_CALENDAR_EVENT_STATUS.confirmed }])

    const result = await replaceBookingGroupCalendarEventIntents({
      bookingGroupId: "group_1",
      intents: [{
        eventId: "group1",
        startValue: "2026-11-01",
        endValue: "2026-11-02",
        dateOnly: true,
        summary: "summary",
        description: "description",
        colorId: "4",
        notionTaskType: "仮押さえ",
        transparency: "transparent",
      }],
      calendarId: "calendar_1",
      accessToken: "token",
    })

    expect(result.complete).toBe(true)
    expect(result.upsertResults).toEqual([])
    expect(mocks.bookingGroup.update).toHaveBeenLastCalledWith({
      where: { id: "group_1" },
      data: {
        status: "NEEDS_SCHEDULE",
        gcalEventId: "group1",
        pendingExpiresAt: null,
      },
    })
  })

  it("finishes a crashed replacement only after desired coverage exists", async () => {
    mocks.getCalendarEvent.mockResolvedValue({
      id: "group120261103",
      privateProperties: { hp_booking_cancel_acknowledged: "1" },
    })
    mocks.bookingCalendarEvent.findMany
      .mockResolvedValueOnce([
        { eventId: "group1", status: BOOKING_CALENDAR_EVENT_STATUS.confirmed },
        { eventId: "group120261103", status: BOOKING_CALENDAR_EVENT_STATUS.superseded },
      ])
      .mockResolvedValueOnce([
        event({ eventId: "group120261103", status: BOOKING_CALENDAR_EVENT_STATUS.pendingDelete }),
      ])

    const result = await continueBookingGroupCalendarReplacement({
      bookingGroupId: "group_1",
      calendarId: "calendar_1",
      accessToken: "token",
    })

    expect(result.complete).toBe(true)
    expect(mocks.bookingCalendarEvent.updateMany).toHaveBeenCalledWith({
      where: {
        eventId: { in: ["group120261103"] },
        status: BOOKING_CALENDAR_EVENT_STATUS.superseded,
      },
      data: { status: BOOKING_CALENDAR_EVENT_STATUS.pendingDelete },
    })
    expect(mocks.deleteCalendarEventWithAccessToken).toHaveBeenCalledWith({
      calendarId: "calendar_1",
      eventId: "group120261103",
      accessToken: "token",
    })
  })

  it("keeps superseded coverage while a replacement event is still pending", async () => {
    mocks.bookingCalendarEvent.findMany.mockResolvedValue([
      { eventId: "group1", status: BOOKING_CALENDAR_EVENT_STATUS.pendingCreate },
      { eventId: "group120261103", status: BOOKING_CALENDAR_EVENT_STATUS.superseded },
    ])

    const result = await continueBookingGroupCalendarReplacement({
      bookingGroupId: "group_1",
      calendarId: "calendar_1",
      accessToken: "token",
    })

    expect(result).toEqual({ complete: false, deleteResults: [] })
    expect(mocks.bookingCalendarEvent.updateMany).not.toHaveBeenCalled()
    expect(mocks.deleteCalendarEventWithAccessToken).not.toHaveBeenCalled()
  })

  it("marks every group event pending-delete before deleting and settles the group", async () => {
    const events = [
      event({ eventId: "group1", status: BOOKING_CALENDAR_EVENT_STATUS.pendingDelete }),
      event({ id: "intent_2", eventId: "group120261103", status: BOOKING_CALENDAR_EVENT_STATUS.pendingDelete }),
    ]
    mocks.bookingGroup.findUnique.mockResolvedValue({
      id: "group_1",
      gcalEventId: "group1",
      projectTitle: "Project",
      contactName: "Client",
      memo: null,
      calendarEvents: events,
      timeSlots: [],
    })
    mocks.bookingCalendarEvent.updateMany.mockResolvedValue({ count: 2 })
    mocks.bookingCalendarEvent.findMany.mockResolvedValue(events)
    mocks.bookingCalendarEvent.count.mockResolvedValue(0)
    mocks.getCalendarEvent.mockResolvedValue({
      id: "existing",
      privateProperties: { hp_booking_cancel_acknowledged: "1" },
    })

    const result = await cancelBookingGroupCalendarEvents({
      bookingGroupId: "group_1",
      calendarId: "calendar_1",
      accessToken: "token",
    })

    expect(result.complete).toBe(true)
    expect(mocks.deleteCalendarEventWithAccessToken.mock.calls.map(([call]) => call.eventId)).toEqual([
      "group1",
      "group120261103",
    ])
    expect(mocks.bookingGroup.update).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "CANCELLED", gcalEventId: null }),
    }))
  })

  it("requests a transparent cancellation before deleting a mirrored event", async () => {
    mocks.getCalendarEvent.mockResolvedValue({
      id: "group1",
      privateProperties: { notion_page_id: "page-1" },
    })

    const result = await syncCalendarEventIntent({
      event: event({ status: BOOKING_CALENDAR_EVENT_STATUS.pendingDelete }),
      calendarId: "calendar_1",
      accessToken: "token",
    })

    expect(result).toEqual({ eventId: "group1", action: "delete_requested", ok: false })
    expect(mocks.requestCalendarEventCancellation).toHaveBeenCalledWith({
      calendarId: "calendar_1",
      eventId: "group1",
      bookingGroupId: "group_1",
      accessToken: "token",
    })
    expect(mocks.deleteCalendarEventWithAccessToken).not.toHaveBeenCalled()
  })

  it("names each hold for its part of the job, one event per day", () => {
    const intents = buildRequestedDateCalendarEventIntents({
      bookingGroupId: "group1",
      dates: ["2026-10-09", "2026-10-10", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15"],
      summary: "【仮キープ】案件 / 氏名",
      description: "工程",
      dateLabels: {
        "2026-10-09": "仕込み",
        "2026-10-10": "仕込み",
        "2026-10-12": "仕込み",
        "2026-10-13": "立ち会い",
        "2026-10-14": "立ち会い",
        "2026-10-15": "QC",
      },
    })

    expect(intents.map((intent) => [intent.startValue, intent.endValue, intent.summary])).toEqual([
      ["2026-10-09", "2026-10-10", "【仮キープ】案件 / 氏名（仕込み）"],
      ["2026-10-10", "2026-10-11", "【仮キープ】案件 / 氏名（仕込み）"],
      ["2026-10-12", "2026-10-13", "【仮キープ】案件 / 氏名（仕込み）"],
      ["2026-10-13", "2026-10-14", "【仮キープ】案件 / 氏名（立ち会い）"],
      ["2026-10-14", "2026-10-15", "【仮キープ】案件 / 氏名（立ち会い）"],
      ["2026-10-15", "2026-10-16", "【仮キープ】案件 / 氏名（QC）"],
    ])
    expect(new Set(intents.map((intent) => intent.eventId)).size).toBe(6)
  })
})
