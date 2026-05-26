import { NextResponse, type NextRequest } from "next/server"
import { Resend } from "resend"
import { z } from "zod"

import { enforceBodyLimit } from "@/lib/api/server/body-limit"
import { getBookingCalendarAdminEmail } from "@/lib/auth/server/is-admin"
import { appendMessage } from "@/lib/chatbot/server/repository"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const inquirySubjectPrefix = "[LLM 障害時フォーム]"

const inquiryRequestSchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.string().trim().email().max(254),
  jobType: z.string().trim().max(120).optional().default(""),
  duration: z.string().trim().max(120).optional().default(""),
  desiredDeadline: z.string().trim().max(120).optional().default(""),
  freeText: z.string().trim().max(4000).optional().default(""),
  conversationId: z.string().trim().min(1).optional(),
})

export async function POST(request: NextRequest) {
  const bodyLimit = enforceBodyLimit(request)
  if (bodyLimit) return bodyLimit

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  }

  const parsed = inquiryRequestSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "invalid_request",
        issues: parsed.error.issues,
      },
      { status: 400 },
    )
  }

  const input = parsed.data
  await appendInquiryMessage(input)

  if (!process.env.RESEND_API_KEY) {
    console.warn("[Chatbot Inquiry] RESEND_API_KEY not set, skipping send")
    return NextResponse.json({ ok: true, emailSkipped: true })
  }

  try {
    const resend = new Resend(process.env.RESEND_API_KEY)
    const subject = `${inquirySubjectPrefix} ${input.name} 様より`
    await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL ?? "noreply@norikane.studio",
      to: getBookingCalendarAdminEmail() || "norikane.satoshi@gmail.com",
      replyTo: input.email,
      subject,
      text: buildInquiryText(input),
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("[Chatbot Inquiry] resend send failed", error instanceof Error ? error.message : "send_failed")
    return NextResponse.json({ ok: true, emailWarning: "send_failed" })
  }
}

function buildInquiryText(input: z.infer<typeof inquiryRequestSchema>): string {
  return [
    `氏名: ${input.name}`,
    `メール: ${input.email}`,
    `案件種別: ${input.jobType || "-"}`,
    `尺: ${input.duration || "-"}`,
    `希望納期: ${input.desiredDeadline || "-"}`,
    "",
    input.freeText || "-",
  ].join("\n")
}

async function appendInquiryMessage(input: z.infer<typeof inquiryRequestSchema>): Promise<void> {
  if (!input.conversationId) return

  try {
    await appendMessage({
      conversationId: input.conversationId,
      role: "system",
      content: `問い合わせフォーム送信: ${input.name} / ${input.email}`,
    })
  } catch (error) {
    console.warn(
      "[Chatbot Inquiry] conversation message save failed",
      error instanceof Error ? error.message : "save_failed",
    )
  }
}
