import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"

import { auth } from "@/auth"
import { enforceBodyLimit } from "@/lib/api/server/body-limit"
import {
  buildChatbotMessageAuditEvents,
  buildChatbotOperationFailureAuditEvent,
} from "@/lib/chatbot/audit/server-evidence"
import {
  scheduleChatbotAuditPersistence,
  scheduleDeferredChatbotAuditPersistence,
} from "@/lib/chatbot/audit/scheduler"
import type { ChatbotConversation } from "@/lib/chatbot/domain"
import { logPrivacySafeChatbotEvent } from "@/lib/chatbot/server/boundary-event-log"
import { getChatbotBuildSha } from "@/lib/chatbot/server/build-info"
import { handleChatbotMessage } from "@/lib/chatbot/server/message-handler"
import {
  ChatbotMessageCoordinationError,
  appendChatbotMessageRequestUserMessage,
  assertChatbotMessageRequestOwnership,
  coordinateChatbotMessageRequest,
  finalizeChatbotMessageRequest,
  hashChatbotMessagePayload,
  recoverChatbotMessageRequestUserMessage,
  replaceChatbotMessageRequestUserMessage,
} from "@/lib/chatbot/server/message-request-coordinator"
import { respondChatbotOperationFailure } from "@/lib/chatbot/server/operation-failure"
import { persistChatbotMessageFinalization } from "@/lib/chatbot/server/repository"
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
  clientUserMessageId: z.string().regex(clientUserMessageIdPattern),
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
  const requestId = crypto.randomUUID()
  const requestStartedAt = Date.now()
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
    const coordinated = await coordinateChatbotMessageRequest({
      sessionId,
      userId: session?.user?.id,
      requestId,
      requestKey: parsed.data.clientUserMessageId,
      recoverRequestKey: parsed.data.recoverClientUserMessageId,
      payloadHash: hashChatbotMessagePayload({
        sessionId,
        userId: session?.user?.id ?? null,
        message: parsed.data.message,
        editTargetMessageId: parsed.data.editTargetMessageId ?? null,
        jobContext: parsed.data.jobContext ?? null,
        conversationState: parsed.data.conversationState ?? null,
      }),
      completeDuringExecute: true,
      execute: (ownership) => handleChatbotMessage(
        {
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
        },
        {
          deferSlackNotification: true,
          ...(ownership
          ? {
              assertRequestOwnership: () => assertChatbotMessageRequestOwnership(ownership),
              appendOwnedUserMessage: ({ content }) => appendChatbotMessageRequestUserMessage({
                ownership,
                content,
              }),
              recoverPendingUserMessage: ({ content }) => recoverChatbotMessageRequestUserMessage({
                ownership,
                content,
              }),
              replaceEditedUserMessage: ({ targetMessageId, content }) =>
                replaceChatbotMessageRequestUserMessage({
                  ownership,
                  targetMessageId,
                  content,
                }),
              finalizeMessage: (finalization) => finalizeChatbotMessageRequest({
                ownership,
                resultJson: JSON.stringify({
                  requestId: ownership.owner,
                  result: finalization.replayResult,
                }),
                persistBusinessData: (transaction) => persistChatbotMessageFinalization(
                  transaction,
                  finalization,
                ),
              }),
            }
          : {}),
        },
      ),
    })
    const result = coordinated.result
    const responseRequestId = coordinated.requestId
    const { auditEvidence, ...publicResult } = result
    if (!coordinated.replayed && !auditEvidence) {
      throw new Error("chatbot_message_audit_evidence_missing")
    }
    const auditCreatedAt = new Date().toISOString()
    const buildAuditEvents = (slack: Awaited<NonNullable<typeof auditEvidence>["slack"]>) =>
      buildChatbotMessageAuditEvents({
        requestId: responseRequestId,
        conversationId: result.conversationId,
        buildSha: getChatbotBuildSha(),
        createdAt: auditCreatedAt,
        finalTier: result.tier,
        uiKind: result.ui.kind,
        ...auditEvidence!,
        slack,
      })
    const pendingSlack = auditEvidence?.slack instanceof Promise ? auditEvidence.slack : undefined
    // A threaded Slack post finishes after the response; its audit events are written once it has.
    const auditEvents = coordinated.replayed || pendingSlack
      ? []
      : buildAuditEvents(auditEvidence!.slack as Awaited<NonNullable<typeof auditEvidence>["slack"]>)
    if (pendingSlack) scheduleDeferredChatbotAuditPersistence(async () => buildAuditEvents(await pendingSlack))
    else if (!coordinated.replayed) scheduleChatbotAuditPersistence(auditEvents)
    const response = NextResponse.json({
      ...publicResult,
      requestId: responseRequestId,
      clientBuildId: process.env.NEXT_PUBLIC_CHATBOT_BUILD_ID ?? "local",
      ...(isLoopbackHostname(request.nextUrl.hostname)
        ? {
            auditDebug: {
              schemaVersion: "1",
              persistenceStatus: coordinated.replayed ? "complete" : pendingSlack ? "deferred" : "scheduled",
              eventCount: auditEvents.length,
              stageTimings: auditEvidence?.stageTimings ?? {},
            },
            requestReplay: coordinated.replayed,
          }
        : {}),
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
    const failureStage = classifyMessageFailureStage(error)
    const failureConversation = await notifySlackMessageFailure({
      requestId,
      conversationId: parsed.data.conversationId,
      sessionId,
      stage: failureStage,
    })
    const auditConversationId = failureConversation?.id ?? parsed.data.conversationId
    if (auditConversationId) {
      scheduleChatbotAuditPersistence([buildChatbotOperationFailureAuditEvent({
        requestId,
        conversationId: auditConversationId,
        buildSha: getChatbotBuildSha(),
        createdAt: new Date().toISOString(),
        errorCode: `message-${failureStage}-failed`,
        durationMs: Date.now() - requestStartedAt,
      })])
    }
    return respondChatbotOperationFailure({
      operation: "message",
      requestId,
      stage: failureStage,
      error,
      status: error instanceof ChatbotMessageCoordinationError ? error.status : undefined,
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

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase().replace(/^\[(.*)\]$/, "$1")
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1"
}

async function notifySlackMessageFailure(input: {
  requestId: string
  conversationId?: string
  sessionId: string
  stage: ReturnType<typeof classifyMessageFailureStage>
}): Promise<ChatbotConversation | null> {
  let conversation: ChatbotConversation | null = null
  try {
    conversation = await loadFailureNotificationConversation({
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
    logPrivacySafeChatbotEvent({
      event: "chatbot_slack_notification_failed",
      errorKind: error instanceof Error ? error.name : typeof error,
    })
  }
  return conversation
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
      logPrivacySafeChatbotEvent({
        event: "chatbot_slack_conversation_load_failed",
        errorKind: error instanceof Error ? error.name : typeof error,
      })
    }
  }

  try {
    return await loadConversationBySessionId(input.sessionId)
  } catch (error) {
    logPrivacySafeChatbotEvent({
      event: "chatbot_slack_conversation_load_failed",
      errorKind: error instanceof Error ? error.name : typeof error,
    })
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
    if (error.stack?.includes("truncateConversationFromMessage")) return "conversation-save"
  }
  return "server-handler"
}
