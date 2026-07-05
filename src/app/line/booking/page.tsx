import { auth } from "@/auth"
import { BookingMonthSkeleton } from "@/components/booking/booking-month-skeleton"
import { LiffBookingEntry } from "@/components/line/liff-booking-entry"
import { isAdmin } from "@/lib/auth/server/is-admin"
import { getCalendarFreeBusyForUser } from "@/lib/booking/server/calendar-free-busy/free-busy"
import type { Metadata } from "next"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

type InitialFreeBusy = Awaited<ReturnType<typeof getCalendarFreeBusyForUser>>

function initialBusyRange(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const end = new Date(now.getFullYear(), now.getMonth() + 2, 1)
  return {
    start: start.toISOString(),
    end: end.toISOString(),
  }
}

async function loadInitialFreeBusy(input: {
  userId?: string
  isCalendarAdmin: boolean
  initialRange: { start: string; end: string }
}): Promise<Pick<InitialFreeBusy, "busy" | "bookings">> {
  if (!input.userId) return { busy: [], bookings: [] }
  const result = await getCalendarFreeBusyForUser({
    userId: input.userId,
    teamId: null,
    timeMin: input.initialRange.start,
    timeMax: input.initialRange.end,
    calendarId: process.env.GOOGLE_CALENDAR_BUSY_SOURCE_ID,
    isCalendarAdmin: input.isCalendarAdmin,
  })
  return { busy: result.busy, bookings: result.bookings }
}

export default async function LineBookingPage() {
  const now = new Date()
  const initialRange = initialBusyRange(now)
  const session = await auth()
  const isCalendarAdmin = isAdmin(session?.user?.email)
  const initialFreeBusy = await loadInitialFreeBusy({
    userId: session?.user?.id,
    isCalendarAdmin,
    initialRange,
  })

  return (
    <LiffBookingEntry
      isCalendarAdmin={isCalendarAdmin}
      initialSession={session}
      initialBusy={initialFreeBusy.busy}
      initialBookings={initialFreeBusy.bookings}
      initialRange={initialRange}
      monthSkeleton={(
        <BookingMonthSkeleton
          initialBusy={initialFreeBusy.busy}
          initialBookings={initialFreeBusy.bookings}
          initialRange={initialRange}
          now={now}
          teamId={null}
          pending={!session?.user?.id}
        />
      )}
    />
  )
}
