import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"

import { auth } from "@/auth"
import { enforceBodyLimit } from "@/lib/api/server/body-limit"
import { respondInternalError } from "@/lib/api/server/error-response"
import { handleChatbotMessage } from "@/lib/chatbot/server/message-handler"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const sessionCookieName = "chatbot_session_id"

const chatbotMessageRequestSchema = z.object({
  message: z.string().trim().min(1).max(4000),
  conversationId: z.string().trim().min(1).optional(),
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
  const sessionId = existingSessionId ?? crypto.randomUUID()

  try {
    const result = await handleChatbotMessage({
      sessionId,
      userId: session?.user?.id,
      message: parsed.data.message,
      conversationId: parsed.data.conversationId,
      jobContext: parsed.data.jobContext,
      conversationState: parsed.data.conversationState,
    })
    const response = NextResponse.json(result)

    if (!existingSessionId) {
      response.cookies.set(sessionCookieName, sessionId, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
      })
    }

    return response
  } catch (error) {
    return respondInternalError(error, "chatbot.message.POST")
  }
}
