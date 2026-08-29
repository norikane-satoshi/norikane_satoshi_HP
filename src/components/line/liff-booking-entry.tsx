"use client"

import { History } from "lucide-react"
import {useLocale} from "next-intl"
import { useEffect, useRef, useState, type ReactNode } from "react"
import { signIn } from "next-auth/react"
import {Link} from "@/i18n/navigation"

import { BookingClientShell } from "@/components/booking/booking-client-shell"
import type { CalendarBookingFromApi } from "@/lib/booking/server/calendar-free-busy/bookings-repository"
import type { CalendarBusyEventWithBuffer } from "@/lib/google-calendar/server"

type LiffProfile = {
  userId: string
  displayName: string
}

type LiffState =
  | { status: "skipped"; reason: "missing_liff_id" }
  | { status: "loading" }
  | { status: "ready"; profile: LiffProfile | null; inClient: boolean }
  | { status: "error" }

type LiffBookingEntryProps = {
  monthSkeleton: ReactNode
  isCalendarAdmin: boolean
  initialSession?: SessionPayload | null
  initialBusy?: CalendarBusyEventWithBuffer[]
  initialBookings?: CalendarBookingFromApi[]
  initialTentativeDateKeys?: string[]
  initialRange?: { start: string; end: string }
}

type SessionPayload = {
  user?: {
    id?: string
  } | null
}

const LIFF_ID = process.env.NEXT_PUBLIC_LINE_LIFF_ID ?? ""
const LIFF_INIT_TIMEOUT_MS = 8_000

export function shouldStartLineProviderSignIn({
  authStarted,
  hpSessionLoaded,
  lineCheckSettled,
  userId,
}: {
  authStarted: boolean
  hpSessionLoaded: boolean
  lineCheckSettled: boolean
  userId?: string
}) {
  return lineCheckSettled && hpSessionLoaded && !userId && !authStarted
}

export function LiffBookingEntry({
  monthSkeleton,
  isCalendarAdmin,
  initialSession,
  initialBusy = [],
  initialBookings = [],
  initialTentativeDateKeys = [],
  initialRange,
}: LiffBookingEntryProps) {
  const locale = useLocale() as "ja" | "en"
  const english = locale === "en"
  const [state, setState] = useState<LiffState>(
    LIFF_ID ? { status: "loading" } : { status: "skipped", reason: "missing_liff_id" },
  )
  const [hpSession, setHpSession] = useState<SessionPayload | null>(initialSession ?? null)
  const [hpSessionLoaded, setHpSessionLoaded] = useState(false)
  const authStartedRef = useRef(false)

  useEffect(() => {
    if (!LIFF_ID) return

    let cancelled = false
    const timeoutId = window.setTimeout(() => {
      if (!cancelled) setState({ status: "error" })
    }, LIFF_INIT_TIMEOUT_MS)

    async function initializeLiff() {
      try {
        const { default: liff } = await import("@line/liff")
        await liff.init({ liffId: LIFF_ID })
        const inClient = liff.isInClient()

        if (inClient && !liff.isLoggedIn()) {
          liff.login({ redirectUri: window.location.href })
          return
        }

        const profile = liff.isLoggedIn() ? await liff.getProfile() : null
        if (!cancelled) {
          setState({
            status: "ready",
            inClient,
            profile: profile
              ? {
                  userId: profile.userId,
                  displayName: profile.displayName,
                }
              : null,
          })
        }
      } catch {
        if (!cancelled) setState({ status: "error" })
      } finally {
        window.clearTimeout(timeoutId)
      }
    }

    void initializeLiff()

    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [])

  useEffect(() => {
    if (state.status === "loading") return

    let cancelled = false

    async function loadHpSession() {
      try {
        const response = await fetch("/api/auth/session", { cache: "no-store" })
        const payload = response.ok ? ((await response.json()) as SessionPayload) : null
        if (!cancelled) setHpSession(payload)
      } finally {
        if (!cancelled) setHpSessionLoaded(true)
      }
    }

    void loadHpSession()
    return () => {
      cancelled = true
    }
  }, [state.status])

  useEffect(() => {
    if (
      shouldStartLineProviderSignIn({
        authStarted: authStartedRef.current,
        hpSessionLoaded,
        lineCheckSettled: state.status === "ready" || state.status === "error",
        userId: hpSession?.user?.id,
      })
    ) {
      authStartedRef.current = true
      void signIn("line", { callbackUrl: `/${locale}/line/booking` })
    }
  }, [hpSession?.user?.id, hpSessionLoaded, locale, state])

  return (
    <section className="mx-auto w-full max-w-[1440px] px-4 py-12 md:px-8 md:py-16 xl:px-12">
      <div className="glass-card p-8 md:p-10 xl:p-14">
        <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1
              aria-label={english ? "LINE booking calendar" : "LINE予約カレンダー"}
              className="text-4xl font-bold text-hp md:text-5xl xl:text-6xl"
            >
              {english ? "Booking calendar" : "予約カレンダー"}
            </h1>
            {state.status === "ready" && state.profile ? (
              <p className="mt-3 text-sm text-hp-muted">
                LINE: {state.profile.displayName}
              </p>
            ) : null}
          </div>
          <Link
            href="/booking/history"
            className="glass-btn inline-flex min-h-11 items-center gap-2 px-4 py-3 text-sm font-semibold text-hp"
          >
            <History aria-hidden="true" size={18} />
            <span>{english ? "History" : "予約履歴"}</span>
          </Link>
        </div>

        {state.status === "loading" ? (
          <div className="glass-inset mb-6 p-4 text-sm text-hp-muted" role="status">
            {english ? "Checking the LINE connection" : "LINE 連携を確認しています"}
          </div>
        ) : null}
        {state.status === "skipped" ? (
          <div className="glass-inset mb-6 p-4 text-sm text-hp-muted" role="status">
            {english ? "No LINE LIFF ID is configured, so this page is running in local-preview mode." : "LINE LIFF ID が未設定のため、ローカル確認用の表示で開いています。"}
          </div>
        ) : null}
        {state.status === "error" ? (
          <div className="glass-inset mb-6 p-4 text-sm text-hp-muted" role="status">
            {english ? "The LINE connection could not be verified. You can continue with the standard booking calendar." : "LINE 連携を確認できませんでした。予約カレンダーは通常表示で続行できます。"}
          </div>
        ) : null}
        <BookingClientShell
          callbackUrl={`/${locale}/line/booking`}
          entryPoint="line_liff"
          isCalendarAdmin={isCalendarAdmin}
          initialSession={hpSession}
          initialBusy={initialBusy}
          initialBookings={initialBookings}
          initialTentativeDateKeys={initialTentativeDateKeys}
          initialRange={initialRange}
          lineUserId={state.status === "ready" ? state.profile?.userId : undefined}
          monthSkeleton={monthSkeleton}
          redirectUnauthenticated={false}
        />
      </div>
    </section>
  )
}
