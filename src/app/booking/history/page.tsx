import type { Metadata } from "next"
import {getLocale} from "next-intl/server"
import { redirect } from "next/navigation"

import { auth } from "@/auth"
import { listBookingHistoryForUser, type BookingHistoryItem } from "@/lib/booking/server/history"
import {Link} from "@/i18n/navigation"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

function formatCreatedAt(value: string, locale: "ja" | "en"): string {
  return new Intl.DateTimeFormat(locale === "en" ? "en-US" : "ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Tokyo",
  }).format(new Date(value))
}

function displayValue(value: string | null): string {
  return value?.trim() ? value.trim() : "-"
}

function BookingHistoryCard({ booking, english }: { booking: BookingHistoryItem; english: boolean }) {
  return (
    <article className="booking-history__card glass-card-sm">
      <div className="booking-history__card-head">
        <div className="booking-history__title-group">
          <h2 className="booking-history__item-title">{booking.projectTitle}</h2>
          <p className="booking-history__created">{formatCreatedAt(booking.createdAt, english ? "en" : "ja")}</p>
        </div>
        <span className="glass-badge booking-history__status">{booking.statusLabel}</span>
      </div>
      <dl className="booking-history__details">
        <div className="booking-history__row">
          <dt>{english ? "Requested dates" : "希望日一覧"}</dt>
          <dd>{booking.requestedDates.length > 0 ? booking.requestedDates.join(" / ") : "-"}</dd>
        </div>
        <div className="booking-history__row">
          <dt>{english ? "Name" : "氏名"}</dt>
          <dd>{booking.contactName}</dd>
        </div>
        <div className="booking-history__row">
          <dt>{english ? "Company" : "会社名"}</dt>
          <dd>{displayValue(booking.companyName)}</dd>
        </div>
        <div className="booking-history__row">
          <dt>{english ? "Notes" : "補足"}</dt>
          <dd>{displayValue(booking.memo)}</dd>
        </div>
      </dl>
    </article>
  )
}

export default async function BookingHistoryPage() {
  const locale = await getLocale() as "ja" | "en"
  const english = locale === "en"
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) redirect(`/api/auth/signin?callbackUrl=/${locale}/booking/history`)

  const bookings = await listBookingHistoryForUser(userId)

  return (
    <section className="mx-auto w-full max-w-[1440px] px-4 py-12 md:px-8 md:py-16 xl:px-12">
      <div className="glass-card p-8 md:p-10 xl:p-14">
        <div className="booking-history__page-head">
          <div>
            <h1 className="text-3xl font-bold text-hp md:text-4xl">{english ? "Booking history" : "予約一覧"}</h1>
          </div>
          <Link className="booking-history__back glass-flat" href="/booking">
            {english ? "Back to calendar" : "カレンダーに戻る"}
          </Link>
        </div>

        <div className="booking-history__list">
          {bookings.length > 0 ? (
            bookings.map((booking) => <BookingHistoryCard key={booking.id} booking={booking} english={english} />)
          ) : (
            <p className="booking-history__empty glass-card-sm">{english ? "No booking requests have been sent yet." : "送信済みの日程相談はまだありません。"}</p>
          )}
        </div>
      </div>
    </section>
  )
}
