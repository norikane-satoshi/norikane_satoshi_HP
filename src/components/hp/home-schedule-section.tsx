import { auth } from "@/auth"
import { BookingSection } from "@/components/booking/booking-section"
import { isAdmin } from "@/lib/auth/server/is-admin"
import Link from "next/link"

export async function HomeScheduleSection() {
  const session = await auth()
  const isCalendarAdmin = isAdmin(session?.user?.email)

  return (
    <section
      id="schedule"
      className="hp-section-shell scroll-mt-24 md:scroll-mt-28"
    >
      <div className="glass-card glass-card--hp-schedule p-8 md:p-10 xl:p-14">
        <div className="hp-grid">
          <div className="hp-section-heading hp-section-title-stack">
            <p className="text-xs uppercase tracking-[0.22em] text-hp-muted">
              Schedule
            </p>
            <h2 className="hp-heading text-2xl font-semibold text-hp md:text-3xl">
              予約カレンダー
            </h2>
          </div>
        </div>

        <div className="mt-[var(--hp-space-4)]">
          {session?.user?.id ? (
            <BookingSection
              isCalendarAdmin={isCalendarAdmin}
              userId={session.user.id}
              userEmail={session.user.email ?? ""}
            />
          ) : (
            <div className="flex flex-col items-center justify-center text-center">
              <p className="text-base text-hp-muted">
                予約フォームのご利用にはログインが必要です。
              </p>
              <Link
                href="/api/auth/signin?callbackUrl=/"
                className="glass-btn px-6 py-3 text-sm font-medium text-hp inline-flex items-center justify-center gap-2 mt-6"
              >
                ログインして予約に進む
              </Link>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
