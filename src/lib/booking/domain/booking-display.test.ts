import { expect, it } from "vitest"
import { bookingDateKeyFromDisplay, formatBookingDate, formatBookingDateTime, formatBookingSlot, formatRequestedBookingDates } from "./booking-display"

it("formats valid dates with weekdays without timezone drift or a day count", () => {
  expect(formatBookingDate("2026-10-25")).toBe("2026/10/25(日)")
  expect(formatBookingDate("2026-10-26")).toBe("2026/10/26(月)")
  expect(formatBookingDate("2026-02-30")).toBe("2026-02-30")
  expect(formatBookingDate("未確認")).toBe("未確認")
  expect(formatRequestedBookingDates(["2026-10-26", "2026-10-25", "2026-10-25", "invalid"])).toBe("2026/10/25(日)、2026/10/26(月)")
  expect(formatBookingSlot("2026-10-25", "2026-10-26")).toBe("2026/10/25(日)")
})

it("uses Japanese dates for timed slots and accepts only an exact display-date round trip", () => {
  expect(formatBookingDateTime("2026-10-24T15:00:00Z")).toBe("2026/10/25(日) 00:00")
  expect(formatBookingSlot("2026-10-25T01:00:00Z", "2026-10-25T02:00:00Z")).toBe("2026/10/25(日) 10:00 - 2026/10/25(日) 11:00")
  expect(bookingDateKeyFromDisplay("2026/10/25(日)")).toBe("2026-10-25")
  expect(bookingDateKeyFromDisplay("2026/10/25(月)")).toBeUndefined()
  expect(bookingDateKeyFromDisplay("2026/02/30(月)")).toBeUndefined()
})
