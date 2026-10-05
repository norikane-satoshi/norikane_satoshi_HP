import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  insert: vi.fn(),
  get: vi.fn(),
  list: vi.fn(),
  patch: vi.fn(),
  setCredentials: vi.fn(),
}))

vi.mock("googleapis", () => {
  class OAuth2 {
    setCredentials = mocks.setCredentials
    credentials: Record<string, unknown> = {}
  }
  return {
    google: {
      auth: { OAuth2 },
      calendar: () => ({
        events: { insert: mocks.insert, get: mocks.get, list: mocks.list, patch: mocks.patch },
      }),
    },
  }
})

vi.mock("@/lib/prisma", () => ({ prisma: {} }))

import {
  createCalendarEvent,
  getCalendarEvent,
  listManagedCalendarEvents,
  requestCalendarEventCancellation,
  updateCalendarEvent,
} from "@/lib/google-calendar/server"

const baseInput = {
  calendarId: "primary",
  summary: "【予約確定】Color grading",
  description: "案件名: Color grading\n会社名: NCS",
  start: "2026-06-10T01:00:00.000Z",
  end: "2026-06-10T02:00:00.000Z",
  colorId: "9",
  accessToken: "ya29.access-token",
}

describe("createCalendarEvent", () => {
  beforeEach(() => {
    mocks.insert.mockReset()
    mocks.get.mockReset()
    mocks.list.mockReset()
    mocks.patch.mockReset()
    mocks.setCredentials.mockReset()
    process.env.GOOGLE_CALENDAR_OAUTH_CLIENT_ID = "client-id"
    process.env.GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET = "client-secret"
    process.env.GOOGLE_CALENDAR_REDIRECT_URI = "http://localhost/callback"
  })

  it("stamps extendedProperties.private with source only (no customer PII)", async () => {
    mocks.insert.mockResolvedValue({ data: { id: "evt-1" } })

    await createCalendarEvent(baseInput)

    expect(mocks.insert).toHaveBeenCalledTimes(1)
    const args = mocks.insert.mock.calls[0][0]
    expect(args.requestBody.extendedProperties.private.source).toBe("hp-booking")
    expect(args.requestBody.extendedProperties.private.customer_name).toBeUndefined()
    expect(args.requestBody.extendedProperties.private.customer_company).toBeUndefined()
  })

  it("passes an explicit Notion task type marker without adding customer PII", async () => {
    mocks.insert.mockResolvedValue({ data: { id: "evt-1" } })

    await createCalendarEvent({ ...baseInput, notionTaskType: "仮押さえ" })

    const args = mocks.insert.mock.calls[0][0]
    expect(args.requestBody.extendedProperties.private).toEqual({
      source: "hp-booking",
      notion_task_type: "仮押さえ",
    })
  })

  it("stamps the non-PII booking group identity used for full-group reconciliation", async () => {
    mocks.insert.mockResolvedValue({ data: { id: "evt-1" } })

    await createCalendarEvent({ ...baseInput, bookingGroupId: "booking_group_1" })

    const args = mocks.insert.mock.calls[0][0]
    expect(args.requestBody.extendedProperties.private).toEqual({
      source: "hp-booking",
      booking_group_id: "booking_group_1",
    })
  })

  it.each([
    ["仮押さえ", "（候補 1/2）"], ["本予約", "（候補 1/2）"],
    ["仮押さえ", "(候補 1/2)"], ["本予約", "(候補 1/2)"],
  ] as const)("writes trusted customer identity for %s with %s and preserves stage labels", async (notionTaskType, candidate) => {
    mocks.insert.mockResolvedValue({ data: { id: "evt-identity" } })
    const summary = `【仮キープ】案件 / Client${candidate}（仕込み）`
    await createCalendarEvent({
      ...baseInput, summary, bookingGroupId: "group_1", notionTaskType,
      customerName: "Client", customerCompany: "Studio",
    })
    expect(mocks.insert.mock.calls[0][0].requestBody).toMatchObject({
      summary: notionTaskType === "本予約" ? "案件 / Client（仕込み）" : summary,
      extendedProperties: { private: {
        source: "hp-booking", booking_group_id: "group_1", notion_task_type: notionTaskType,
        customer_name: "Client", customer_company: "Studio",
      } },
    })
  })

  it("updates customer identity and confirmed title on the existing event", async () => {
    await updateCalendarEvent({
      ...baseInput, eventId: "existing", bookingGroupId: "group_1", notionTaskType: "本予約",
      summary: "【仮キープ】案件 / Client（候補 2/2）（QC）",
      customerName: "Client", customerCompany: "",
    })
    expect(mocks.patch.mock.calls[0][0]).toMatchObject({
      eventId: "existing", requestBody: {
        summary: "案件 / Client（QC）",
        extendedProperties: { private: { customer_name: "Client", customer_company: "" } },
      },
    })
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it.each([
    { canonical: "本予約", legacy: "仮押さえ", expected: "本予約" },
    { canonical: "仮押さえ", legacy: "本予約", expected: "仮押さえ" },
    { canonical: undefined, legacy: "本予約", expected: "本予約" },
  ])("reads canonical task type $canonical before legacy $legacy", async ({ canonical, legacy, expected }) => {
    const event = {
      id: "existing", start: { date: "2026-06-10" }, end: { date: "2026-06-11" },
      extendedProperties: { private: {
        source: "hp-booking", notionTaskType: legacy,
        ...(canonical !== undefined ? { notion_task_type: canonical } : {}),
      } },
    }
    mocks.get.mockResolvedValue({ data: event })
    mocks.list.mockResolvedValue({ data: { items: [event] } })

    await expect(getCalendarEvent({ calendarId: "primary", eventId: "existing", accessToken: "token" }))
      .resolves.toMatchObject({ notionTaskType: expected })
    await expect(listManagedCalendarEvents({ calendarId: "primary", accessToken: "token" }))
      .resolves.toMatchObject([{ notionTaskType: expected }])
  })

  it("preserves summary, description, colorId, start, end (regression)", async () => {
    mocks.insert.mockResolvedValue({ data: { id: "evt-2" } })

    await createCalendarEvent(baseInput)

    const args = mocks.insert.mock.calls[0][0]
    expect(args.calendarId).toBe(baseInput.calendarId)
    expect(args.requestBody.summary).toBe(baseInput.summary)
    expect(args.requestBody.description).toBe(baseInput.description)
    expect(args.requestBody.colorId).toBe(baseInput.colorId)
    expect(args.requestBody.start).toEqual({ dateTime: baseInput.start })
    expect(args.requestBody.end).toEqual({ dateTime: baseInput.end })
  })

  it("writes date-only transparent all-day events for calendar-neutral tentative holds", async () => {
    mocks.insert.mockResolvedValue({ data: { id: "evt-date-hold" } })

    await createCalendarEvent({
      ...baseInput,
      start: "2026-07-10",
      end: "2026-07-11",
      colorId: "4",
      dateOnly: true,
      transparency: "transparent",
      notionTaskType: "仮押さえ",
    })

    const args = mocks.insert.mock.calls[0][0]
    expect(args.requestBody.start).toEqual({ date: "2026-07-10" })
    expect(args.requestBody.end).toEqual({ date: "2026-07-11" })
    expect(args.requestBody.colorId).toBe("4")
    expect(args.requestBody.transparency).toBe("transparent")
    expect(args.requestBody.extendedProperties.private).toMatchObject({
      source: "hp-booking",
      notion_task_type: "仮押さえ",
    })
  })

  it("returns the inserted event id", async () => {
    mocks.insert.mockResolvedValue({ data: { id: "evt-3" } })

    await expect(createCalendarEvent(baseInput)).resolves.toEqual({ id: "evt-3" })
  })

  it("passes optional eventId through to requestBody.id", async () => {
    mocks.insert.mockResolvedValue({ data: { id: "eventid1" } })

    await createCalendarEvent({ ...baseInput, eventId: "eventid1" })

    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: expect.objectContaining({ id: "eventid1" }),
      }),
    )
  })

  it("treats an existing eventId 409 as idempotent success", async () => {
    mocks.insert.mockRejectedValue({ response: { status: 409 } })
    mocks.get.mockResolvedValue({ data: { id: "eventid1" } })

    await expect(createCalendarEvent({ ...baseInput, eventId: "eventid1" })).resolves.toEqual({ id: "eventid1" })
    expect(mocks.get).toHaveBeenCalledWith({ calendarId: "primary", eventId: "eventid1" })
  })

  it("rejects a 409 event id collision owned by another booking group", async () => {
    mocks.insert.mockRejectedValue({ response: { status: 409 } })
    mocks.get.mockResolvedValue({
      data: {
        id: "eventid1",
        extendedProperties: { private: { booking_group_id: "another_group" } },
      },
    })

    await expect(createCalendarEvent({
      ...baseInput,
      eventId: "eventid1",
      bookingGroupId: "booking_group_1",
    })).rejects.toMatchObject({ code: "calendar_event_ownership_mismatch" })
  })

  it("throws when the API does not return an id", async () => {
    mocks.insert.mockResolvedValue({ data: {} })

    await expect(createCalendarEvent(baseInput)).rejects.toThrow(/did not return event id/)
  })

  it("patches date-only ranges as all-day events instead of invalid dateTime values", async () => {
    mocks.patch.mockResolvedValue({ data: { id: "evt-date-hold" } })

    await updateCalendarEvent({
      calendarId: "primary",
      eventId: "evt-date-hold",
      accessToken: "ya29.access-token",
      start: "2026-07-12",
      end: "2026-07-14",
      dateOnly: true,
    })

    expect(mocks.patch).toHaveBeenCalledWith({
      calendarId: "primary",
      eventId: "evt-date-hold",
      requestBody: {
        start: { date: "2026-07-12" },
        end: { date: "2026-07-14" },
      },
    })
  })

  it("makes a cancellation non-blocking and requests the Notion archive handshake", async () => {
    mocks.patch.mockResolvedValue({ data: { id: "evt-date-hold" } })

    await requestCalendarEventCancellation({
      calendarId: "primary",
      eventId: "evt-date-hold",
      bookingGroupId: "booking_group_1",
      accessToken: "ya29.access-token",
    })

    expect(mocks.patch).toHaveBeenCalledWith({
      calendarId: "primary",
      eventId: "evt-date-hold",
      requestBody: {
        transparency: "transparent",
        extendedProperties: {
          private: {
            source: "hp-booking",
            booking_group_id: "booking_group_1",
            hp_booking_cancel_requested: "1",
          },
        },
      },
    })
  })
})
