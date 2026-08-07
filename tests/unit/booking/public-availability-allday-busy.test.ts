import { describe, expect, it } from "vitest"

import { buildPublicAvailabilityMonth } from "@/lib/booking/domain/public-availability"

const NOW = new Date("2026-11-25T00:00:00+09:00")

function statusOf(month: ReturnType<typeof buildPublicAvailabilityMonth>, dateKey: string) {
  return month.days.find((day) => day.dateKey === dateKey)?.status
}

describe("buildPublicAvailabilityMonth full-day busy", () => {
  it("marks every day of a full-day busy slot as busy", () => {
    // 実施時間を持たない本予約（例: 12月全日の押さえ）は月まるごと NG。
    const month = buildPublicAvailabilityMonth({
      month: "2026-12",
      now: NOW,
      busy: [{
        start: new Date("2026-12-01T00:00:00+09:00").toISOString(),
        end: new Date("2027-01-01T00:00:00+09:00").toISOString(),
      }],
    })

    expect(statusOf(month, "2026-12-01")).toBe("busy")
    expect(statusOf(month, "2026-12-15")).toBe("busy")
    expect(statusOf(month, "2026-12-31")).toBe("busy")
    expect(month.busyDateKeys).toHaveLength(31)
  })

  it("does not spill a full-day busy slot past its exclusive end", () => {
    const month = buildPublicAvailabilityMonth({
      month: "2026-12",
      now: NOW,
      busy: [{
        start: new Date("2026-12-01T00:00:00+09:00").toISOString(),
        end: new Date("2026-12-03T00:00:00+09:00").toISOString(),
      }],
    })

    expect(month.busyDateKeys).toEqual(["2026-12-01", "2026-12-02"])
  })

  it("keeps timed busy slots working", () => {
    const month = buildPublicAvailabilityMonth({
      month: "2026-12",
      now: NOW,
      busy: [{
        start: new Date("2026-12-03T10:00:00+09:00").toISOString(),
        end: new Date("2026-12-03T19:00:00+09:00").toISOString(),
      }],
    })

    expect(month.busyDateKeys).toEqual(["2026-12-03"])
  })

  it("lets busy win over tentative on the same day", () => {
    const month = buildPublicAvailabilityMonth({
      month: "2026-12",
      now: NOW,
      busy: [{
        start: new Date("2026-12-01T00:00:00+09:00").toISOString(),
        end: new Date("2026-12-02T00:00:00+09:00").toISOString(),
      }],
      tentativeDateKeys: ["2026-12-01", "2026-12-02"],
    })

    expect(statusOf(month, "2026-12-01")).toBe("busy")
    expect(statusOf(month, "2026-12-02")).toBe("tentative")
  })
})
