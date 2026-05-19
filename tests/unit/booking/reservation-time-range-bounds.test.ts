import { describe, expect, it } from "vitest"

import { recomputeTimeRangeBounds } from "@/components/booking/booking-calendar"

describe("recomputeTimeRangeBounds", () => {
  it("keeps the base reservation time range when there are no slots", () => {
    expect(recomputeTimeRangeBounds([])).toEqual({
      slotMinTime: "10:00:00",
      slotMaxTime: "19:00:00",
    })
  })

  it("expands slotMinTime to include an earlier slot", () => {
    expect(
      recomputeTimeRangeBounds([{ start: "2026-05-19T09:00:00", end: "2026-05-19T10:00:00" }]),
    ).toMatchObject({
      slotMinTime: "09:00:00",
    })
  })

  it("expands slotMaxTime to include a later slot", () => {
    expect(
      recomputeTimeRangeBounds([{ start: "2026-05-19T19:00:00", end: "2026-05-19T20:00:00" }]),
    ).toMatchObject({
      slotMaxTime: "20:00:00",
    })
  })

  it("keeps the base reservation time range when slots are inside the base range", () => {
    expect(recomputeTimeRangeBounds([{ start: "2026-05-19T11:00:00", end: "2026-05-19T12:00:00" }])).toEqual({
      slotMinTime: "10:00:00",
      slotMaxTime: "19:00:00",
    })
  })

  it("expands slotMaxTime to 24:00 when a buffered slot ends at the next midnight", () => {
    expect(
      recomputeTimeRangeBounds([{ start: "2026-05-19T22:00:00", end: "2026-05-20T00:00:00" }]),
    ).toMatchObject({
      slotMaxTime: "24:00:00",
    })
  })

  it("keeps a late slot visible when it ends at the next midnight", () => {
    expect(
      recomputeTimeRangeBounds([{ start: "2026-05-19T23:30:00", end: "2026-05-20T00:00:00" }]),
    ).toMatchObject({
      slotMaxTime: "24:00:00",
    })
  })

  it("keeps non-day-crossing late slots bounded by their end time", () => {
    expect(
      recomputeTimeRangeBounds([{ start: "2026-05-19T21:00:00", end: "2026-05-19T22:00:00" }]),
    ).toMatchObject({
      slotMaxTime: "22:00:00",
    })
  })
})
