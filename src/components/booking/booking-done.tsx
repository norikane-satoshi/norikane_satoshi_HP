"use client"

import {useLocale} from "next-intl"
import {getLocalizedCopy} from "@/i18n/copy"
import { formatBookingDateSelection, type BookingDateSelection, type BookingSlot } from "@/lib/booking/domain/form-schema"

type BookingDoneProps = {
  selectedSlots: BookingSlot[]
  requestedDateSelection?: BookingDateSelection | null
  entryPoint?: "web" | "line_liff"
}

function formatSlot(slot: BookingSlot, locale: "ja" | "en"): string {
  const start = new Date(slot.start)
  const end = new Date(slot.end)
  const intlLocale = locale === "en" ? "en-US" : "ja-JP"
  return `${start.toLocaleString(intlLocale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })} - ${end.toLocaleTimeString(intlLocale, {
    hour: "2-digit",
    minute: "2-digit",
  })}`
}

function formatSlots(slots: BookingSlot[], requestedDateSelection: BookingDateSelection | null | undefined, noDates: string, locale: "ja" | "en"): string {
  if (requestedDateSelection) return formatBookingDateSelection(requestedDateSelection, locale)
  if (slots.length === 0) return noDates
  return slots.map((slot) => formatSlot(slot, locale)).join(" / ")
}

export function BookingDone({ selectedSlots, requestedDateSelection = null, entryPoint = "web" }: BookingDoneProps) {
  const locale = useLocale() as "ja" | "en"
  const copy = getLocalizedCopy(locale, "Booking")
  const receiptText =
    entryPoint === "line_liff"
      ? copy.lineReceipt
      : copy.emailReceipt

  return (
    <div className="booking-done glass-card-sm">
      <h2 className="booking-done__title">{copy.receivedTitle}</h2>
      <p className="text-hp-muted">{receiptText}</p>
      <span className="glass-badge booking-done__slot">{formatSlots(selectedSlots, requestedDateSelection, copy.noDates, locale)}</span>
    </div>
  )
}
