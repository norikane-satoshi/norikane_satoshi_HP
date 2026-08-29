"use client"

import {useLocale} from "next-intl"
import {Link} from "@/i18n/navigation"
import {getLocalizedCopy, type AppMessages} from "@/i18n/copy"

import type { BookingStep } from "@/lib/booking/domain/form-schema"

type BookingFooterProps = {
  step: BookingStep
  canGoNext: boolean
  submitting?: boolean
  onBack: () => void
  onNext: () => void
  onReset: () => void
}

function nextLabel(step: BookingStep, submitting: boolean, copy: AppMessages["Booking"]): string {
  if (submitting) return copy.sending
  if (step === "confirm") return copy.sendRequest
  return copy.reviewRequest
}

export function BookingFooter({ step, canGoNext, submitting = false, onBack, onNext, onReset }: BookingFooterProps) {
  const copy = getLocalizedCopy(useLocale(), "Booking")
  if (step === "done") {
    return (
      <footer className="booking-footer">
        <button className="booking-footer__secondary glass-flat" type="button" onClick={onReset}>
          {copy.backToCalendar}
        </button>
        <Link className="booking-footer__primary glass-btn" href="/booking/history">
          {copy.viewHistory}
        </Link>
      </footer>
    )
  }

  return (
    <footer className="booking-footer">
      {step === "calendar" ? (
        <span aria-hidden="true" />
      ) : (
        <button className="booking-footer__secondary glass-flat" type="button" onClick={onBack}>
          {copy.back}
        </button>
      )}
      {step === "calendar" ? null : (
        <button
          className="booking-footer__primary glass-btn"
          type="button"
          disabled={!canGoNext || submitting}
          onClick={onNext}
        >
          {nextLabel(step, submitting, copy)}
        </button>
      )}
    </footer>
  )
}
