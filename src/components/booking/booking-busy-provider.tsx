import { BookingSection } from "@/components/booking/booking-section"
import { getCalendarFreeBusyForUser } from "@/lib/booking/calendar-free-busy"

type BookingBusyProviderProps = {
  userId: string
  userEmail: string
  teamId: string | null
  now: Date
  initialRange: { start: string; end: string }
}

export async function BookingBusyProvider({
  userId,
  userEmail,
  teamId,
  initialRange,
}: BookingBusyProviderProps) {
  const initialBusy = await getCalendarFreeBusyForUser({
    userId,
    teamId,
    timeMin: initialRange.start,
    timeMax: initialRange.end,
    calendarId: process.env.GOOGLE_CALENDAR_BUSY_SOURCE_ID,
  }).catch(() => ({ busy: [], bookings: [] }))

  return (
    <BookingSection
      userId={userId}
      userEmail={userEmail}
      initialBusy={initialBusy.busy}
      initialBookings={initialBusy.bookings}
      initialRange={initialRange}
      monthSkeleton={null}
    />
  )
}
