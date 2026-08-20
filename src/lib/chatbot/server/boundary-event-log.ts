import { createHash } from "node:crypto"

import { hashChatbotConversationId } from "@/lib/chatbot/audit/server-projection"
import { getChatbotBuildSha } from "@/lib/chatbot/server/build-info"
import type { ChatbotLlmTier } from "@/lib/chatbot/server/llm-client"

export function logChatbotBoundaryEvent(input: {
  event: string
  requestId?: string
  tier?: ChatbotLlmTier
  boundary: unknown
  decision?: unknown
  reason?: unknown
  fields?: Record<string, unknown>
}): void {
  logPrivacySafeChatbotEvent({
    event: input.event,
    requestId: input.requestId,
    buildSha: getChatbotBuildSha(),
    tier: input.tier,
    boundary: input.boundary,
    decision: input.decision,
    reason: input.reason,
    ...input.fields,
  })
}

export function logPrivacySafeChatbotEvent(fields: Record<string, unknown>): void {
  if (process.env.NODE_ENV === "test") return
  console.info(JSON.stringify(sanitizeObject(fields)))
}

function sanitizeObject(value: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (key === "conversationId" && typeof entry === "string") {
      output.conversationHash = hashChatbotConversationId(entry)
      continue
    }
    if (key === "sessionId" && typeof entry === "string") {
      output.sessionHash = hashIdentifier("session", entry)
      continue
    }
    if (key === "userAgent" && typeof entry === "string") {
      output.clientClass = classifyClient(entry)
      continue
    }
    if (isForbiddenKey(key)) continue
    const safe = sanitizeValue(entry)
    if (safe !== undefined) output[key] = safe
  }
  return output
}

function sanitizeValue(value: unknown): unknown {
  if (value === null || typeof value === "boolean") return value
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    return /^[a-z0-9][a-z0-9_.:/-]{0,199}$/i.test(value) ? value : undefined
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeValue).filter((entry) => entry !== undefined).slice(0, 50)
  }
  if (value && typeof value === "object") return sanitizeObject(value as Record<string, unknown>)
  return undefined
}

function isForbiddenKey(key: string): boolean {
  if (/hash$/i.test(key)) return false
  return /(authorization|cookie|token|secret|prompt|content|text|message|question|label|email|phone|name|preview|stack|threadId|url)/i.test(key)
}

function hashIdentifier(domain: string, value: string): string {
  return createHash("sha256").update(`norikane-hp-chatbot-${domain}-v1`).update("\0").update(value).digest("hex")
}

function classifyClient(userAgent: string): "mobile" | "desktop" | "bot" | "unknown" {
  if (/bot|crawler|spider/i.test(userAgent)) return "bot"
  if (/mobile|iphone|ipad|android/i.test(userAgent)) return "mobile"
  if (/mozilla|chrome|safari|firefox|edge/i.test(userAgent)) return "desktop"
  return "unknown"
}
