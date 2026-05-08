import {
  formatDurationMinutes,
  getTotalDurationMinutes,
  type BookingFormData,
  type BookingSlot,
} from "@/lib/booking/form-schema"

type BookingConfirmProps = {
  formData: BookingFormData
  selectedSlot: BookingSlot | null
  selectedSlots: BookingSlot[]
  submitError?: string | null
  onDismissSubmitError?: () => void
  onReselectDate?: (slot?: BookingSlot) => void
}

function formatSlot(slot: BookingSlot | null): string {
  if (!slot) return "日時未選択"

  const start = new Date(slot.start)
  const end = new Date(slot.end)
  return `${start.toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })} - ${end.toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
  })}`
}

function valueOrDash(value: string | string[]): string {
  if (Array.isArray(value)) return value.length > 0 ? value.join(" / ") : "-"
  return value.trim() || "-"
}

function formatSlots(slots: BookingSlot[]): string {
  if (slots.length === 0) return "日時未選択"
  return slots.map((slot) => formatSlot(slot)).join(" / ")
}

export function BookingConfirm({
  formData,
  selectedSlot,
  selectedSlots,
  submitError,
  onDismissSubmitError,
  onReselectDate,
}: BookingConfirmProps) {
  const rows = [
    ["予約種別", formData.bookingKind === "tentative" ? "仮キープ" : "本予約"],
    ["案件名", formData.projectTitle],
    ["想定作業時間合計", formatDurationMinutes(getTotalDurationMinutes(selectedSlots))],
    ["納期", formData.dueDate],
    ["会社名", formData.companyName],
    ["担当者氏名", formData.contactName],
    ["メールアドレス", formData.sessionEmail],
    ["連絡用メール", formData.contactEmail],
    ["電話番号", formData.phone],
    ["補足メモ", formData.memo],
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
                  日時を選び直す
                </button>
              ) : null}
              {onDismissSubmitError ? (
                <button className="booking-section__text-button" type="button" onClick={onDismissSubmitError}>
                  閉じる
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
      <div>
        <span className="glass-badge booking-confirm__slot-pill">{formatSlots(selectedSlots.length > 0 ? selectedSlots : selectedSlot ? [selectedSlot] : [])}</span>
        <h2 className="booking-confirm__title">申込内容の確認</h2>
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
