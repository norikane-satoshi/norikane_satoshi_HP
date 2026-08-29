import { auth } from "@/auth"
import { BookingSettings } from "@/components/booking/booking-settings"
import { ArrowLeft } from "lucide-react"
import {getLocale} from "next-intl/server"
import { redirect } from "next/navigation"
import {Link} from "@/i18n/navigation"
import {getLocalizedCopy} from "@/i18n/copy"

export default async function BookingSettingsPage() {
  const locale = await getLocale() as "ja" | "en"
  const copy = getLocalizedCopy(locale, "Booking")
  const session = await auth()
  if (!session?.user) redirect(`/${locale}/login?callbackUrl=/${locale}/booking/settings`)

  return (
    <section className="mx-auto w-full max-w-[1440px] px-4 md:px-8 xl:px-12 py-12 md:py-16">
      <div className="glass-card p-8 md:p-10 xl:p-14">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-4xl font-bold text-hp md:text-5xl xl:text-6xl">
              {copy.settingsLabel}
            </h1>
          </div>
          <Link
            href="/booking"
            className="glass-btn inline-flex min-h-11 items-center gap-2 px-4 py-3 text-sm font-semibold text-hp"
          >
            <ArrowLeft aria-hidden="true" size={18} />
            <span>{copy.back}</span>
          </Link>
        </div>
        <div className="mt-8">
          <BookingSettings />
        </div>
      </div>
    </section>
  )
}
