import type { Metadata } from "next"
import { Clock3, Lock } from "lucide-react"
import {getLocale} from "next-intl/server"

import styles from "./availability-calendar.module.css"
import { AvailabilityCalendarFrame } from "./availability-calendar-frame"
import { buildPublicAvailabilityBlockMarkers, PUBLIC_AVAILABILITY_ROUTE } from "@/lib/booking/domain/public-availability"
import { loadPublicAvailabilityMonth } from "@/lib/booking/server/public-availability"
import {getLocalizedCopy, type AppMessages} from "@/i18n/copy"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

type PageProps = {
  searchParams?: Promise<{ month?: string | string[] }>
}

function monthParam(value: string) {
  return `${PUBLIC_AVAILABILITY_ROUTE}?month=${encodeURIComponent(value)}`
}

function statusText(status: "available" | "busy" | "tentative", copy: AppMessages["Availability"]) {
  if (status === "busy") return copy.booked
  if (status === "tentative") return copy.tentativeHold
  return copy.available
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
  const locale = await getLocale() as "ja" | "en"
  const english = locale === "en"
  const copy = getLocalizedCopy(locale, "Availability")
  const params = await searchParams
  const month = Array.isArray(params?.month) ? params?.month[0] : params?.month
  const availability = await loadPublicAvailabilityMonth({ month })
  const hasIssue = availability.status !== 200 || Boolean(availability.code)
  const currentMonth = currentMonthParam()
  const blockMarkers = buildPublicAvailabilityBlockMarkers(availability.days)

  return (
    <section className={styles.shell}>
      <div className={`glass-card ${styles.card}`}>
        <AvailabilityCalendarFrame
          currentHref={monthParam(currentMonth)}
          previousHref={monthParam(availability.prevMonth)}
          nextHref={monthParam(availability.nextMonth)}
          heading={(
            <>
            <p className={styles.eyebrow}>{copy.eyebrow}</p>
            <h1 className={styles.title}>{english
              ? new Intl.DateTimeFormat("en-US", {year: "numeric", month: "long", timeZone: "Asia/Tokyo"}).format(new Date(`${availability.month}-01T00:00:00+09:00`))
              : availability.monthLabel}</h1>
            <p className={styles.lead}>{copy.lead}</p>
            </>
          )}
        >
          <div className={styles.calendar} data-testid="public-availability-calendar">
            <div className={styles.weekdays} aria-hidden="true">
              {copy.weekdays.map((weekday) => (
                <div key={weekday} className={styles.weekday}>
                  {weekday}
                </div>
              ))}
            </div>
            <div className={styles.grid}>
              {availability.days.map((day) => {
                const stateText = statusText(day.status, copy)
                const blockMarker = blockMarkers.get(day.dateKey)
                return (
                  <div
                    key={day.dateKey}
                    className={[
                      styles.day,
                      !day.inMonth ? styles.dayMuted : "",
                      day.isTodayOrPast ? styles.dayPast : "",
                      day.isToday ? styles.dayToday : "",
                      day.isBusy ? styles.dayBusy : "",
                      day.isTentative ? styles.dayTentative : "",
                      blockMarker?.isStart ? styles.dayBlockStart : "",
                      blockMarker?.isEnd ? styles.dayBlockEnd : "",
                      blockMarker?.isMiddle ? styles.dayBlockMiddle : "",
                    ].filter(Boolean).join(" ")}
                    data-date={day.dateKey}
                    data-busy={day.isBusy ? "true" : "false"}
                    data-status={day.status}
                    aria-label={`${day.dateKey}${day.isToday ? ` ${copy.today}` : ""} ${stateText}`}
                  >
                    <span className={styles.dayNumber}>{day.day}</span>
                    {day.isToday ? <span className={styles.todayLabel}>{copy.today}</span> : null}
                    {blockMarker?.isStart ? (
                      <span className={styles.status}>
                        {day.status === "busy" ? <Lock className={styles.lock} size={14} aria-hidden="true" /> : null}
                        {day.status === "tentative" ? <Clock3 className={styles.tentativeIcon} size={14} aria-hidden="true" /> : null}
                        {day.status === "tentative" ? copy.tentative : null}
                      </span>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </div>
        </AvailabilityCalendarFrame>

        {hasIssue ? (
          <p className={styles.warning} role="status">
            {copy.loadError}
          </p>
        ) : null}
      </div>
    </section>
  )
}
