import type { BookingStep } from "@/lib/booking/form-schema"

const steps: { value: BookingStep; label: string }[] = [
  { value: "calendar", label: "日時" },
  { value: "form", label: "入力" },
  { value: "confirm", label: "確認" },
  { value: "done", label: "完了" },
]

type BookingProgressBarProps = {
  currentStep: BookingStep
}

export function BookingProgressBar({ currentStep }: BookingProgressBarProps) {
  const currentIndex = steps.findIndex((step) => step.value === currentStep)

  return (
    <div className="booking-progress glass-flat" aria-label="予約ステップ">
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
