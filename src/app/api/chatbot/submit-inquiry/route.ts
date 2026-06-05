import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"

import { enforceBodyLimit } from "@/lib/api/server/body-limit"
import { sendOperatorConsultationNotification } from "@/lib/chatbot/server/operator-notification"
import { appendMessage, loadConversationById } from "@/lib/chatbot/server/repository"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const inquiryRequestSchema = z.object({
  name: z.string().trim().max(80).optional().default(""),
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
  const customerName = input.name || undefined
  const conversation = await loadInquiryConversation(input.conversationId)
  await appendInquiryMessage(input)

  try {
    const result = await sendOperatorConsultationNotification({
      trigger: "inquiry-form",
      jobContext: conversation?.context.jobContext,
      conversationState: {
        ...conversation?.context.conversationState,
        hasContactEmail: true,
        hasCustomerIdentity: Boolean(customerName),
        contactEmail: input.email,
        customerName,
      },
      fallback: {
        customerName,
        contactEmail: input.email,
        jobKind: input.jobType,
        projectLength: input.duration,
        publicReleaseDate: input.desiredDeadline,
      },
      freeText: buildInquiryText(input),
    })

    if (result.status === "skipped") return NextResponse.json({ ok: true, emailSkipped: true })
    if (result.status === "failed") return NextResponse.json({ ok: true, emailWarning: "send_failed" })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("[Chatbot Inquiry] resend send failed", error instanceof Error ? error.message : "send_failed")
    return NextResponse.json({ ok: true, emailWarning: "send_failed" })
  }
}

async function loadInquiryConversation(conversationId: string | undefined) {
  if (!conversationId) return null

  try {
    return await loadConversationById(conversationId)
  } catch (error) {
    console.warn(
      "[Chatbot Inquiry] conversation load failed",
      error instanceof Error ? error.message : "load_failed",
    )
    return null
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
