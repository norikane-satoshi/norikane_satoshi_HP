import { NextRequest, NextResponse } from "next/server"
import { Resend } from "resend"
import { z } from "zod"
import { enforceBodyLimit } from "@/lib/api/server/body-limit"
import { getBookingCalendarAdminEmail } from "@/lib/auth/server/is-admin"
import { limitByIp } from "@/lib/rate-limit/server"
import { getClientIp } from "@/lib/security/server/client-ip"

const contactSchema = z.object({
  name: z.string().min(1, "名前は必須です").max(80, "名前は80文字以内で入力してください"),
  email: z.string().email("有効なメールアドレスを入力してください").max(254, "メールアドレスは254文字以内で入力してください"),
  body: z.string().min(10, "お問い合わせ内容は10文字以上で入力してください").max(4000, "お問い合わせ内容は4000文字以内で入力してください"),
  website: z.string().max(200, "websiteは200文字以内で入力してください").optional(),
})

export async function POST(request: NextRequest) {
  const bodyLimit = enforceBodyLimit(request)
  if (bodyLimit) return bodyLimit

  const limit = await limitByIp(
    "contactIp",
    request,
    "送信回数の上限に達しました。5分後にお試しください。",
  )
  if (limit.limited) {
    return limit.response
  }

  let data: unknown
  try {
    data = await request.json()
  } catch {
    return NextResponse.json({ error: "不正なリクエストです" }, { status: 400 })
  }

  const result = contactSchema.safeParse(data)
  if (!result.success) {
    const firstError = result.error.issues[0]?.message || "入力内容を確認してください"
    return NextResponse.json({ error: firstError }, { status: 400 })
  }

  const { name, email, body, website } = result.data

  // Honeypot: if website field is filled, silently accept (bot)
  if (website) {
    return NextResponse.json({ ok: true })
  }

  // Phase 1: log to console. Email notification will be added later.
  console.log("[Contact Form Submission]", {
    name,
    email,
    body: body.substring(0, 200),
    ip: getClientIp(request),
    timestamp: new Date().toISOString(),
  })

  if (!process.env.RESEND_API_KEY) {
    console.warn("[Contact] RESEND_API_KEY not set, skipping send")
  } else {
    try {
      const resend = new Resend(process.env.RESEND_API_KEY)
      await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL ?? "noreply@norikane.studio",
        to: getBookingCalendarAdminEmail() || "norikane.satoshi@gmail.com",
        replyTo: email,
        subject: `[HP お問い合わせ] ${name} 様より`,
        text: `差出人: ${name}\nメール: ${email}\nIP: ${getClientIp(request)}\n受付: ${new Date().toISOString()}\n\n${body}`,
      })
    } catch (err) {
      console.error("[Contact] resend send failed", err)
    }
  }

  return NextResponse.json({ ok: true })
}
