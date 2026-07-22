"use client"

import type { ReactNode } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useState, useTransition } from "react"
import { ChevronLeft, ChevronRight, ExternalLink } from "lucide-react"

import styles from "./availability-calendar.module.css"

type AvailabilityCalendarFrameProps = {
  currentHref: string
  nextHref: string
  previousHref: string
  heading: ReactNode
  children: ReactNode
}

const LOADING_DELAY_MS = 150

export function AvailabilityCalendarFrame({
  currentHref,
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

  const navigate = (href: string) => {
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
            <button
              className={`glass-card-sm ${styles.monthButton} ${styles.monthButtonIcon}`}
              type="button"
              aria-label="前月"
              onClick={() => navigate(previousHref)}
            >
              <ChevronLeft size={16} aria-hidden="true" />
            </button>
            <button
              className={`glass-card-sm ${styles.monthButton} ${styles.monthButtonIcon}`}
              type="button"
              aria-label="翌月"
              onClick={() => navigate(nextHref)}
            >
              <ChevronRight size={16} aria-hidden="true" />
            </button>
            <button
              className={`glass-card-sm ${styles.monthButton}`}
              type="button"
              aria-label="今月へ移動"
              onClick={() => navigate(currentHref)}
            >
              今月
            </button>
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
