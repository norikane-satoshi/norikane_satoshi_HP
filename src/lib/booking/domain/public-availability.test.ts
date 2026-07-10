import { describe, expect, it } from "vitest"

import { buildPublicAvailabilityMonth } from "./public-availability"

describe("buildPublicAvailabilityMonth", () => {
  it("marks only timed busy slots and timed bookings as busy", () => {
    const month = buildPublicAvailabilityMonth({
      month: "2026-07",
      now: new Date("2026-07-10T00:00:00.000+09:00"),
      busy: [
        { start: "2026-07-15T10:00:00+09:00", end: "2026-07-15T11:00:00+09:00" },
        { start: "2026-07-16", end: "2026-07-17" },
        { start: "2026-07-17T00:00:00+09:00", end: "2026-07-18T00:00:00+09:00" },
      ],
      bookings: [
        { start: "2026-07-20T01:00:00.000Z", end: "2026-07-20T02:00:00.000Z" },
      ],
    })

    expect(month.busyDateKeys).toEqual(["2026-07-15", "2026-07-20"])
    expect(month.days.find((day) => day.dateKey === "2026-07-15")?.isBusy).toBe(true)
    expect(month.days.find((day) => day.dateKey === "2026-07-16")?.isBusy).toBe(false)
    expect(month.days.find((day) => day.dateKey === "2026-07-17")?.isBusy).toBe(false)
    expect(month.days.find((day) => day.dateKey === "2026-07-20")?.isBusy).toBe(true)
  })

  it("uses a stable Sunday-start month grid and JST today/past state", () => {
    const month = buildPublicAvailabilityMonth({
      month: "2026-08",
      now: new Date("2026-08-03T15:00:00.000Z"),
    })

    expect(month.range).toMatchObject({
      start: "2026-07-26",
      end: "2026-09-06",
      timeMin: "2026-07-26T00:00:00.000+09:00",
      timeMax: "2026-09-06T00:00:00.000+09:00",
    })
    expect(month.days).toHaveLength(42)
    expect(month.days[0]).toMatchObject({ dateKey: "2026-07-26", inMonth: false })
    expect(month.days.find((day) => day.dateKey === "2026-08-04")?.isTodayOrPast).toBe(true)
    expect(month.days.find((day) => day.dateKey === "2026-08-05")?.isTodayOrPast).toBe(false)
  })
})
