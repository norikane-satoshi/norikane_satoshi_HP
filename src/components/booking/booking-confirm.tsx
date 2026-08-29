"use client"

import {useLocale} from "next-intl"
import {getLocalizedCopy} from "@/i18n/copy"
import {
  formatBookingDateSelection,
  formatDurationMinutes,
  getTotalDurationMinutes,
  type BookingDateSelection,
  type BookingFormData,
  type BookingSlot,
} from "@/lib/booking/domain/form-schema"

type BookingConfirmProps = {
  formData: BookingFormData
  selectedSlots: BookingSlot[]
  requestedDateSelection?: BookingDateSelection | null
  submitError?: string | null
  onDismissSubmitError?: () => void
  onReselectDate?: (slot?: BookingSlot) => void
  sessionEmailOptional?: boolean
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

function valueOrDash(value: string | string[]): string {
  if (Array.isArray(value)) return value.length > 0 ? value.join(" / ") : "-"
  return value.trim() || "-"
}

function formatSlots(slots: BookingSlot[], requestedDateSelection: BookingDateSelection | null | undefined, noDates: string, locale: "ja" | "en"): string {
  if (requestedDateSelection) return formatBookingDateSelection(requestedDateSelection, locale)
  if (slots.length === 0) return noDates
  return slots.map((slot) => formatSlot(slot, locale)).join(" / ")
}

export function BookingConfirm({
  formData,
  selectedSlots,
  requestedDateSelection = null,
  submitError,
  onDismissSubmitError,
  onReselectDate,
  sessionEmailOptional = false,
}: BookingConfirmProps) {
  const locale = useLocale() as "ja" | "en"
  const copy = getLocalizedCopy(locale, "Booking")
  const optional = (label: string) => `${label} (${copy.optional})`
  const rows = [
    [copy.project, formData.projectTitle],
    [copy.requestedDates, formatSlots(selectedSlots, requestedDateSelection, copy.noDates, locale)],
    ...(selectedSlots.length > 0 ? [[copy.estimatedDuration, formatDurationMinutes(getTotalDurationMinutes(selectedSlots), locale)] as const] : []),
    [optional(copy.deadline), formData.dueDate],
    [copy.company, formData.companyName],
    [copy.name, formData.contactName],
    [sessionEmailOptional ? optional(copy.email) : copy.email, formData.sessionEmail],
    ["TEL", formData.phone],
    [optional(copy.notes), formData.memo],
  ] as const

  return (
    <div className="booking-confirm">
      {submitError ? (
        <div className="booking-confirm__submit-error glass-flat" role="alert">
          <span aria-hidden="true">⚠</span>
          <div>
            <p>{submitError}</p>
            <div className="booking-confirm__submit-actions">
              {onReselectDate ? (
                <button className="booking-section__text-button" type="button" onClick={() => onReselectDate()}>
                  {copy.chooseDatesAgain}
                </button>
              ) : null}
              {onDismissSubmitError ? (
                <button className="booking-section__text-button" type="button" onClick={onDismissSubmitError}>
                  {copy.close}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
      <div>
        <span className="glass-badge booking-confirm__slot-pill">{formatSlots(selectedSlots, requestedDateSelection, copy.noDates, locale)}</span>
        <h2 className="booking-confirm__title">{copy.reviewTitle}</h2>
      </div>
      <dl className="booking-confirm__list glass-inset">
        {rows.map(([label, value]) => (
          <div className="booking-confirm__row" key={label}>
            <dt className="text-hp-muted">{label}</dt>
            <dd className="text-hp">{valueOrDash(value)}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
