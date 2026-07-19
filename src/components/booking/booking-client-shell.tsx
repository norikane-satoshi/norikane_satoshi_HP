"use client"

import { useEffect, useState, type ReactNode } from "react"

import { BookingSection } from "@/components/booking/booking-section"
import type { CalendarBookingFromApi } from "@/lib/booking/server/calendar-free-busy/bookings-repository"
import type { CalendarBusyEventWithBuffer } from "@/lib/google-calendar/server"

type SessionPayload = {
  user?: {
    id?: string
    email?: string | null
  } | null
}

type BookingClientShellProps = {
  monthSkeleton: ReactNode
  isCalendarAdmin: boolean
  initialSession?: SessionPayload | null
  initialBusy?: CalendarBusyEventWithBuffer[]
  initialBookings?: CalendarBookingFromApi[]
  initialTentativeDateKeys?: string[]
  initialRange?: { start: string; end: string }
  callbackUrl?: string
  entryPoint?: "web" | "line_liff"
  lineUserId?: string
  redirectUnauthenticated?: boolean
}

export function shouldRedirectUnauthenticated(loaded: boolean, userId: string | undefined, redirectUnauthenticated: boolean) {
  return loaded && !userId && redirectUnauthenticated
}

export function BookingClientShell({
  monthSkeleton,
  isCalendarAdmin,
  initialSession,
  initialBusy = [],
  initialBookings = [],
  initialTentativeDateKeys = [],
  initialRange,
  callbackUrl = "/booking",
  entryPoint = "web",
  lineUserId,
  redirectUnauthenticated = true,
}: BookingClientShellProps) {
  const [session, setSession] = useState<SessionPayload | null>(initialSession ?? null)
  const [loaded, setLoaded] = useState(initialSession !== undefined)

  useEffect(() => {
    if (initialSession !== undefined) return
    let cancelled = false
    async function loadSession() {
      try {
        const response = await fetch("/api/auth/session", { cache: "no-store" })
        const payload = response.ok ? ((await response.json()) as SessionPayload) : null
        if (cancelled) return
        setSession(payload)
      } finally {
        if (!cancelled) setLoaded(true)
      }
    }

    void loadSession()
    return () => {
      cancelled = true
    }
  }, [initialSession])

  const userId = session?.user?.id

  useEffect(() => {
    if (shouldRedirectUnauthenticated(loaded, userId, redirectUnauthenticated)) {
      window.location.href = `/login?callbackUrl=${encodeURIComponent(callbackUrl)}`
    }
  }, [callbackUrl, loaded, redirectUnauthenticated, userId])

  if (!loaded) return monthSkeleton

  if (!userId) {
    return monthSkeleton
  }

  return (
    <BookingSection
      userId={userId}
      userEmail={session.user?.email ?? ""}
      isCalendarAdmin={isCalendarAdmin}
      entryPoint={entryPoint}
      lineUserId={lineUserId}
      initialBusy={initialBusy}
      initialBookings={initialBookings}
      initialTentativeDateKeys={initialTentativeDateKeys}
      initialRange={initialRange}
      monthSkeleton={monthSkeleton}
    />
  )
}
