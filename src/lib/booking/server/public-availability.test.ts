import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getCalendarFreeBusyForUser: vi.fn(),
  getCachedCalendarAccessToken: vi.fn(),
  getNotionWorkTentativeDateKeys: vi.fn(),
  listTentativeHoldEvents: vi.fn(),
}))

vi.mock("@/lib/booking/server/calendar-free-busy/free-busy", () => ({
  getCalendarFreeBusyForUser: mocks.getCalendarFreeBusyForUser,
}))

vi.mock("@/lib/booking/server/calendar-free-busy/google-token-cache", () => ({
  getCachedCalendarAccessToken: mocks.getCachedCalendarAccessToken,
}))

vi.mock("@/lib/chatbot/server/notion-work-schedule-busy", () => ({
  getNotionWorkTentativeDateKeys: mocks.getNotionWorkTentativeDateKeys,
}))

vi.mock("@/lib/google-calendar/server", () => ({
  CALENDAR_TOKEN_USER_ID: "satoshi-calendar-owner",
  listTentativeHoldEvents: mocks.listTentativeHoldEvents,
}))

describe("loadPublicAvailabilityMonth", () => {
  beforeEach(() => {
    mocks.getCalendarFreeBusyForUser.mockReset()
    mocks.getCachedCalendarAccessToken.mockReset()
    mocks.getNotionWorkTentativeDateKeys.mockReset()
    mocks.listTentativeHoldEvents.mockReset()
    mocks.getCalendarFreeBusyForUser.mockResolvedValue({
      busy: [
        {
          start: "2026-07-15T10:00:00+09:00",
          end: "2026-07-15T11:00:00+09:00",
          summary: null,
        },
      ],
      bookings: [
        {
          id: "booking_1",
          bookingGroupId: "group_1",
          customerUserId: "customer_1",
          start: "2026-07-20T01:00:00.000Z",
          end: "2026-07-20T02:00:00.000Z",
          title: "Hidden customer project",
          status: "CONFIRMED",
          bufferBeforeHours: 0,
          bufferAfterHours: 0,
        },
      ],
      status: 200,
      timings: { db: 0, oauthRefresh: 0, gcal: 0 },
      cache: "miss",
    })
    mocks.getCachedCalendarAccessToken.mockResolvedValue({ token: "access_token", refreshMs: 0 })
    mocks.getNotionWorkTentativeDateKeys.mockResolvedValue(["2026-07-22"])
    mocks.listTentativeHoldEvents.mockResolvedValue([
      { start: "2026-07-16", end: "2026-07-17", summary: "Hidden tentative project" },
      { start: "2026-07-24T10:00:00+09:00", end: "2026-07-24T11:00:00+09:00" },
    ])
  })

  it("loads public availability through the existing owner free-busy path", async () => {
    process.env.GOOGLE_CALENDAR_BUSY_SOURCE_ID = "calendar_1"
    const { loadPublicAvailabilityMonth } = await import("./public-availability")

    const result = await loadPublicAvailabilityMonth({
      month: "2026-07",
      now: new Date("2026-07-10T00:00:00+09:00"),
    })

    expect(mocks.getCalendarFreeBusyForUser).toHaveBeenCalledWith({
      userId: "satoshi-calendar-owner",
      teamId: null,
      timeMin: "2026-06-28T00:00:00.000+09:00",
      timeMax: "2026-08-02T00:00:00.000+09:00",
      calendarId: "calendar_1",
      isCalendarAdmin: false,
    })
    expect(mocks.listTentativeHoldEvents).toHaveBeenCalledWith(
      "calendar_1",
      "2026-06-28T00:00:00.000+09:00",
      "2026-08-02T00:00:00.000+09:00",
      "access_token",
    )
    expect(mocks.getNotionWorkTentativeDateKeys).toHaveBeenCalledWith({
      from: "2026-06-28T00:00:00.000+09:00",
      to: "2026-08-02T00:00:00.000+09:00",
    })
    expect(result.busyDateKeys).toEqual(["2026-07-15", "2026-07-20"])
    expect(result.tentativeDateKeys).toEqual(["2026-07-16", "2026-07-22", "2026-07-24"])
    expect(result.days.find((day) => day.dateKey === "2026-07-16")).toMatchObject({
      isBusy: false,
      isTentative: true,
      status: "tentative",
    })
    expect(JSON.stringify(result)).not.toContain("Hidden customer project")
    expect(JSON.stringify(result)).not.toContain("Hidden tentative project")
  })

  it("returns a non-throwing empty month when free-busy loading fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    mocks.getCalendarFreeBusyForUser.mockRejectedValue(new Error("db unavailable"))
    const { loadPublicAvailabilityMonth } = await import("./public-availability")

    const result = await loadPublicAvailabilityMonth({
      month: "2026-07",
      now: new Date("2026-07-10T00:00:00+09:00"),
    })

    expect(result).toMatchObject({
      month: "2026-07",
      code: "public_availability_load_failed",
      status: 503,
      busyDateKeys: [],
    })
    warn.mockRestore()
  })
})
