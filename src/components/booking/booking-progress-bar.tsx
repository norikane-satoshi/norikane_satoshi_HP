"use client"

import {useLocale} from "next-intl"
import {getLocalizedCopy} from "@/i18n/copy"
import type { BookingStep } from "@/lib/booking/domain/form-schema"

type BookingProgressBarProps = {
  currentStep: BookingStep
}

export function BookingProgressBar({ currentStep }: BookingProgressBarProps) {
  const copy = getLocalizedCopy(useLocale(), "Booking")
  const steps: { value: BookingStep; label: string }[] = [
    { value: "calendar", label: copy.stepDates },
    { value: "form", label: copy.stepDetails },
    { value: "confirm", label: copy.stepReview },
    { value: "done", label: copy.stepDone },
  ]
  const currentIndex = steps.findIndex((step) => step.value === currentStep)

  return (
    <div className="booking-progress glass-flat" aria-label={copy.steps}>
      {steps.map((step, index) => {
        const reached = index <= currentIndex
        const current = index === currentIndex

        return (
          <div className="booking-progress__item" key={step.value}>
            <span
              className={`booking-progress__dot ${reached ? "booking-progress__dot--reached" : ""}`}
              aria-current={current ? "step" : undefined}
            >
              {index + 1}
            </span>
            <span className={reached ? "text-hp" : "text-hp-muted"}>{step.label}</span>
            {index < steps.length - 1 ? <span className="booking-progress__line" /> : null}
          </div>
        )
      })}
    </div>
  )
}
