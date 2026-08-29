"use client"

import {useLocale} from "next-intl"
import type { BookingStep } from "@/lib/booking/domain/form-schema"

type BookingProgressBarProps = {
  currentStep: BookingStep
}

export function BookingProgressBar({ currentStep }: BookingProgressBarProps) {
  const english = useLocale() === "en"
  const steps: { value: BookingStep; label: string }[] = [
    { value: "calendar", label: english ? "Dates" : "日時" },
    { value: "form", label: english ? "Details" : "入力" },
    { value: "confirm", label: english ? "Review" : "確認" },
    { value: "done", label: english ? "Done" : "完了" },
  ]
  const currentIndex = steps.findIndex((step) => step.value === currentStep)

  return (
    <div className="booking-progress glass-flat" aria-label={english ? "Booking steps" : "予約ステップ"}>
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
