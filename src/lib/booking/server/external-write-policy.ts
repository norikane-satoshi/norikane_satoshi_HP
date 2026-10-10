type BookingWriteEnvironment = Record<string, string | undefined>

export const BOOKING_EXTERNAL_WRITES_DISABLED = "booking_external_writes_disabled"

export function bookingExternalWritesEnabled(env: BookingWriteEnvironment = process.env): boolean {
  return env.NODE_ENV === "production"
    && env.VERCEL === "1"
    && env.VERCEL_ENV === "production"
    && env.BOOKING_EXTERNAL_WRITES !== "disabled"
    && !env.VITEST
}

export class BookingExternalWritesDisabledError extends Error {
  readonly code = BOOKING_EXTERNAL_WRITES_DISABLED

  constructor() {
    super(BOOKING_EXTERNAL_WRITES_DISABLED)
    this.name = "BookingExternalWritesDisabledError"
  }
}

export function assertBookingExternalWritesEnabled(): void {
  if (!bookingExternalWritesEnabled()) throw new BookingExternalWritesDisabledError()
}
