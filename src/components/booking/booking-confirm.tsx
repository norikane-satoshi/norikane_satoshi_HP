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

function formatSlot(slot: BookingSlot): string {
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

function formatSlots(slots: BookingSlot[], requestedDateSelection?: BookingDateSelection | null): string {
  if (requestedDateSelection) return formatBookingDateSelection(requestedDateSelection)
  if (slots.length === 0) return "希望日未選択"
  return slots.map((slot) => formatSlot(slot)).join(" / ")
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
  const rows = [
    ["案件名", formData.projectTitle],
    ["希望日", formatSlots(selectedSlots, requestedDateSelection)],
    ...(selectedSlots.length > 0 ? [["想定作業時間合計", formatDurationMinutes(getTotalDurationMinutes(selectedSlots))] as const] : []),
    ["納期(任意)", formData.dueDate],
    ["会社名", formData.companyName],
    ["氏名", formData.contactName],
    [sessionEmailOptional ? "メール(任意)" : "メール", formData.sessionEmail],
    ["TEL", formData.phone],
    ["補足(任意)", formData.memo],
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
                  希望日を選び直す
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
        <span className="glass-badge booking-confirm__slot-pill">{formatSlots(selectedSlots, requestedDateSelection)}</span>
        <h2 className="booking-confirm__title">日程相談内容の確認</h2>
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
