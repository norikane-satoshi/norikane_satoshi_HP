import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { BookingEditForm } from "@/components/booking/booking-edit-form"
import type {
  BookingAccessScope,
  EditableBookingDetails,
  EditableBookingTimeSlot,
} from "@/lib/booking/server/edit-access"

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}))

const baseDetails: EditableBookingDetails = {
  projectTitle: "Project",
  contactName: "Customer",
  customerEmail: null,
  phone: null,
  companyName: null,
  memo: null,
  dueDate: null,
  teamId: null,
  customerUserId: "customer_user",
  status: "CONFIRMED",
}

const baseSlots: EditableBookingTimeSlot[] = [{
  id: "slot_1",
  startTime: "2099-05-18T01:00:00.000Z",
  endTime: "2099-05-18T02:00:00.000Z",
  status: "CONFIRMED",
}]

function renderForm(customerEmail: string | null, scope: BookingAccessScope = "admin") {
  return renderToStaticMarkup(
    React.createElement(BookingEditForm, {
      bookingId: "slot_1",
      bookingGroupId: "group_1",
      initialDetails: { ...baseDetails, customerEmail },
      initialTimeSlots: baseSlots,
      scope,
      isCalendarAdmin: scope === "admin",
      isPast: false,
    }),
  )
}

describe("BookingEditForm customer email display", () => {
  it("renders the customer email field as read-only and disabled", () => {
    const markup = renderForm("customer@example.com")

    expect(markup).toContain(">メール<")
    expect(markup).toContain('type="email"')
    expect(markup).toContain('value="customer@example.com"')
    expect(markup).toContain("readOnly")
    expect(markup).toContain("disabled")
  })

  it("keeps customer email empty when initialDetails.customerEmail is null", () => {
    expect(renderForm(null)).toContain('type="email" readOnly="" disabled="" value=""')
  })
})
