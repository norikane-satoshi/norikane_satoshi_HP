import Link from "next/link"

import type { BookingStep } from "@/lib/booking/domain/form-schema"

type BookingFooterProps = {
  step: BookingStep
  canGoNext: boolean
  submitting?: boolean
  onBack: () => void
  onNext: () => void
  onReset: () => void
}

function nextLabel(step: BookingStep, submitting: boolean): string {
  if (submitting) return "送信中…"
  if (step === "confirm") return "日程相談を送信"
  return "相談内容を確認"
}

export function BookingFooter({ step, canGoNext, submitting = false, onBack, onNext, onReset }: BookingFooterProps) {
  if (step === "done") {
    return (
      <footer className="booking-footer">
        <button className="booking-footer__secondary glass-flat" type="button" onClick={onReset}>
          カレンダーに戻る
        </button>
        <Link className="booking-footer__primary glass-btn" href="/booking/history">
          マイページで予約一覧を見る
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
          戻る
        </button>
      )}
      {step === "calendar" ? null : (
        <button
          className="booking-footer__primary glass-btn"
          type="button"
          disabled={!canGoNext || submitting}
          onClick={onNext}
        >
          {nextLabel(step, submitting)}
        </button>
      )}
    </footer>
  )
}
