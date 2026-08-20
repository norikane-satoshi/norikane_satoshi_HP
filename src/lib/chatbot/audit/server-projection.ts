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
    conversationHash: hashChatbotConversationId(conversationId),
    buildSha: metadata.buildSha,
    createdAt: metadata.createdAt,
  })
}
