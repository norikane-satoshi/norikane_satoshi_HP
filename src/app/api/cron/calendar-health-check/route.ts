import { NextRequest, NextResponse } from "next/server"

import { getCachedCalendarAccessToken } from "@/lib/booking/server/calendar-free-busy/google-token-cache"
import { getResendClient } from "@/lib/booking/server/email"
import {
  CALENDAR_TOKEN_USER_ID,
  CalendarOAuthEnvMissingError,
  CalendarTokenRevokedError,
} from "@/lib/google-calendar/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const RECONNECT_URL = "https://norikane.studio/api/calendar/auth"
const DEFAULT_FROM_EMAIL = "noreply@norikane.studio"

async function sendCalendarHealthAlert(args: {
  subject: string
  html: string
}): Promise<void> {
  const resend = getResendClient()
  const from = process.env.RESEND_FROM_EMAIL ?? DEFAULT_FROM_EMAIL
  const to = process.env.BOOKING_CALENDAR_ADMIN_EMAIL ?? process.env.RESEND_FROM_EMAIL
  if (!resend || !to) {
    console.warn(`[calendar-health-check] email_skipped subject=${args.subject}`)
    return
  }

  try {
    const { error } = await resend.emails.send({
      from,
      to,
      subject: args.subject,
      html: args.html,
    })
    if (error) {
      console.error("[calendar-health-check] email_failed", error)
    }
  } catch (error) {
    console.error("[calendar-health-check] email_failed", error)
  }
}

function alertHtml(lines: string[]): string {
  return lines.map((line) => `<p>${line}</p>`).join("")
}

async function notifyCalendarIssue(subject: string, lines: string[]): Promise<void> {
  await sendCalendarHealthAlert({
    subject,
    html: alertHtml(lines),
  })
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  const detectedAt = new Date().toISOString()

  try {
    await getCachedCalendarAccessToken(CALENDAR_TOKEN_USER_ID)
    return NextResponse.json({ ok: true, code: "ok" })
  } catch (error) {
    if (error instanceof CalendarTokenRevokedError) {
      await notifyCalendarIssue("[norikane.studio] Calendar OAuth refresh token revoked", [
        `${RECONNECT_URL} で再接続が必要です。`,
        `検出時刻 ISO: ${detectedAt}`,
        "次の自動チェックは翌 09:00 JST です。",
      ])
      return NextResponse.json({ ok: false, code: "calendar_token_revoked" }, { status: 200 })
    }

    if (error instanceof CalendarOAuthEnvMissingError) {
      await notifyCalendarIssue("[norikane.studio] Calendar OAuth env missing", [
        "Calendar OAuth env が不足しています。",
        `検出時刻 ISO: ${detectedAt}`,
        "次の自動チェックは翌 09:00 JST です。",
      ])
      return NextResponse.json({ ok: false, code: "calendar_oauth_env_missing" }, { status: 200 })
    }

    console.error("[calendar-health-check] unexpected", error)
    const message = error instanceof Error ? error.message : String(error)
    await notifyCalendarIssue("[norikane.studio] Calendar health check unexpected error", [
      "Calendar health check で未分類エラーを検出しました。",
      `検出時刻 ISO: ${detectedAt}`,
      `message: ${message}`,
      "次の自動チェックは翌 09:00 JST です。",
    ])
    return NextResponse.json({ ok: false, code: "unexpected", message }, { status: 200 })
  }
}
