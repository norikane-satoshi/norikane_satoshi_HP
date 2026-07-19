import crypto from "node:crypto"
import { NextResponse, type NextRequest } from "next/server"

import {
  getLineBookingLiffUrl,
  getLineMessagingChannelAccessToken,
  getLineWebhookChannelSecret,
} from "@/lib/line/env"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type LineWebhookEvent = {
  type?: string
  replyToken?: string
}

type LineWebhookPayload = {
  events?: LineWebhookEvent[]
}

function verifyLineSignature(body: string, signature: string | null, secret: string): boolean {
  if (!signature || !secret) return false
  const expected = crypto
    .createHmac("sha256", secret)
    .update(body)
    .digest("base64")
  const signatureBuffer = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expected)
  return signatureBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
}

function shouldReplyWithBookingLink(event: LineWebhookEvent): event is LineWebhookEvent & { replyToken: string } {
  return Boolean(
    event.replyToken &&
      event.replyToken !== "00000000000000000000000000000000" &&
      event.type === "follow",
  )
}

async function replyWithBookingLink(replyToken: string): Promise<void> {
  const accessToken = getLineMessagingChannelAccessToken()
  if (!accessToken) return

  const response = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      replyToken,
      messages: [
        {
          type: "text",
          text: `予約カレンダーはこちらです。\n${getLineBookingLiffUrl()}`,
        },
      ],
    }),
  })

  if (!response.ok) {
    console.warn("LINE reply failed", { status: response.status })
  }
}

export async function GET() {
  return NextResponse.json({ ok: true })
}

export async function POST(request: NextRequest) {
  const secret = getLineWebhookChannelSecret()
  if (!secret) {
    return NextResponse.json({ error: "line_webhook_secret_missing" }, { status: 503 })
  }

  const body = await request.text()
  const signature = request.headers.get("x-line-signature")
  if (!verifyLineSignature(body, signature, secret)) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 })
  }

  let payload: LineWebhookPayload
  try {
    payload = JSON.parse(body) as LineWebhookPayload
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  }

  const events = Array.isArray(payload.events) ? payload.events : []
  await Promise.all(events.filter(shouldReplyWithBookingLink).map((event) => replyWithBookingLink(event.replyToken)))

  return NextResponse.json({ ok: true, eventCount: events.length })
}
