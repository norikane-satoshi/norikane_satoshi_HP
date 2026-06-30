"use client"

import { useEffect, useState, type ReactNode } from "react"
import { ExternalLink, MessageCircle } from "lucide-react"

import { BookingClientShell } from "@/components/booking/booking-client-shell"

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
}

const LINE_OFFICIAL_ACCOUNT_URL = "https://line.me/R/ti/p/@044ucnym"
const LIFF_ID = process.env.NEXT_PUBLIC_LINE_LIFF_ID ?? ""

export function LiffBookingEntry({ monthSkeleton, isCalendarAdmin }: LiffBookingEntryProps) {
  const [state, setState] = useState<LiffState>(
    LIFF_ID ? { status: "loading" } : { status: "skipped", reason: "missing_liff_id" },
  )

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

  const openFriendAdd = async () => {
    try {
      const { default: liff } = await import("@line/liff")
      if (liff.isInClient() && liff.isApiAvailable("requestFriendship")) {
        await liff.requestFriendship()
        return
      }
      if (liff.isInClient()) {
        liff.openWindow({ url: LINE_OFFICIAL_ACCOUNT_URL, external: false })
        return
      }
    } catch {
      // Fall through to normal browser navigation.
    }
    window.location.href = LINE_OFFICIAL_ACCOUNT_URL
  }

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
          <button
            type="button"
            className="glass-btn inline-flex min-h-11 items-center gap-2 px-4 py-3 text-sm font-semibold text-hp"
            onClick={() => void openFriendAdd()}
          >
            <MessageCircle aria-hidden="true" size={18} />
            <span>友だち追加</span>
            <ExternalLink aria-hidden="true" size={16} />
          </button>
        </div>

        {state.status === "loading" ? (
          <div className="glass-inset mb-6 p-4 text-sm text-hp-muted" role="status">
            LINE 連携を確認しています
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
          monthSkeleton={monthSkeleton}
        />
      </div>
    </section>
  )
}
