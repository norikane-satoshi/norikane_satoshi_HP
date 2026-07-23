import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"

import { auth } from "@/auth"
import { enforceBodyLimit } from "@/lib/api/server/body-limit"
import type { ChatbotConversation } from "@/lib/chatbot/domain"
import { handleChatbotMessage } from "@/lib/chatbot/server/message-handler"
import { respondChatbotOperationFailure } from "@/lib/chatbot/server/operation-failure"
import {
  loadConversationById,
  loadConversationBySessionId,
  updateConversationSlackThreadTs,
} from "@/lib/chatbot/server"
import { sendChatbotSlackNotification } from "@/lib/chatbot/server/slack-notifier"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120

const sessionCookieName = "chatbot_session_id"
const sessionMaxAgeSeconds = 7 * 24 * 60 * 60
const clientUserMessageIdPattern =
  /^client_msg_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

const chatbotMessageRequestSchema = z.object({
  message: z.string().trim().min(1).max(4000),
  conversationId: z.string().trim().min(1).optional(),
  editTargetMessageId: z.string().trim().min(1).optional(),
  clientUserMessageId: z.string().regex(clientUserMessageIdPattern).optional(),
  recoverClientUserMessageId: z.string().regex(clientUserMessageIdPattern).optional(),
  pendingRequestKind: z.enum(["message", "edit"]).optional(),
  clientSessionId: z.string().uuid().optional(),
  jobContext: z.record(z.string(), z.unknown()).optional(),
  conversationState: z.record(z.string(), z.unknown()).optional(),
})

type ChatbotFailureTaggedError = Error & {
  chatbotFailureStage?: "conversation-save"
  chatbotFailureSummary?: Record<string, unknown>
}

export async function POST(request: NextRequest) {
  const requestStartedAtEpochMs = Date.now()
  const requestStartedAtMonotonicMs = performance.now()
  const requestId = crypto.randomUUID()
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
  const sessionId = parsed.data.clientSessionId ?? existingSessionId ?? crypto.randomUUID()
  const userAgent = request.headers.get("user-agent") ?? undefined

  try {
    const result = await handleChatbotMessage({
      requestId,
      sessionId,
      userAgent,
      userId: session?.user?.id,
      message: parsed.data.message,
      conversationId: parsed.data.conversationId,
      editTargetMessageId: parsed.data.editTargetMessageId,
      clientUserMessageId: parsed.data.clientUserMessageId,
      recoverClientUserMessageId: parsed.data.recoverClientUserMessageId,
      pendingRequestKind: parsed.data.pendingRequestKind,
      jobContext: parsed.data.jobContext,
      conversationState: parsed.data.conversationState,
      latencyTrace: {
        requestStartedAtEpochMs,
        requestStartedAtMonotonicMs,
      },
    })
    const response = NextResponse.json({
      ...result,
      clientBuildId: process.env.NEXT_PUBLIC_CHATBOT_BUILD_ID ?? "local",
    })

    if (existingSessionId !== sessionId) {
      response.cookies.set(sessionCookieName, sessionId, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: sessionMaxAgeSeconds,
      })
    }

    return response
  } catch (error) {
    const taggedError = error instanceof Error ? (error as ChatbotFailureTaggedError) : undefined
    await notifySlackMessageFailure({
      requestId,
      conversationId: parsed.data.conversationId,
      sessionId,
      stage: classifyMessageFailureStage(error),
    })
    return respondChatbotOperationFailure({
      operation: "message",
      requestId,
      stage: classifyMessageFailureStage(error),
      error,
      requestSummary: {
        requestId,
        conversationId: parsed.data.conversationId,
        clientSessionId: parsed.data.clientSessionId,
        userAgent,
        hasEditTargetMessageId: Boolean(parsed.data.editTargetMessageId),
        editTargetMessageIdKind: classifyMessageIdKind(parsed.data.editTargetMessageId),
        hasRecoverClientUserMessageId: Boolean(parsed.data.recoverClientUserMessageId),
        pendingRequestKind: parsed.data.pendingRequestKind,
        hasCookieSession: Boolean(existingSessionId),
        messageLength: parsed.data.message.length,
        isChoicePanelSelection: parsed.data.message.startsWith("選択:"),
        hasJobContext: Boolean(parsed.data.jobContext),
        hasConversationState: Boolean(parsed.data.conversationState),
        ...(taggedError?.chatbotFailureSummary ?? {}),
      },
    })
  }
}

async function notifySlackMessageFailure(input: {
  requestId: string
  conversationId?: string
  sessionId: string
  stage: ReturnType<typeof classifyMessageFailureStage>
}): Promise<void> {
  try {
    const conversation = await loadFailureNotificationConversation({
      conversationId: input.conversationId,
      sessionId: input.sessionId,
    })
    const threadTs = conversation?.context.slackThreadTs
    const result = await sendChatbotSlackNotification({
      kind: "issue",
      requestId: input.requestId,
      conversationId: conversation?.id ?? input.conversationId ?? "unpersisted",
      sessionId: conversation?.context.sessionId ?? input.sessionId,
      threadTs,
      issueReasons: [`message-${input.stage}`],
    })
    if (!threadTs && conversation?.id && result.status === "sent" && result.ts) {
      await updateConversationSlackThreadTs({
        conversationId: conversation.id,
        slackThreadTs: result.ts,
      })
    }
  } catch (error) {
    console.warn("[chatbot slack notification failed]", error instanceof Error ? error.message : String(error))
  }
}

async function loadFailureNotificationConversation(input: {
  conversationId?: string
  sessionId: string
}): Promise<ChatbotConversation | null> {
  if (input.conversationId) {
    try {
      const conversation = await loadConversationById(input.conversationId)
      if (conversation) return conversation
    } catch (error) {
      console.warn("[chatbot slack notification conversation load failed]", error instanceof Error ? error.message : String(error))
    }
  }

  try {
    return await loadConversationBySessionId(input.sessionId)
  } catch (error) {
    console.warn("[chatbot slack notification conversation load failed]", error instanceof Error ? error.message : String(error))
    return null
  }
}

function classifyMessageIdKind(messageId: string | undefined): "none" | "client" | "server" {
  if (!messageId) return "none"
  return clientUserMessageIdPattern.test(messageId) ? "client" : "server"
}

function classifyMessageFailureStage(error: unknown) {
  if (error instanceof Error) {
    const taggedError = error as ChatbotFailureTaggedError
    if (taggedError.chatbotFailureStage) return taggedError.chatbotFailureStage
    if (error.message.includes("Invalid chatbot active choices JSON")) return "conversation-load"
    if (error.message.includes("Invalid chatbot conversation state JSON")) return "conversation-load"
    if (error.stack?.includes("updateConversationRouting")) return "conversation-save"
    if (error.stack?.includes("appendMessage")) return "conversation-save"
  }
  return "server-handler"
}
