import type { Metadata } from "next"
import Link from "next/link"
import { Lock } from "lucide-react"

import styles from "./availability-calendar.module.css"
import { PUBLIC_AVAILABILITY_ROUTE } from "@/lib/booking/domain/public-availability"
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

export default async function PublicAvailabilityCalendarPage({ searchParams }: PageProps) {
  const params = await searchParams
  const month = Array.isArray(params?.month) ? params?.month[0] : params?.month
  const availability = await loadPublicAvailabilityMonth({ month })
  const hasIssue = availability.status !== 200 || Boolean(availability.code)

  return (
    <section className={styles.shell}>
      <div className={`glass-card ${styles.card}`}>
        <div className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Availability</p>
            <h1 className={styles.title}>{availability.monthLabel}</h1>
            <p className={styles.lead}>予約可否の目安だけを表示しています。案件名や予定の詳細は表示しません。</p>
          </div>
          <nav className={styles.monthNav} aria-label="表示月">
            <Link className={`glass-card-sm ${styles.monthLink}`} href={monthParam(availability.prevMonth)}>
              前月
            </Link>
            <Link className={`glass-card-sm ${styles.monthLink}`} href={monthParam(availability.nextMonth)}>
              翌月
            </Link>
          </nav>
        </div>

        <div className={styles.legend} aria-label="凡例">
          <span className={styles.legendItem}>
            <span className={styles.legendMark} aria-hidden="true" />
            空き
          </span>
          <span className={styles.legendItem}>
            <span className={`${styles.legendMark} ${styles.legendMarkBusy}`} aria-hidden="true" />
            予定あり
          </span>
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
              const stateText = day.isBusy ? "予定あり" : "空き"
              return (
                <div
                  key={day.dateKey}
                  className={[
                    styles.day,
                    !day.inMonth ? styles.dayMuted : "",
                    day.isTodayOrPast ? styles.dayPast : "",
                    day.isBusy ? styles.dayBusy : "",
                  ].filter(Boolean).join(" ")}
                  data-date={day.dateKey}
                  data-busy={day.isBusy ? "true" : "false"}
                  aria-label={`${day.dateKey} ${stateText}`}
                >
                  <span className={styles.dayNumber}>{day.day}</span>
                  <span className={styles.status}>
                    {day.isBusy ? <Lock className={styles.lock} size={14} aria-hidden="true" /> : null}
                    {stateText}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </section>
  )
}
