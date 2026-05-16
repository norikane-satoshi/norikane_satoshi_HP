import { auth } from "@/auth"
import { BookingSection } from "@/components/booking/booking-section"
import Link from "next/link"

export async function HomeScheduleSection() {
  const session = await auth()
  const adminEmail = process.env.BOOKING_CALENDAR_ADMIN_EMAIL ?? null
  const __sessionEmail = session?.user?.email ?? null
  const isCalendarAdmin = Boolean(
    adminEmail && __sessionEmail && __sessionEmail === adminEmail,
  )

  console.log("[admin-gate-diag]", {
    route: "/",
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

  return (
    <section
      id="schedule"
      className="mx-auto w-full max-w-[1440px] px-6 md:px-10 xl:px-14 scroll-mt-24 md:scroll-mt-28"
    >
      <div className="glass-card p-8 md:p-10 xl:p-14">
        <p className="text-xs uppercase tracking-[0.22em] text-hp-muted">
          Schedule
        </p>
        <h2 className="mt-2 text-2xl font-semibold text-hp md:text-3xl">
          予約カレンダー
        </h2>

        <div className="mt-8">
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
