/**
 * NEXT_PUBLIC_ allows client components to read these flags and lets
 * build-time static analysis eliminate false branches. Booking entrypoints
 * are opt-in only so unset environments hide public booking UI.
 */
const isLocalDev = process.env.NODE_ENV === "development"

function isPublicFeatureEnabled(value: string | undefined) {
  if (value === "true") return true
  if (value === "false") return false
  return isLocalDev
}

export const isBookingEnabled = () => process.env.NEXT_PUBLIC_BOOKING_ENABLED === "true"

export const isChatbotEnabled = () => isPublicFeatureEnabled(process.env.NEXT_PUBLIC_ENABLE_CHATBOT)
