import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { auth } from "@/auth"
import { isChatbotConversationOwnedBySession } from "@/lib/chatbot/audit/store"
import { loadConversationById } from "@/lib/chatbot/server/repository"
import { recoverHistoricalChoiceAnswer } from "@/lib/chatbot/server/message-handler"
import { loadLatestChatbotKnowledgeSnapshot } from "@/lib/chatbot/server/notion-knowledge-sync"
import { respondInternalError } from "@/lib/api/server/error-response"

export const runtime = "nodejs"
const schema = z.object({ conversationId: z.string().min(1).max(200), messageId: z.string().min(1).max(200) })
export async function POST(request: NextRequest) {
  const cookieSessionId = request.cookies.get("chatbot_session_id")?.value
  if (!cookieSessionId) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  try {
    const conversation = await loadConversationById(parsed.data.conversationId)
    if (!conversation) return NextResponse.json({ error: "not_found" }, { status: 404 })
    const session = await auth()
    if (!isChatbotConversationOwnedBySession({ conversationSessionId: conversation.context.sessionId, cookieSessionId }) ||
        (conversation.context.userId && conversation.context.userId !== session?.user?.id)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }
    const snapshot = await loadLatestChatbotKnowledgeSnapshot()
    return NextResponse.json({ choiceAnswer: recoverHistoricalChoiceAnswer(conversation, parsed.data.messageId, snapshot) ?? null }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) { return respondInternalError(error, "chatbot.edit-choice.POST") }
}
