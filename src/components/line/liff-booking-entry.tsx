"use client"

import { History } from "lucide-react"
import Link from "next/link"
import { useEffect, useRef, useState, type ReactNode } from "react"
import { signIn } from "next-auth/react"

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
  initialRange?: { start: string; end: string }
}

type SessionPayload = {
  user?: {
    id?: string
  } | null
}

const LIFF_ID = process.env.NEXT_PUBLIC_LINE_LIFF_ID ?? ""

export function shouldStartLineProviderSignIn({
  authStarted,
  hpSessionLoaded,
  inClient,
  liffReady,
  userId,
}: {
  authStarted: boolean
  hpSessionLoaded: boolean
  inClient: boolean
  liffReady: boolean
  userId?: string
}) {
  return liffReady && inClient && hpSessionLoaded && !userId && !authStarted
}

export function LiffBookingEntry({
  monthSkeleton,
  isCalendarAdmin,
  initialSession,
  initialBusy = [],
  initialBookings = [],
  initialRange,
}: LiffBookingEntryProps) {
  const [state, setState] = useState<LiffState>(
    LIFF_ID ? { status: "loading" } : { status: "skipped", reason: "missing_liff_id" },
  )
  const [hpSession, setHpSession] = useState<SessionPayload | null>(null)
  const [hpSessionLoaded, setHpSessionLoaded] = useState(false)
  const authStartedRef = useRef(false)

  useEffect(() => {
    if (!LIFF_ID) return

    let cancelled = false

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
      }
    }

    void initializeLiff()

    return () => {
      cancelled = true
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
        inClient: state.status === "ready" && state.inClient,
        liffReady: state.status === "ready",
        userId: hpSession?.user?.id,
      })
    ) {
      authStartedRef.current = true
      void signIn("line", { callbackUrl: "/line/booking" })
    }
  }, [hpSession?.user?.id, hpSessionLoaded, state])

  return (
    <section className="mx-auto w-full max-w-[1440px] px-4 py-12 md:px-8 md:py-16 xl:px-12">
      <div className="glass-card p-8 md:p-10 xl:p-14">
        <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-hp-muted">LINE LIFF</p>
            <h1 className="mt-2 text-4xl font-bold text-hp md:text-5xl xl:text-6xl">
              予約カレンダー
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
            <span>予約履歴</span>
          </Link>
        </div>

        {state.status === "loading" ? (
          <div className="glass-inset mb-6 p-4 text-sm text-hp-muted" role="status">
            LINE 連携を確認しています
          </div>
        ) : null}
        {state.status === "skipped" ? (
          <div className="glass-inset mb-6 p-4 text-sm text-hp-muted" role="status">
            LINE LIFF ID が未設定のため、ローカル確認用の表示で開いています。
          </div>
        ) : null}
        {state.status === "ready" && !state.inClient ? (
          <div className="glass-inset mb-6 p-4 text-sm text-hp-muted" role="status">
            LINE アプリ外の確認表示です。通常ログイン画面へ自動遷移せず、この画面で表示を確認できます。
          </div>
        ) : null}
        {state.status === "error" ? (
          <div className="glass-inset mb-6 p-4 text-sm text-hp-muted" role="status">
            LINE 連携を確認できませんでした。予約カレンダーは通常表示で続行できます。
          </div>
        ) : null}
        <BookingClientShell
          callbackUrl="/line/booking"
          entryPoint="line_liff"
          isCalendarAdmin={isCalendarAdmin}
          initialSession={initialSession}
          initialBusy={initialBusy}
          initialBookings={initialBookings}
          initialRange={initialRange}
          lineUserId={state.status === "ready" ? state.profile?.userId : undefined}
          monthSkeleton={monthSkeleton}
          redirectUnauthenticated={false}
        />
      </div>
    </section>
  )
}
