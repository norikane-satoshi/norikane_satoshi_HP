"use client"

import { useEffect, useState, type ReactNode } from "react"

import { BookingSection } from "@/components/booking/booking-section"

type SessionPayload = {
  user?: {
    id?: string
    email?: string | null
  } | null
}

type BookingClientShellProps = {
  monthSkeleton: ReactNode
}

export function BookingClientShell({ monthSkeleton }: BookingClientShellProps) {
  const [session, setSession] = useState<SessionPayload | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
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
  }, [])

  const userId = session?.user?.id

  useEffect(() => {
    if (loaded && !userId) {
      window.location.href = "/login?callbackUrl=/booking"
    }
  }, [loaded, userId])

  if (!loaded) return monthSkeleton

  if (!userId) {
    return monthSkeleton
  }

  return (
    <BookingSection
      userId={userId}
      userEmail={session.user?.email ?? ""}
      monthSkeleton={monthSkeleton}
    />
  )
}
