import type { RoutingDecision } from "@/lib/chatbot/domain"
import type { ChatbotLlmTier } from "@/lib/chatbot/server/llm-client"
import { redactForChatbotLog } from "@/lib/chatbot/server/log-redaction"

type SlackNotifierEnv = {
  CHATBOT_SLACK_NOTIFY_ENABLED?: string
  SLACK_BOT_TOKEN?: string
  SLACK_CHATBOT_CHANNEL_ID?: string
}

type SlackFetch = typeof fetch

export type ChatbotSlackNotificationResult =
  | { status: "sent"; ts: string | null }
  | { status: "skipped"; reason: "disabled" | "missing-slack-config" }
  | { status: "failed"; reason: "send-failed" }

export type ChatbotSlackNotificationInput = {
  kind: "conversation" | "issue" | "booking-completed"
  requestId?: string
  conversationId: string
  sessionId?: string
  tier?: ChatbotLlmTier
  routingDecisionKind?: RoutingDecision["kind"]
  threadTs?: string | null
  userMessage?: string
  assistantResponse?: string
  bookingProgress?: boolean
  issueReasons?: string[]
  bookingGroupId?: string
  selectedSlotCount?: number
}

type SlackPostMessageResponse = {
  ok?: boolean
  ts?: string
  error?: string
}

export async function sendChatbotSlackNotification(
  input: ChatbotSlackNotificationInput,
  options: { env?: SlackNotifierEnv; fetcher?: SlackFetch } = {},
): Promise<ChatbotSlackNotificationResult> {
  const env = options.env ?? process.env
  const enabled = env.CHATBOT_SLACK_NOTIFY_ENABLED === "true"
  const token = env.SLACK_BOT_TOKEN?.trim()
  const channel = env.SLACK_CHATBOT_CHANNEL_ID?.trim()

  if (!enabled) return { status: "skipped", reason: "disabled" }
  if (!token || !channel) return { status: "skipped", reason: "missing-slack-config" }

  const fetcher = options.fetcher ?? fetch
  const body = {
    channel,
    text: buildSlackText(input),
    ...(input.threadTs ? { thread_ts: input.threadTs } : {}),
  }

  try {
    const response = await fetcher("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      console.warn("[chatbot slack notification failed]", {
        status: response.status,
        conversationId: input.conversationId,
        kind: input.kind,
      })
      return { status: "failed", reason: "send-failed" }
    }

    const payload = (await response.json().catch(() => null)) as SlackPostMessageResponse | null
    if (!payload?.ok) {
      console.warn("[chatbot slack notification failed]", {
        error: payload?.error ?? "invalid_slack_response",
        conversationId: input.conversationId,
        kind: input.kind,
      })
      return { status: "failed", reason: "send-failed" }
    }

    return { status: "sent", ts: payload.ts ?? null }
  } catch (error) {
    console.warn("[chatbot slack notification failed]", {
      error: error instanceof Error ? error.message : String(error),
      conversationId: input.conversationId,
      kind: input.kind,
    })
    return { status: "failed", reason: "send-failed" }
  }
}

function buildSlackText(input: ChatbotSlackNotificationInput): string {
  const header =
    input.kind === "issue"
      ? "⚠️ Chatbot issue"
      : input.kind === "booking-completed"
        ? "Chatbot booking completed"
        : "Chatbot conversation"
  const lines = [
    header,
    `conversationId: ${input.conversationId}`,
    ...(input.sessionId ? [`sessionId: ${input.sessionId}`] : []),
    ...(input.requestId ? [`requestId: ${input.requestId}`] : []),
    ...(input.tier ? [`tier: ${input.tier}`] : []),
    ...(input.routingDecisionKind ? [`routingDecision: ${input.routingDecisionKind}`] : []),
    ...(typeof input.bookingProgress === "boolean" ? [`bookingProgress: ${input.bookingProgress ? "yes" : "no"}`] : []),
    ...(input.bookingGroupId ? [`bookingId: ${input.bookingGroupId}`] : []),
    ...(typeof input.selectedSlotCount === "number" ? [`selectedSlotCount: ${input.selectedSlotCount}`] : []),
    ...(input.issueReasons?.length ? [`reasons: ${input.issueReasons.join(", ")}`] : []),
    ...(input.userMessage ? ["", `user: ${redactForChatbotLog(input.userMessage)}`] : []),
    ...(input.assistantResponse ? [`assistant: ${redactForChatbotLog(input.assistantResponse)}`] : []),
  ]
  return lines.join("\n")
}
