import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"

import { auth } from "@/auth"
import { enforceBodyLimit } from "@/lib/api/server/body-limit"
import { respondInternalError } from "@/lib/api/server/error-response"
import { conversationRetentionDays } from "@/lib/chatbot/knowledge"
import { handleChatbotMessage } from "@/lib/chatbot/server/message-handler"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const sessionCookieName = "chatbot_session_id"
const sessionMaxAgeSeconds = conversationRetentionDays * 24 * 60 * 60

const chatbotMessageRequestSchema = z.object({
  message: z.string().trim().min(1).max(4000),
  conversationId: z.string().trim().min(1).optional(),
  editTargetMessageId: z.string().trim().min(1).optional(),
  clientUserMessageId: z.string().regex(/^client_msg_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/).optional(),
  clientSessionId: z.string().uuid().optional(),
  jobContext: z.record(z.string(), z.unknown()).optional(),
  conversationState: z.record(z.string(), z.unknown()).optional(),
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

  const parsed = chatbotMessageRequestSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "invalid_request",
        issues: parsed.error.issues,
      },
      { status: 400 },
    )
  }

  const session = await auth()
  const existingSessionId = request.cookies.get(sessionCookieName)?.value
  const sessionId = existingSessionId ?? parsed.data.clientSessionId ?? crypto.randomUUID()

  try {
    const result = await handleChatbotMessage({
      sessionId,
      userId: session?.user?.id,
      message: parsed.data.message,
      conversationId: parsed.data.conversationId,
      editTargetMessageId: parsed.data.editTargetMessageId,
      clientUserMessageId: parsed.data.clientUserMessageId,
      jobContext: parsed.data.jobContext,
      conversationState: parsed.data.conversationState,
    })
    const response = NextResponse.json(result)

    response.cookies.set(sessionCookieName, sessionId, {
      httpOnly: true,
      maxAge: sessionMaxAgeSeconds,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    })

    return response
  } catch (error) {
    return respondInternalError(error, "chatbot.message.POST")
  }
}
