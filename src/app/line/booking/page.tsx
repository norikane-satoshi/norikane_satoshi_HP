import { auth } from "@/auth"
import { BookingMonthSkeleton } from "@/components/booking/booking-month-skeleton"
import { LiffBookingEntry } from "@/components/line/liff-booking-entry"
import { isAdmin } from "@/lib/auth/server/is-admin"
import { getCalendarFreeBusyForUser } from "@/lib/booking/server/calendar-free-busy/free-busy"
import { loadTentativeAvailabilityDateKeys } from "@/lib/booking/server/tentative-availability"
import type { Metadata } from "next"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

type InitialFreeBusy = Awaited<ReturnType<typeof getCalendarFreeBusyForUser>>
type InitialLineAvailability = Pick<InitialFreeBusy, "busy" | "bookings"> & {
  tentativeDateKeys: string[]
}

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
}): Promise<InitialLineAvailability> {
  if (!input.userId) return { busy: [], bookings: [], tentativeDateKeys: [] }
  const result = await getCalendarFreeBusyForUser({
    userId: input.userId,
    teamId: null,
    timeMin: input.initialRange.start,
    timeMax: input.initialRange.end,
    calendarId: process.env.GOOGLE_CALENDAR_BUSY_SOURCE_ID,
    isCalendarAdmin: input.isCalendarAdmin,
  })
  let tentativeDateKeys: string[] = []
  if (result.status === 200 && !result.code) {
    try {
      tentativeDateKeys = await loadTentativeAvailabilityDateKeys({
        cacheUserId: input.userId,
        timeMin: input.initialRange.start,
        timeMax: input.initialRange.end,
      })
    } catch (error) {
      console.warn("[line-booking] tentative availability load failed", error)
    }
  }
  return { busy: result.busy, bookings: result.bookings, tentativeDateKeys }
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
      initialTentativeDateKeys={initialFreeBusy.tentativeDateKeys}
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
