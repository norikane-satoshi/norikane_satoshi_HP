import { auth } from "@/auth"
import { BookingSettings } from "@/components/booking/booking-settings"
import { ArrowLeft } from "lucide-react"
import Link from "next/link"
import { redirect } from "next/navigation"

export default async function BookingSettingsPage() {
  const session = await auth()
  if (!session?.user) redirect("/login?callbackUrl=/booking/settings")

  return (
    <section className="hp-section-shell py-12 md:py-16">
      <div>
        <div className="hp-section-heading-row">
          <div>
            <h1 className="hp-heading text-3xl font-medium text-hp md:text-4xl xl:text-5xl">
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
        <div className="mt-10">
          <BookingSettings />
        </div>
      </div>
    </section>
  )
}
