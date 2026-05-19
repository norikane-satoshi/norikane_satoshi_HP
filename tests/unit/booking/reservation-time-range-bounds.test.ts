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

  it("ignores slots outside the visible range and keeps the base reservation time range", () => {
    expect(
      recomputeTimeRangeBounds(
        [{ start: "2026-05-20T22:00:00", end: "2026-05-21T00:00:00" }],
        { start: new Date(2026, 4, 19, 0, 0, 0), end: new Date(2026, 4, 20, 0, 0, 0) },
      ),
    ).toEqual({
      slotMinTime: "10:00:00",
      slotMaxTime: "19:00:00",
    })
  })

  it("keeps a visible day-crossing slot expanded through 24:00", () => {
    expect(
      recomputeTimeRangeBounds(
        [{ start: "2026-05-19T22:00:00", end: "2026-05-20T00:00:00" }],
        { start: new Date(2026, 4, 19, 0, 0, 0), end: new Date(2026, 4, 20, 0, 0, 0) },
      ),
    ).toMatchObject({
      slotMaxTime: "24:00:00",
    })
  })

  it("keeps all slots in scope when no visible range is provided", () => {
    expect(
      recomputeTimeRangeBounds([{ start: "2026-05-20T22:00:00", end: "2026-05-21T00:00:00" }]),
    ).toMatchObject({
      slotMaxTime: "24:00:00",
    })
  })

  it("keeps the base range when a midnight-starting slot is outside the previous visible day", () => {
    expect(
      recomputeTimeRangeBounds(
        [{ start: "2026-05-20T00:00:00", end: "2026-05-20T01:00:00" }],
        { start: new Date(2026, 4, 19, 0, 0, 0), end: new Date(2026, 4, 20, 0, 0, 0) },
      ),
    ).toEqual({
      slotMinTime: "10:00:00",
      slotMaxTime: "19:00:00",
    })
  })

  it("expands slotMinTime to 00:00 for the visible day of a midnight-starting slot", () => {
    expect(
      recomputeTimeRangeBounds(
        [{ start: "2026-05-20T00:00:00", end: "2026-05-20T01:00:00" }],
        { start: new Date(2026, 4, 20, 0, 0, 0), end: new Date(2026, 4, 21, 0, 0, 0) },
      ),
    ).toEqual({
      slotMinTime: "00:00:00",
      slotMaxTime: "19:00:00",
    })
  })

  it("keeps the base range when a day-crossing slot ends exactly at the visible day start", () => {
    expect(
      recomputeTimeRangeBounds(
        [{ start: "2026-05-19T22:00:00", end: "2026-05-20T00:00:00" }],
        { start: new Date(2026, 4, 20, 0, 0, 0), end: new Date(2026, 4, 21, 0, 0, 0) },
      ),
    ).toEqual({
      slotMinTime: "10:00:00",
      slotMaxTime: "19:00:00",
    })
  })

  it("expands slotMaxTime to 24:00 for the first visible day of a day-crossing slot", () => {
    expect(
      recomputeTimeRangeBounds(
        [{ start: "2026-05-19T23:00:00", end: "2026-05-20T02:00:00" }],
        { start: new Date(2026, 4, 19, 0, 0, 0), end: new Date(2026, 4, 20, 0, 0, 0) },
      ),
    ).toMatchObject({
      slotMaxTime: "24:00:00",
    })
  })

  it("expands slotMinTime to 00:00 for the second visible day of a day-crossing slot", () => {
    expect(
      recomputeTimeRangeBounds(
        [{ start: "2026-05-19T23:00:00", end: "2026-05-20T02:00:00" }],
        { start: new Date(2026, 4, 20, 0, 0, 0), end: new Date(2026, 4, 21, 0, 0, 0) },
      ),
    ).toEqual({
      slotMinTime: "00:00:00",
      slotMaxTime: "19:00:00",
    })
  })
})
