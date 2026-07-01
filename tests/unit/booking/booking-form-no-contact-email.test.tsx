import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { BookingForm } from "@/components/booking/booking-form"
import { createDefaultBookingFormData } from "@/lib/booking/domain/form-schema"

describe("BookingForm email fields", () => {
  it("does not render the removed contact email field", () => {
    const markup = renderToStaticMarkup(
      React.createElement(BookingForm, {
        formData: createDefaultBookingFormData("customer@example.com"),
        selectedSlots: [],
        onChange: vi.fn(),
        onValidityChange: vi.fn(),
        onReselectDate: vi.fn(),
      }),
    )

    expect(markup).not.toContain("連絡用メール")
    expect(markup).toContain("メールアドレス")
    expect(markup).toContain('readOnly=""')
    expect(markup).toContain('name="sessionEmail"')
  })

  it("allows the LINE LIFF entry to edit the contact email when the provider has no email", () => {
    const markup = renderToStaticMarkup(
      React.createElement(BookingForm, {
        formData: createDefaultBookingFormData(""),
        selectedSlots: [],
        onChange: vi.fn(),
        onValidityChange: vi.fn(),
        onReselectDate: vi.fn(),
        sessionEmailReadOnly: false,
      }),
    )

    expect(markup).toContain('name="sessionEmail"')
    expect(markup).not.toContain('readOnly=""')
  })
})
