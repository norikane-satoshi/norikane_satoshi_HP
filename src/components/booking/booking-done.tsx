import { formatBookingDateSelection, type BookingDateSelection, type BookingSlot } from "@/lib/booking/domain/form-schema"

type BookingDoneProps = {
  selectedSlots: BookingSlot[]
  requestedDateSelection?: BookingDateSelection | null
  entryPoint?: "web" | "line_liff"
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

function formatSlots(slots: BookingSlot[], requestedDateSelection?: BookingDateSelection | null): string {
  if (requestedDateSelection) return formatBookingDateSelection(requestedDateSelection)
  if (slots.length === 0) return "希望日未選択"
  return slots.map((slot) => formatSlot(slot)).join(" / ")
}

export function BookingDone({ selectedSlots, requestedDateSelection = null, entryPoint = "web" }: BookingDoneProps) {
  const receiptText =
    entryPoint === "line_liff"
      ? "公式LINEに受付のお知らせを送ります。内容を確認後、直接ご連絡します。"
      : "確認メールをお送りしました。内容を確認後、直接ご連絡します。"

  return (
    <div className="booking-done glass-card-sm">
      <h2 className="booking-done__title">日程相談を受け付けました</h2>
      <p className="text-hp-muted">{receiptText}</p>
      <span className="glass-badge booking-done__slot">{formatSlots(selectedSlots, requestedDateSelection)}</span>
    </div>
  )
}
