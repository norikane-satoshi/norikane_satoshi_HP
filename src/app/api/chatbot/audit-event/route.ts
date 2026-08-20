import { NextResponse, type NextRequest } from "next/server"

import { enforceBodyLimit } from "@/lib/api/server/body-limit"
import { chatbotBrowserAuditEventSchema } from "@/lib/chatbot/audit/contract"
import { toStoredChatbotAuditEvent } from "@/lib/chatbot/audit/server-projection"
import {
  isChatbotConversationOwnedBySession,
  recordChatbotAuditEvent,
} from "@/lib/chatbot/audit/store"
import { getChatbotBuildSha } from "@/lib/chatbot/server/build-info"
import { loadConversationById } from "@/lib/chatbot/server/repository"
import { rateLimited, rateLimitIdentifier } from "@/lib/rate-limit/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const sessionCookieName = "chatbot_session_id"

export async function POST(request: NextRequest) {
  const bodyLimit = enforceBodyLimit(request)
  if (bodyLimit) return bodyLimit

  const cookieSessionId = request.cookies.get(sessionCookieName)?.value
  if (!cookieSessionId) {
    return NextResponse.json({ error: "missing_chatbot_session" }, { status: 401 })
  }

  const rateLimit = await rateLimited(
    "chatbotAuditSession",
    rateLimitIdentifier(cookieSessionId),
    "too many chatbot audit events",
  )
  if (rateLimit.limited) return rateLimit.response

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  }

  const parsed = chatbotBrowserAuditEventSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", issues: parsed.error.issues }, { status: 400 })
  }

  const conversation = await loadConversationById(parsed.data.conversationId)
  if (!conversation) {
    return NextResponse.json({ error: "conversation_not_found" }, { status: 404 })
  }
  if (!isChatbotConversationOwnedBySession({
    conversationSessionId: conversation.context.sessionId,
    cookieSessionId,
  })) {
    return NextResponse.json({ error: "conversation_not_owned" }, { status: 403 })
  }

  const storedEvent = toStoredChatbotAuditEvent(parsed.data, {
    buildSha: getChatbotBuildSha(),
    createdAt: new Date().toISOString(),
  })
  const result = await recordChatbotAuditEvent(storedEvent)

  return NextResponse.json(
    { accepted: true, duplicate: result.status === "duplicate" },
    { status: 202, headers: rateLimit.headers },
  )
}
