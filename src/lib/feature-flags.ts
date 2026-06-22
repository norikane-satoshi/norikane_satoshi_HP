/**
 * NEXT_PUBLIC_ allows client components to read these flags and lets
 * build-time static analysis eliminate false branches. Booking entrypoints
 * are opt-in only; the chatbot is opt-out only so public consultation stays visible.
 */
export const isBookingEnabled = () => process.env.NEXT_PUBLIC_ENABLE_BOOKING === "true"

export const isChatbotEnabled = () => process.env.NEXT_PUBLIC_ENABLE_CHATBOT !== "false"

const localBookingScheduleHosts = new Set([
  "localhost:41238",
  "127.0.0.1:41238",
  "[::1]:41238",
])

export const isLocalBookingScheduleHost = (host: string | null | undefined) =>
  localBookingScheduleHosts.has((host ?? "").trim().toLowerCase())

export const isBookingScheduleSectionVisible = (host: string | null | undefined) =>
  isBookingEnabled() || isLocalBookingScheduleHost(host)
