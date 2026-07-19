import { describe, expect, it } from "vitest"

import {
  buildPublicAvailabilityBlockMarkers,
  buildPublicAvailabilityMonth,
  buildTentativeAvailabilityDateKeys,
} from "./public-availability"

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
    expect(month.tentativeDateKeys).toEqual([])
    expect(month.days.find((day) => day.dateKey === "2026-07-15")?.isBusy).toBe(true)
    expect(month.days.find((day) => day.dateKey === "2026-07-16")?.isBusy).toBe(false)
    expect(month.days.find((day) => day.dateKey === "2026-07-17")?.isBusy).toBe(false)
    expect(month.days.find((day) => day.dateKey === "2026-07-20")?.isBusy).toBe(true)
  })

  it("marks date-only tentative holds without turning them into confirmed busy days", () => {
    const month = buildPublicAvailabilityMonth({
      month: "2026-07",
      now: new Date("2026-07-10T00:00:00.000+09:00"),
      busy: [
        { start: "2026-07-15T10:00:00+09:00", end: "2026-07-15T11:00:00+09:00" },
      ],
      tentative: [
        { start: "2026-07-16", end: "2026-07-18" },
        { start: "2026-07-20T10:00:00+09:00", end: "2026-07-20T11:00:00+09:00" },
      ],
      tentativeDateKeys: ["2026-07-22"],
    })

    expect(month.busyDateKeys).toEqual(["2026-07-15"])
    expect(month.tentativeDateKeys).toEqual(["2026-07-16", "2026-07-17", "2026-07-20", "2026-07-22"])
    expect(month.days.find((day) => day.dateKey === "2026-07-15")).toMatchObject({
      isBusy: true,
      isTentative: false,
      status: "busy",
    })
    expect(month.days.find((day) => day.dateKey === "2026-07-16")).toMatchObject({
      isBusy: false,
      isTentative: true,
      status: "tentative",
    })
    expect(month.days.find((day) => day.dateKey === "2026-07-18")).toMatchObject({
      isBusy: false,
      isTentative: false,
      status: "available",
    })
  })

  it("normalizes calendar and Notion tentative dates into one scrubbed set", () => {
    expect(buildTentativeAvailabilityDateKeys({
      tentative: [
        { start: "2026-07-16", end: "2026-07-18" },
        { start: "2026-07-20T10:00:00+09:00", end: "2026-07-20T11:00:00+09:00" },
      ],
      tentativeDateKeys: ["2026-07-17", "invalid", "2026-07-22"],
    })).toEqual(["2026-07-16", "2026-07-17", "2026-07-20", "2026-07-22"])
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

  it("marks only same-status days in a week as one visual block without changing availability", () => {
    const month = buildPublicAvailabilityMonth({
      month: "2026-07",
      now: new Date("2026-07-10T00:00:00.000+09:00"),
      busy: [
        { start: "2026-07-14T10:00:00+09:00", end: "2026-07-16T11:00:00+09:00" },
      ],
      tentative: [
        { start: "2026-07-17", end: "2026-07-19" },
      ],
      tentativeDateKeys: ["2026-07-20"],
    })
    const markers = buildPublicAvailabilityBlockMarkers(month.days)

    expect(month.busyDateKeys).toEqual(["2026-07-14", "2026-07-15", "2026-07-16"])
    expect(month.tentativeDateKeys).toEqual(["2026-07-17", "2026-07-18", "2026-07-20"])
    expect(markers.get("2026-07-14")).toEqual({ isStart: true, isEnd: false, isMiddle: false })
    expect(markers.get("2026-07-15")).toEqual({ isStart: false, isEnd: false, isMiddle: true })
    expect(markers.get("2026-07-16")).toEqual({ isStart: false, isEnd: true, isMiddle: false })
    expect(markers.get("2026-07-17")).toEqual({ isStart: true, isEnd: false, isMiddle: false })
    expect(markers.get("2026-07-18")).toEqual({ isStart: false, isEnd: true, isMiddle: false })
    expect(markers.get("2026-07-20")).toEqual({ isStart: true, isEnd: true, isMiddle: false })
  })
})
