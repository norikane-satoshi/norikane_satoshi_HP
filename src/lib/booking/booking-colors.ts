type BookingColor = "available" | "confirmed" | "unavailable" | "transparent"

type BookingLike = {
  status: string
  hasAttendance?: boolean
}

function getBookingColor(booking: BookingLike): BookingColor {
  if (booking.status === "CANCELLED") return "transparent"
  if (booking.status === "AVAILABLE") return "available"
  if (booking.status === "CONFIRMED") return "confirmed"
  return "unavailable"
}

export function getBookingCSSColor(booking: BookingLike): string {
  const colorMap: Record<BookingColor, string> = {
    available: "color-mix(in srgb, var(--accent-primary) 12%, transparent)",
    confirmed: "var(--accent-primary)",
    unavailable: "color-mix(in srgb, var(--text-primary) 18%, transparent)",
    transparent: "transparent",
  }
  return colorMap[getBookingColor(booking)]
}

export function getBookingColorLabel(booking: BookingLike): string {
  if (booking.status === "CANCELLED") return "キャンセル"
  if (booking.status === "CONFIRMED" && booking.hasAttendance) return "確定（立会いあり）"
  if (booking.status === "CONFIRMED") return "確定"
  if (booking.status === "HOLIDAY") return "休暇・NG"
  if (booking.status === "MEETING") return "社内"
  return "予定"
}

export interface BookingBlockStyle {
  backgroundColor: string
  borderLeft: string
  borderRight: string
  borderTop: string
  borderBottom: string
  label: string | null
  opacity?: string
  className: "glass-card-sm" | "glass-inset" | "glass-flat"
}

const noBorder = {
  borderLeft: "none",
  borderRight: "none",
  borderTop: "none",
  borderBottom: "none",
}

export function getBookingBlockStyle(
  booking: BookingLike,
  options?: { isActualDisplayed?: boolean; isActualPending?: boolean },
): BookingBlockStyle {
  const isCancelled = booking.status === "CANCELLED"
  const isUnavailable = getBookingColor(booking) === "unavailable"
  const result: BookingBlockStyle = {
    backgroundColor: isCancelled
      ? "transparent"
      : isUnavailable
        ? "color-mix(in srgb, var(--text-primary) 18%, transparent)"
        : getBookingCSSColor(booking),
    ...noBorder,
    label: booking.hasAttendance ? "立会い" : null,
    className: options?.isActualDisplayed ? "glass-inset" : "glass-card-sm",
  }

  if (isCancelled) {
    result.className = "glass-flat"
  }

  if (options?.isActualPending) {
    result.opacity = "0.4"
  }

  return result
}
