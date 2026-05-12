import { auth } from "@/auth"
import { BookingSettings } from "@/components/booking/booking-settings"
import { ArrowLeft } from "lucide-react"
import Link from "next/link"
import { redirect } from "next/navigation"

export default async function BookingSettingsPage() {
  const session = await auth()
  if (!session?.user) redirect("/login?callbackUrl=/booking/settings")

  return (
    <section className="mx-auto w-full max-w-[1440px] px-4 md:px-8 xl:px-12 py-12 md:py-16">
      <div className="glass-card p-8 md:p-10 xl:p-14">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-hp-muted">
              Booking Settings
            </p>
            <h1 className="mt-2 text-4xl font-bold text-hp md:text-5xl xl:text-6xl">
              予約カレンダー設定
            </h1>
          </div>
          <Link
            href="/booking"
            className="glass-btn inline-flex min-h-11 items-center gap-2 px-4 py-3 text-sm font-semibold text-hp"
          >
            <ArrowLeft aria-hidden="true" size={18} />
            <span>戻る</span>
          </Link>
        </div>
        <div className="mt-8">
          <BookingSettings />
        </div>
      </div>
    </section>
  )
}
