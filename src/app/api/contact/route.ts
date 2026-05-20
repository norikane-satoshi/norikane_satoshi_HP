import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { limitByIp } from "@/lib/rate-limit/server"
import { getClientIp } from "@/lib/security/server/client-ip"

const contactSchema = z.object({
  name: z.string().min(1, "名前は必須です"),
  email: z.string().email("有効なメールアドレスを入力してください"),
  body: z.string().min(10, "お問い合わせ内容は10文字以上で入力してください"),
  website: z.string().optional(),
})

export async function POST(request: NextRequest) {
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

  return NextResponse.json({ ok: true })
}
