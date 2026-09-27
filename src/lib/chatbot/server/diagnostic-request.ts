import { createHmac, timingSafeEqual } from "node:crypto"

import { chatbotDiagnosticSlackSkipErrorCode } from "@/lib/chatbot/diagnostic-slack-skip"

import type { ChatbotSlackNotificationResult } from "./slack-notifier"

/**
 * Automated checks (measurement and verification scripts) send this header so their conversations
 * stay out of Slack. The value is derived from a secret only the server and the operator's scripts
 * hold, so a customer cannot switch off their own notification; without it, or with any other value,
 * a conversation is treated as real and reaches Slack as before.
 */
export const chatbotDiagnosticHeader = "x-chatbot-diagnostic"

export function chatbotDiagnosticToken(
  secret = process.env.CHATBOT_HOSTED_NOTION_AI_WORKER_TOKEN,
): string | undefined {
  if (!secret) return undefined
  return createHmac("sha256", secret).update("chatbot-diagnostic-request").digest("hex")
}

export function isChatbotDiagnosticRequest(headers: Headers): boolean {
  const expected = chatbotDiagnosticToken()
  const received = headers.get(chatbotDiagnosticHeader)
  if (!expected || !received || received.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(received), Buffer.from(expected))
}

export async function skipDiagnosticSlackNotification(): Promise<ChatbotSlackNotificationResult> {
  return { status: "skipped", reason: "diagnostic" }
}

/** The audit error code for a Slack post that was not sent, telling a check's skip apart from an outage. */
export function chatbotSlackAuditErrorCode(
  result: Exclude<ChatbotSlackNotificationResult, { status: "sent" }>,
): string {
  return result.status === "skipped" && result.reason === "diagnostic"
    ? chatbotDiagnosticSlackSkipErrorCode
    : `slack-${result.status}`
}
