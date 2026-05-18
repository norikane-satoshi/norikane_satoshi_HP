import { describe, expect, it } from "vitest"

import { createDefaultBookingFormData, mergeBookingFormData } from "@/lib/booking/domain/form-schema"

describe("BookingSection form data merge", () => {
  it("preserves an entered contact email when a partial form watch update omits it", () => {
    const current = {
      ...createDefaultBookingFormData("customer@example.com"),
      contactEmail: "customer-contact@example.com",
      projectTitle: "Project",
    }

    const next = mergeBookingFormData(current, { contactName: "Customer" }, "customer@example.com")

    expect(next.contactEmail).toBe("customer-contact@example.com")
    expect(next.contactName).toBe("Customer")
    expect(next.sessionEmail).toBe("customer@example.com")
  })

  it("keeps an explicit empty contact email when the customer clears the field", () => {
    const current = {
      ...createDefaultBookingFormData("customer@example.com"),
      contactEmail: "customer-contact@example.com",
    }

    const next = mergeBookingFormData(current, { contactEmail: "" }, "customer@example.com")

    expect(next.contactEmail).toBe("")
  })
})
