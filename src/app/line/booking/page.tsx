import { auth } from "@/auth"
import { BookingMonthSkeleton } from "@/components/booking/booking-month-skeleton"
import { LiffBookingEntry } from "@/components/line/liff-booking-entry"
import { isAdmin } from "@/lib/auth/server/is-admin"
import type { Metadata } from "next"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

function initialBusyRange(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const end = new Date(now.getFullYear(), now.getMonth() + 2, 1)
  return {
    start: start.toISOString(),
    end: end.toISOString(),
  }
}

export default async function LineBookingPage() {
  const now = new Date()
  const initialRange = initialBusyRange(now)
  const session = await auth()
  const isCalendarAdmin = isAdmin(session?.user?.email)

  return (
    <LiffBookingEntry
      isCalendarAdmin={isCalendarAdmin}
      monthSkeleton={(
        <BookingMonthSkeleton
          initialBusy={[]}
          initialBookings={[]}
          initialRange={initialRange}
          now={now}
          teamId={null}
          pending
        />
      )}
    />
  )
}
