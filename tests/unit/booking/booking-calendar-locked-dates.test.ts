import { describe, expect, it } from "vitest"

import { getLockedDateKeys } from "@/components/booking/booking-calendar"

function busy(start: string, end: string) {
  return {
    start,
    end,
    source: "notion_work" as const,
    bufferHours: null,
    bufferBeforeHours: null,
    bufferAfterHours: null,
    summary: null,
  }
}

describe("getLockedDateKeys", () => {
  it("locks every JST day covered by a full-day 本予約, exclusive of the end boundary", () => {
    // 12/1 0:00 〜 翌 1/1 0:00（JST）= 12月全日の押さえ。1/1 は塞がない。
    const keys = getLockedDateKeys({
      busy: [busy(
        new Date("2026-12-01T00:00:00+09:00").toISOString(),
        new Date("2027-01-01T00:00:00+09:00").toISOString(),
      )],
      bookings: [],
    })

    expect(keys).toHaveLength(31)
    expect(keys[0]).toBe("2026-12-01")
    expect(keys.at(-1)).toBe("2026-12-31")
    expect(keys).not.toContain("2027-01-01")
  })

  it("locks the whole JST day for a timed 本予約", () => {
    const keys = getLockedDateKeys({
      busy: [busy("2026-08-13T01:00:00.000Z", "2026-08-13T10:00:00.000Z")],
      bookings: [],
    })

    expect(keys).toEqual(["2026-08-13"])
  })

  it("does not lock a 仮押さえ, which arrives as a tentative date key rather than busy", () => {
    const keys = getLockedDateKeys({
      busy: [],
      bookings: [],
      tentativeDateKeys: ["2026-11-23", "2026-11-24"],
    })

    expect(keys).toEqual([])
  })

  it("deduplicates overlapping busy slots", () => {
    const keys = getLockedDateKeys({
      busy: [
        busy("2026-08-13T01:00:00.000Z", "2026-08-13T10:00:00.000Z"),
        busy(
          new Date("2026-08-13T00:00:00+09:00").toISOString(),
          new Date("2026-08-15T00:00:00+09:00").toISOString(),
        ),
      ],
      bookings: [],
    })

    expect(keys).toEqual(["2026-08-13", "2026-08-14"])
  })
})
