/**
 * NEXT_PUBLIC_ allows client components to read these flags and lets
 * build-time static analysis eliminate false branches. Booking entrypoints
 * are opt-in only; the chatbot is opt-out only so public consultation stays visible.
 */
export const isBookingEnabled = () => process.env.NEXT_PUBLIC_ENABLE_BOOKING === "true"

export const isChatbotEnabled = () => process.env.NEXT_PUBLIC_ENABLE_CHATBOT !== "false"
