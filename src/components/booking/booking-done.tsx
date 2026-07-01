import { formatBookingDateRange, type BookingDateRange, type BookingSlot } from "@/lib/booking/domain/form-schema"

type BookingDoneProps = {
  selectedSlots: BookingSlot[]
  requestedDateRange?: BookingDateRange | null
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

function formatSlots(slots: BookingSlot[], requestedDateRange?: BookingDateRange | null): string {
  if (requestedDateRange) return formatBookingDateRange(requestedDateRange)
  if (slots.length === 0) return "相談希望日未選択"
  return slots.map((slot) => formatSlot(slot)).join(" / ")
}

export function BookingDone({ selectedSlots, requestedDateRange = null }: BookingDoneProps) {
  return (
    <div className="booking-done glass-card-sm">
      <h2 className="booking-done__title">日程相談を受け付けました</h2>
      <p className="text-hp-muted">確認メールをお送りしました。内容を確認後、直接ご連絡します。</p>
      <span className="glass-badge booking-done__slot">{formatSlots(selectedSlots, requestedDateRange)}</span>
    </div>
  )
}
