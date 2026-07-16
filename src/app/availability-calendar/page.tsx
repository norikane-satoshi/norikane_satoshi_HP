import type { Metadata } from "next"
import Link from "next/link"
import { Clock3, ExternalLink, Lock } from "lucide-react"

import styles from "./availability-calendar.module.css"
import { buildPublicAvailabilityBlockMarkers, PUBLIC_AVAILABILITY_ROUTE } from "@/lib/booking/domain/public-availability"
import { loadPublicAvailabilityMonth } from "@/lib/booking/server/public-availability"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "空き状況カレンダー | のりかね映像設計室",
  robots: { index: false, follow: false },
}

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"]

type PageProps = {
  searchParams?: Promise<{ month?: string | string[] }>
}

function monthParam(value: string) {
  return `${PUBLIC_AVAILABILITY_ROUTE}?month=${encodeURIComponent(value)}`
}

function statusText(status: "available" | "busy" | "tentative") {
  if (status === "busy") return "予約済み（本予約）"
  if (status === "tentative") return "仮キープ"
  return "空き"
}

function currentMonthParam(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now)
  const year = parts.find((part) => part.type === "year")?.value
  const month = parts.find((part) => part.type === "month")?.value
  return year && month ? `${year}-${month}` : ""
}

export default async function PublicAvailabilityCalendarPage({ searchParams }: PageProps) {
  const params = await searchParams
  const month = Array.isArray(params?.month) ? params?.month[0] : params?.month
  const availability = await loadPublicAvailabilityMonth({ month })
  const hasIssue = availability.status !== 200 || Boolean(availability.code)
  const currentMonth = currentMonthParam()
  const blockMarkers = buildPublicAvailabilityBlockMarkers(availability.days)

  return (
    <section className={styles.shell}>
      <div className={`glass-card ${styles.card}`}>
        <div className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Availability</p>
            <h1 className={styles.title}>{availability.monthLabel}</h1>
            <p className={styles.lead}>予約可否の目安だけを表示しています。案件名や予定の詳細は表示しません。</p>
          </div>
          <div className={styles.actions}>
            <Link className={`glass-card-sm ${styles.homeLink}`} href="/">
              <ExternalLink size={16} aria-hidden="true" />
              本体サイトへ移動
            </Link>
            <nav className={styles.monthNav} aria-label="表示月">
              <Link
                className={`glass-card-sm ${styles.monthLink}`}
                href={monthParam(currentMonth)}
                aria-current={availability.month === currentMonth ? "page" : undefined}
              >
                今月
              </Link>
              <Link className={`glass-card-sm ${styles.monthLink}`} href={monthParam(availability.prevMonth)}>
                前月
              </Link>
              <Link className={`glass-card-sm ${styles.monthLink}`} href={monthParam(availability.nextMonth)}>
                翌月
              </Link>
            </nav>
          </div>
        </div>

        {hasIssue ? (
          <p className={styles.warning} role="status">
            空き状況を取得できませんでした。
          </p>
        ) : null}

        <div className={styles.calendar} data-testid="public-availability-calendar">
          <div className={styles.weekdays} aria-hidden="true">
            {WEEKDAYS.map((weekday) => (
              <div key={weekday} className={styles.weekday}>
                {weekday}
              </div>
            ))}
          </div>
          <div className={styles.grid}>
            {availability.days.map((day) => {
              const stateText = statusText(day.status)
              const blockMarker = blockMarkers.get(day.dateKey)
              return (
                <div
                  key={day.dateKey}
                  className={[
                    styles.day,
                    !day.inMonth ? styles.dayMuted : "",
                    day.isTodayOrPast ? styles.dayPast : "",
                    day.isBusy ? styles.dayBusy : "",
                    day.isTentative ? styles.dayTentative : "",
                    blockMarker?.isStart ? styles.dayBlockStart : "",
                    blockMarker?.isEnd ? styles.dayBlockEnd : "",
                    blockMarker?.isMiddle ? styles.dayBlockMiddle : "",
                  ].filter(Boolean).join(" ")}
                  data-date={day.dateKey}
                  data-busy={day.isBusy ? "true" : "false"}
                  data-status={day.status}
                  aria-label={`${day.dateKey} ${stateText}`}
                >
                  <span className={styles.dayNumber}>{day.day}</span>
                  {blockMarker?.isStart ? (
                    <span className={styles.status}>
                      {day.status === "busy" ? <Lock className={styles.lock} size={14} aria-hidden="true" /> : null}
                      {day.status === "tentative" ? <Clock3 className={styles.tentativeIcon} size={14} aria-hidden="true" /> : null}
                      {day.status === "tentative" ? "仮キープ" : null}
                    </span>
                  ) : null}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </section>
  )
}
