import { chatbotStoredAuditEventSchema, type ChatbotStoredAuditEvent } from "@/lib/chatbot/audit/contract"

type ChatbotAuditEventCreateData = {
  eventId: string
  schemaVersion: string
  correlationId: string
  conversationHash: string
  eventName: string
  source: string
  result: string
  tier?: string
  durationMs?: number
  errorCode?: string
  uiKind?: string
  payloadJson: string
  buildSha: string
  createdAt: Date
}

type ChatbotAuditStoreClient = {
  chatbotAuditEvent: {
    create(input: { data: ChatbotAuditEventCreateData }): Promise<unknown>
  }
}

export function isChatbotConversationOwnedBySession(input: {
  conversationSessionId: string
  cookieSessionId: string
}): boolean {
  if (input.conversationSessionId === input.cookieSessionId) return true
  if (!input.conversationSessionId.startsWith(`${input.cookieSessionId}:`)) return false

  const isolatedIdentity = input.conversationSessionId.slice(input.cookieSessionId.length + 1)
  return isolatedIdentity.length > 0 && !isolatedIdentity.includes(":")
}

export async function recordChatbotAuditEvent(
  rawEvent: ChatbotStoredAuditEvent,
  options: { client?: ChatbotAuditStoreClient } = {},
): Promise<{ status: "created" | "duplicate" }> {
  const event = chatbotStoredAuditEventSchema.parse(rawEvent)
  const client = options.client ?? await loadDefaultAuditStoreClient()

  try {
    await client.chatbotAuditEvent.create({
      data: {
        eventId: event.eventId,
        schemaVersion: event.schemaVersion,
        correlationId: event.correlationId,
        conversationHash: event.conversationHash,
        eventName: event.eventName,
        source: event.source,
        result: event.result,
        ...(event.tier ? { tier: event.tier } : {}),
        ...(event.durationMs !== undefined ? { durationMs: event.durationMs } : {}),
        ...(event.errorCode ? { errorCode: event.errorCode } : {}),
        ...(event.uiKind ? { uiKind: event.uiKind } : {}),
        payloadJson: JSON.stringify(event),
        buildSha: event.buildSha,
        createdAt: new Date(event.createdAt),
      },
    })
    return { status: "created" }
  } catch (error) {
    if (isUniqueConstraintViolation(error)) return { status: "duplicate" }
    throw error
  }
}

async function loadDefaultAuditStoreClient(): Promise<ChatbotAuditStoreClient> {
  const { prisma } = await import("@/lib/prisma")
  return prisma as unknown as ChatbotAuditStoreClient
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002")
}
