// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { BookingForm } from "@/components/booking/booking-form"
import { createDefaultBookingFormData } from "@/lib/booking/domain/form-schema"

describe("BookingForm supplemental textarea", () => {
  afterEach(() => {
    cleanup()
  })

  it("uses a capped auto-resizing memo field so long notes can scroll inside the field", () => {
    render(
      <BookingForm
        formData={createDefaultBookingFormData("customer@example.com")}
        selectedSlots={[]}
        onChange={vi.fn()}
        onReselectDate={vi.fn()}
        onValidityChange={vi.fn()}
      />,
    )

    const memo = screen.getByLabelText(/補足/)
    expect(memo.tagName).toBe("TEXTAREA")
    expect(memo).toHaveAttribute("maxLength", "1000")
    expect(memo).toHaveAttribute("rows", "5")
    expect(memo).toHaveClass("auto-resize-textarea")
    expect(memo).toHaveStyle({ overflowY: "hidden" })
  })
})
