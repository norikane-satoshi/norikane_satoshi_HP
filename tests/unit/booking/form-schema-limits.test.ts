import { describe, expect, it } from "vitest"

import { bookingFormSchema } from "@/lib/booking/domain/form-schema"

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
})
