import { auth } from "@/auth"
import { BookingClientShell } from "@/components/booking/booking-client-shell"
import { BookingMonthSkeleton } from "@/components/booking/booking-month-skeleton"
import { Menu } from "lucide-react"
import type { Metadata } from "next"
import Link from "next/link"

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

export default async function BookingPage() {
  const now = new Date()
  const initialRange = initialBusyRange(now)
  const session = await auth()
  const adminEmail = process.env.BOOKING_CALENDAR_ADMIN_EMAIL ?? null
  const __sessionEmail = session?.user?.email ?? null
  console.log("[admin-gate-diag]", {
    adminEmailLen: adminEmail?.length ?? null,
    adminEmailTrimLen: adminEmail?.trim().length ?? null,
    adminEmailFirstCode:
      adminEmail && adminEmail.length > 0 ? adminEmail.charCodeAt(0) : null,
    adminEmailLastCode:
      adminEmail && adminEmail.length > 0
        ? adminEmail.charCodeAt(adminEmail.length - 1)
        : null,
    adminEmailStartsWithNorikane: adminEmail?.startsWith("norikane") ?? false,
    adminEmailEndsWithGmail: adminEmail?.endsWith("gmail.com") ?? false,
    sessionEmailLen: __sessionEmail?.length ?? null,
    sessionEmailTrimLen: __sessionEmail?.trim().length ?? null,
    equalsRaw: adminEmail === __sessionEmail,
    equalsTrim:
      (adminEmail?.trim() ?? null) === (__sessionEmail?.trim() ?? null),
    ts: new Date().toISOString(),
  })
  const isCalendarAdmin = Boolean(
    adminEmail && session?.user?.email && session.user.email === adminEmail,
  )

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
          <Link
            href="/booking/settings"
            className="glass-btn inline-flex min-h-11 items-center gap-2 px-4 py-3 text-sm font-semibold text-hp"
            aria-label="予約カレンダー設定"
          >
            <Menu aria-hidden="true" size={18} />
            <span>設定</span>
          </Link>
        </div>
        <div className="mt-8">
          <BookingClientShell
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
        </div>
      </div>
    </section>
  )
}
