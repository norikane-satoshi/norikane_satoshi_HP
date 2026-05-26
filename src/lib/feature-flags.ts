/**
 * Vercel Production env expects explicit false values. Local .env.local expects
 * explicit true values. Preview falls back to false when unset and can opt in
 * with explicit true values. NEXT_PUBLIC_ allows client components to read
 * these flags and lets build-time static analysis eliminate false branches.
 */
export const isBookingEnabled = () => process.env.NEXT_PUBLIC_ENABLE_BOOKING === "true"

export const isChatbotEnabled = () => process.env.NEXT_PUBLIC_ENABLE_CHATBOT === "true"
