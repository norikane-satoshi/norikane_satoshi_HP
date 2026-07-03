import { auth } from "@/auth"
import { BookingClientShell } from "@/components/booking/booking-client-shell"
import { BookingMonthSkeleton } from "@/components/booking/booking-month-skeleton"
import { isAdmin } from "@/lib/auth/server/is-admin"
import { getCalendarFreeBusyForUser } from "@/lib/booking/server/calendar-free-busy/free-busy"
import { History, Menu } from "lucide-react"
import type { Metadata } from "next"
import Link from "next/link"

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

export default async function BookingPage() {
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
    <section className="mx-auto w-full max-w-[1440px] px-4 md:px-8 xl:px-12 py-12 md:py-16">
      <div className="glass-card p-8 md:p-10 xl:p-14">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-hp-muted">
              Booking
            </p>
            <h1 className="mt-2 text-4xl font-bold text-hp md:text-5xl xl:text-6xl">
              予約カレンダー
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/booking/history"
              className="glass-btn inline-flex min-h-11 items-center gap-2 px-4 py-3 text-sm font-semibold text-hp"
            >
              <History aria-hidden="true" size={18} />
              <span>予約履歴</span>
            </Link>
            <Link
              href="/booking/settings"
              className="glass-btn inline-flex min-h-11 items-center gap-2 px-4 py-3 text-sm font-semibold text-hp"
              aria-label="予約カレンダー設定"
            >
              <Menu aria-hidden="true" size={18} />
              <span>設定</span>
            </Link>
          </div>
        </div>
        <div className="mt-8">
          <BookingClientShell
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
        </div>
      </div>
    </section>
  )
}
