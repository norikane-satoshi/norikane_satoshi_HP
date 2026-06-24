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
  uiKind?: string
  flowStep?: string
  flowStepReason?: string
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
    unfurl_links: false,
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
  const isThreadReply = Boolean(input.threadTs)

  if (input.kind === "issue") {
    const lines = [
      "応答でエラーが出ました",
      ...formatRequiredOperationLines(input),
      ...formatIssueReasonLines(input.issueReasons),
    ]
    return lines.join("\n")
  }

  if (input.kind === "booking-completed") {
    const lines = [
      "予約が確定しました",
      ...(input.bookingGroupId ? [`予約ID: ${input.bookingGroupId}`] : []),
      ...(typeof input.selectedSlotCount === "number" ? [`候補数: ${input.selectedSlotCount}件`] : []),
      ...(!isThreadReply ? formatTrackingLines(input) : []),
    ]
    return lines.join("\n")
  }

  const lines = [
    ...(!isThreadReply ? ["新しいチャット相談", ...formatTrackingLines(input), ""] : []),
    ...(isThreadReply ? formatRequiredOperationLines(input) : []),
    ...(input.userMessage ? [`ユーザー: ${redactForChatbotLog(input.userMessage)}`] : []),
    ...(input.assistantResponse ? [`AI: ${redactForChatbotLog(input.assistantResponse)}`] : []),
  ]
  return lines.join("\n")
}

function formatTrackingLines(input: ChatbotSlackNotificationInput): string[] {
  return [
    `会話ID: ${input.conversationId}`,
    ...(input.sessionId ? [`セッションID: ${input.sessionId}`] : []),
    ...formatRequiredOperationLines(input),
  ]
}

function formatRequiredOperationLines(input: ChatbotSlackNotificationInput): string[] {
  return [
    ...(input.requestId ? [`requestId: ${input.requestId}`] : []),
    ...(input.tier ? [`tier: ${input.tier}`] : []),
    ...(input.uiKind ? [`ui: ${input.uiKind}`] : []),
    ...(input.flowStep ? [`flowStep: ${input.flowStep}`] : []),
    ...(input.flowStepReason ? [`flowStepReason: ${redactForChatbotLog(input.flowStepReason)}`] : []),
    ...(typeof input.bookingProgress === "boolean" ? [`bookingProgress: ${input.bookingProgress}`] : []),
  ]
}

function formatIssueReasonLines(reasons: string[] | undefined): string[] {
  const labels = reasons?.map(formatIssueReason) ?? []
  return labels.length > 0 ? labels.map((label) => `内容: ${label}`) : []
}

function formatIssueReason(reason: string): string {
  switch (reason) {
    case "below-hosted-tier2-fallback":
      return "Hosted Tier2 以外の下位Tierで応答"
    case "tier4-form-fallback":
      return "AI応答を完了できず、問い合わせフォーム案内へ切り替え"
    case "booking-owner-email-send-failed":
      return "予約通知メールの送信に失敗"
    default:
      if (reason.startsWith("message-")) return "サーバー側で処理に失敗"
      if (reason.startsWith("booking-")) return "予約処理に失敗"
      return "サーバー側で処理に失敗"
  }
}
