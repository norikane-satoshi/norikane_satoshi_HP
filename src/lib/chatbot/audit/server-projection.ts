import { createHash } from "node:crypto"

import {
  chatbotStoredAuditEventSchema,
  type ChatbotBrowserAuditEvent,
  type ChatbotServerAuditEvent,
  type ChatbotStoredAuditEvent,
} from "@/lib/chatbot/audit/contract"

const conversationHashDomain = "norikane-hp-chatbot-conversation-v1"

export function hashChatbotConversationId(conversationId: string): string {
  return createHash("sha256")
    .update(conversationHashDomain)
    .update("\0")
    .update(conversationId)
    .digest("hex")
}

export function toStoredChatbotAuditEvent(
  event: ChatbotBrowserAuditEvent,
  metadata: { buildSha: string; createdAt: string },
): ChatbotStoredAuditEvent {
  const { conversationId, ...safeEvent } = event
  return chatbotStoredAuditEventSchema.parse({
    ...safeEvent,
    source: "browser",
    sequence: chatbotAuditEventSequence(event),
    conversationHash: hashChatbotConversationId(conversationId),
    buildSha: metadata.buildSha,
    createdAt: metadata.createdAt,
  })
}

export function toStoredChatbotServerAuditEvent(
  event: ChatbotServerAuditEvent,
  metadata: {
    buildSha: string
    createdAt: string
    source: "server" | "hosted-worker"
  },
): ChatbotStoredAuditEvent {
  const { conversationId, ...safeEvent } = event
  return chatbotStoredAuditEventSchema.parse({
    ...safeEvent,
    source: metadata.source,
    sequence: chatbotAuditEventSequence(event),
    conversationHash: hashChatbotConversationId(conversationId),
    buildSha: metadata.buildSha,
    createdAt: metadata.createdAt,
  })
}

export function chatbotAuditEventSequence(
  event: Pick<ChatbotBrowserAuditEvent | ChatbotServerAuditEvent, "eventName"> & {
    phase?: string
    retryAttempt?: number
  },
): number {
  const retry = Math.max(1, Math.min(99, event.retryAttempt ?? 1))
  switch (event.eventName) {
    case "request_received": return 100
    case "tier_attempt_completed": return (event.phase === "health-check" ? 150 : 200) + retry
    case "notion_thread_hidden_verified": return 250 + retry
    case "response_normalized": return 300
    case "conversation_persisted": return 400
    case "slack_notification_completed": return 500
    case "customer_display_name_applied": return 600
    case "assistant_display_name_applied": return 610
    case "choice_panel_rendered": return 620
    case "booking_card_rendered": return 630
    case "booking_prefill_rendered": return 640
    case "fallback_ui_rendered": return 650
    case "booking_created": return 700
    case "customer_account_linked": return 710
    case "booking_submit_success_rendered": return 800
    case "operation_failed": return 900
  }
}
