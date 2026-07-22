import { describe, expect, it } from "vitest"

import {
  bookingDateRangeToSelection,
  bookingFormSchema,
  formatBookingDateRange,
  formatBookingDateSelection,
  getBookingDateRangeDayCount,
  getBookingDateSelectionDayCount,
  getSlotDurationMinutes,
  isValidBookingDateRange,
  isValidBookingDateSelection,
  mergeBookingFormData,
  normalizeBookingDateKeys,
  type BookingFormData,
} from "@/lib/booking/domain/form-schema"

function validForm(overrides: Record<string, unknown> = {}) {
  return {
    projectTitle: "Project",
    dueDate: "2026-06-30",
    companyName: "",
    contactName: "Satoshi",
    sessionEmail: "satoshi@example.com",
    phone: "",
    memo: "",
    agreed: true,
    ...overrides,
  }
}

describe("bookingFormSchema input limits", () => {
  it("rejects projectTitle over 200 characters", () => {
    expect(bookingFormSchema.safeParse(validForm({ projectTitle: "a".repeat(201) })).success).toBe(false)
  })

  it("rejects memo over 2000 characters", () => {
    expect(bookingFormSchema.safeParse(validForm({ memo: "a".repeat(2001) })).success).toBe(false)
  })

  it("rejects phone over 32 characters", () => {
    expect(bookingFormSchema.safeParse(validForm({ phone: "1".repeat(33) })).success).toBe(false)
  })

  it("rejects contactName over 80 characters", () => {
    expect(bookingFormSchema.safeParse(validForm({ contactName: "a".repeat(81) })).success).toBe(false)
  })

  it("validates email and consent while allowing an empty authenticated email", () => {
    expect(bookingFormSchema.safeParse(validForm({ sessionEmail: "" })).success).toBe(true)
    expect(bookingFormSchema.safeParse(validForm({ sessionEmail: "not-an-email" })).success).toBe(false)
    expect(bookingFormSchema.safeParse(validForm({ agreed: false })).success).toBe(false)
    expect(bookingFormSchema.safeParse(validForm({ companyName: "a".repeat(121) })).success).toBe(false)
  })
})

describe("booking date helpers", () => {
  it("validates and expands an inclusive date range", () => {
    const range = { startDate: "2026-07-10", endDate: "2026-07-12" }

    expect(isValidBookingDateRange(range)).toBe(true)
    expect(getBookingDateRangeDayCount(range)).toBe(3)
    expect(bookingDateRangeToSelection(range)).toEqual({
      dates: ["2026-07-10", "2026-07-11", "2026-07-12"],
    })
    expect(formatBookingDateRange(range)).toContain("3日間")
    expect(formatBookingDateRange({ startDate: "2026-07-10", endDate: "2026-07-10" })).toContain("1日間")
  })

  it("rejects malformed, impossible, and reversed date ranges", () => {
    const malformed = { startDate: "2026-7-10", endDate: "2026-07-12" }
    const impossible = { startDate: "2026-02-30", endDate: "2026-03-01" }
    const reversed = { startDate: "2026-07-12", endDate: "2026-07-10" }

    expect(isValidBookingDateRange(malformed)).toBe(false)
    expect(isValidBookingDateRange(impossible)).toBe(false)
    expect(isValidBookingDateRange(reversed)).toBe(false)
    expect(getBookingDateRangeDayCount(reversed)).toBe(0)
    expect(bookingDateRangeToSelection(reversed)).toEqual({ dates: [] })
    expect(formatBookingDateRange(reversed)).toBe("7/12(日)〜7/10(金)")
  })

  it("normalizes and formats non-contiguous date selections", () => {
    const selection = {
      dates: ["2026-07-12", "bad-date", "2026-07-10", "2026-07-12"],
    }

    expect(normalizeBookingDateKeys(selection.dates)).toEqual(["2026-07-10", "2026-07-12"])
    expect(isValidBookingDateSelection(selection)).toBe(true)
    expect(getBookingDateSelectionDayCount(selection)).toBe(2)
    expect(formatBookingDateSelection(selection)).toContain("2日間")
    expect(isValidBookingDateSelection({ dates: [] })).toBe(false)
    expect(formatBookingDateSelection({ dates: [] })).toBe("未選択")
  })

  it("merges editable fields without replacing the authenticated email", () => {
    const current = validForm() as BookingFormData

    expect(mergeBookingFormData(current, {
      projectTitle: "Updated",
      sessionEmail: "ignored@example.com",
    }, "session@example.com")).toMatchObject({
      projectTitle: "Updated",
      sessionEmail: "session@example.com",
    })
    expect(getSlotDurationMinutes({
      start: "2026-07-10T02:00:00.000Z",
      end: "2026-07-10T01:00:00.000Z",
    })).toBe(0)
  })
})
