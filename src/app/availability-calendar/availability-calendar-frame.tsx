"use client"

import type { MouseEvent, ReactNode } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useState, useTransition } from "react"
import { ExternalLink } from "lucide-react"

import styles from "./availability-calendar.module.css"

type AvailabilityCalendarFrameProps = {
  currentHref: string
  currentMonth: string
  displayedMonth: string
  nextHref: string
  previousHref: string
  heading: ReactNode
  children: ReactNode
}

const LOADING_DELAY_MS = 150

export function AvailabilityCalendarFrame({
  currentHref,
  currentMonth,
  displayedMonth,
  nextHref,
  previousHref,
  heading,
  children,
}: AvailabilityCalendarFrameProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [showLoading, setShowLoading] = useState(false)

  useEffect(() => {
    if (!isPending) {
      const frame = window.requestAnimationFrame(() => setShowLoading(false))
      return () => window.cancelAnimationFrame(frame)
    }
    const timer = window.setTimeout(() => setShowLoading(true), LOADING_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [isPending])

  const navigate = (href: string) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    setShowLoading(false)
    startTransition(() => router.push(href))
  }

  return (
    <>
      <div className={styles.header}>
        <div>{heading}</div>
        <div className={styles.actions}>
          <Link className={`glass-card-sm ${styles.homeLink}`} href="/">
            <ExternalLink size={16} aria-hidden="true" />
            本体サイトへ移動
          </Link>
          <nav className={styles.monthNav} aria-label="表示月">
            <Link
              className={`glass-card-sm ${styles.monthLink}`}
              href={currentHref}
              aria-current={displayedMonth === currentMonth ? "page" : undefined}
              onClick={navigate(currentHref)}
            >
              今月
            </Link>
            <Link className={`glass-card-sm ${styles.monthLink}`} href={previousHref} onClick={navigate(previousHref)}>
              前月
            </Link>
            <Link className={`glass-card-sm ${styles.monthLink}`} href={nextHref} onClick={navigate(nextHref)}>
              翌月
            </Link>
          </nav>
        </div>
      </div>
      <div className={styles.calendarFrame} aria-busy={showLoading}>
        {children}
        {showLoading ? (
          <div className={styles.loadingOverlay} role="status" data-testid="public-availability-calendar-loading">
            <span className={styles.loadingSpinner} aria-hidden="true" />
            <span>空き状況を更新しています</span>
          </div>
        ) : null}
      </div>
    </>
  )
}
