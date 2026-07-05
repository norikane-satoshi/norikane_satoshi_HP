import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"

import { auth } from "@/auth"
import { listBookingHistoryForUser, type BookingHistoryItem } from "@/lib/booking/server/history"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

function formatCreatedAt(value: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
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

function BookingHistoryCard({ booking }: { booking: BookingHistoryItem }) {
  return (
    <article className="booking-history__card glass-card-sm">
      <div className="booking-history__card-head">
        <div className="booking-history__title-group">
          <h2 className="booking-history__item-title">{booking.projectTitle}</h2>
          <p className="booking-history__created">{formatCreatedAt(booking.createdAt)}</p>
        </div>
        <span className="glass-badge booking-history__status">{booking.statusLabel}</span>
      </div>
      <dl className="booking-history__details">
        <div className="booking-history__row">
          <dt>希望日一覧</dt>
          <dd>{booking.requestedDates.length > 0 ? booking.requestedDates.join(" / ") : "-"}</dd>
        </div>
        <div className="booking-history__row">
          <dt>氏名</dt>
          <dd>{booking.contactName}</dd>
        </div>
        <div className="booking-history__row">
          <dt>会社名</dt>
          <dd>{displayValue(booking.companyName)}</dd>
        </div>
        <div className="booking-history__row">
          <dt>補足</dt>
          <dd>{displayValue(booking.memo)}</dd>
        </div>
      </dl>
    </article>
  )
}

export default async function BookingHistoryPage() {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) redirect("/api/auth/signin?callbackUrl=/booking/history")

  const bookings = await listBookingHistoryForUser(userId)

  return (
    <section className="mx-auto w-full max-w-[1440px] px-4 py-12 md:px-8 md:py-16 xl:px-12">
      <div className="glass-card p-8 md:p-10 xl:p-14">
        <div className="booking-history__page-head">
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-hp-muted">Booking</p>
            <h1 className="mt-2 text-3xl font-bold text-hp md:text-4xl">予約一覧</h1>
          </div>
          <Link className="booking-history__back glass-flat" href="/booking">
            カレンダーに戻る
          </Link>
        </div>

        <div className="booking-history__list">
          {bookings.length > 0 ? (
            bookings.map((booking) => <BookingHistoryCard key={booking.id} booking={booking} />)
          ) : (
            <p className="booking-history__empty glass-card-sm">送信済みの日程相談はまだありません。</p>
          )}
        </div>
      </div>
    </section>
  )
}
