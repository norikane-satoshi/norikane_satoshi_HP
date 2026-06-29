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

export type ChatbotRetryDiagnosticsSummary = {
  attemptCount?: number
  maxAttempts?: number
  retryReasons?: string[]
  repairAttempted?: boolean
  totalGenerateDurationMs?: number
  totalGenerateBudgetMs?: number
  perAttemptTimeoutMs?: number
  fallbackReason?: string
  exhausted?: boolean
  attempts?: ChatbotRetryAttemptSummary[]
}

type ChatbotRetryAttemptSummary = {
  attempt?: number
  outcome?: string
  durationMs?: number
  timeoutMs?: number
  reason?: string
  httpStatus?: number
  errorCode?: string
  retryable?: boolean
}

export type ChatbotSlackNotificationInput = {
  kind: "conversation" | "issue" | "booking-completed" | "message-edit"
  requestId?: string
  conversationId: string
  sessionId?: string
  tier?: ChatbotLlmTier
  routingDecisionKind?: RoutingDecision["kind"]
  uiKind?: string
  choiceSetId?: string
  flowStep?: string
  flowStepReason?: string
  threadTs?: string | null
  userMessage?: string
  assistantResponse?: string
  bookingProgress?: boolean
  issueReasons?: string[]
  retryDiagnostics?: ChatbotRetryDiagnosticsSummary | Record<string, unknown>
  pendingRecovery?: boolean
  pendingRequestKind?: "message" | "edit"
  bookingGroupId?: string
  selectedSlotCount?: number
  editedMessage?: {
    previousSummary?: string
    nextMessage: string
    truncatedFollowingMessages: number
  }
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

  if (input.kind === "message-edit") {
    const lines = [
      "ユーザーメッセージが編集されました",
      ...(isThreadReply ? formatRequiredOperationLines(input) : formatTrackingLines(input)),
      ...(input.editedMessage?.previousSummary
        ? [`編集前の安全な要約: ${redactForChatbotLog(input.editedMessage.previousSummary)}`]
        : []),
      ...(input.editedMessage?.nextMessage
        ? [`編集後メッセージ: ${redactForChatbotLog(input.editedMessage.nextMessage)}`]
        : []),
      ...(typeof input.editedMessage?.truncatedFollowingMessages === "number"
        ? [`編集により切り捨てられた後続件数: ${input.editedMessage.truncatedFollowingMessages}`]
        : []),
      "ここから再生成",
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
    ...(input.choiceSetId ? [`choiceSetId: ${input.choiceSetId}`] : []),
    ...(input.flowStep ? [`flowStep: ${input.flowStep}`] : []),
    ...(input.flowStepReason ? [`flowStepReason: ${redactForChatbotLog(input.flowStepReason)}`] : []),
    ...(typeof input.bookingProgress === "boolean" ? [`bookingProgress: ${input.bookingProgress}`] : []),
    ...(input.pendingRecovery ? ["pendingRecovery: true"] : []),
    ...(input.pendingRequestKind ? [`pendingRequestKind: ${input.pendingRequestKind}`] : []),
    ...formatRetryDiagnosticLines(input.retryDiagnostics),
  ]
}

function formatRetryDiagnosticLines(
  diagnostics: ChatbotSlackNotificationInput["retryDiagnostics"],
): string[] {
  const summary = coerceRetryDiagnosticsSummary(diagnostics)
  if (!summary) return []

  return [
    ...(typeof summary.attemptCount === "number"
      ? [`retryAttempts: ${summary.attemptCount}${typeof summary.maxAttempts === "number" ? `/${summary.maxAttempts}` : ""}`]
      : []),
    ...(summary.retryReasons?.length ? [`retryReasons: ${summary.retryReasons.join(",")}`] : []),
    ...(typeof summary.repairAttempted === "boolean" ? [`repairAttempted: ${summary.repairAttempted}`] : []),
    ...(typeof summary.totalGenerateDurationMs === "number"
      ? [`totalGenerateDurationMs: ${summary.totalGenerateDurationMs}`]
      : []),
    ...(typeof summary.totalGenerateBudgetMs === "number" ? [`totalGenerateBudgetMs: ${summary.totalGenerateBudgetMs}`] : []),
    ...(typeof summary.perAttemptTimeoutMs === "number" ? [`perAttemptTimeoutMs: ${summary.perAttemptTimeoutMs}`] : []),
    ...(summary.fallbackReason ? [`fallbackReason: ${redactForChatbotLog(summary.fallbackReason)}`] : []),
    ...(typeof summary.exhausted === "boolean" ? [`retryExhausted: ${summary.exhausted}`] : []),
    ...(summary.attempts?.length ? [`attempts: ${formatRetryAttempts(summary.attempts)}`] : []),
  ]
}

function coerceRetryDiagnosticsSummary(
  diagnostics: ChatbotSlackNotificationInput["retryDiagnostics"],
): ChatbotRetryDiagnosticsSummary | undefined {
  if (!diagnostics || typeof diagnostics !== "object" || Array.isArray(diagnostics)) return undefined

  const summary: ChatbotRetryDiagnosticsSummary = {}
  const maybeNumber = (key: keyof ChatbotRetryDiagnosticsSummary) => {
    const value = diagnostics[key]
    if (typeof value === "number" && Number.isFinite(value)) summary[key] = value as never
  }
  const maybeBoolean = (key: keyof ChatbotRetryDiagnosticsSummary) => {
    const value = diagnostics[key]
    if (typeof value === "boolean") summary[key] = value as never
  }
  const maybeString = (key: keyof ChatbotRetryDiagnosticsSummary) => {
    const value = diagnostics[key]
    if (typeof value === "string" && value.trim()) summary[key] = value.trim() as never
  }

  maybeNumber("attemptCount")
  maybeNumber("maxAttempts")
  maybeNumber("totalGenerateDurationMs")
  maybeNumber("totalGenerateBudgetMs")
  maybeNumber("perAttemptTimeoutMs")
  maybeBoolean("repairAttempted")
  maybeBoolean("exhausted")
  maybeString("fallbackReason")

  const retryReasons = diagnostics.retryReasons
  if (Array.isArray(retryReasons)) {
    summary.retryReasons = retryReasons
      .filter((reason): reason is string => typeof reason === "string" && reason.trim().length > 0)
      .map((reason) => redactForChatbotLog(reason.trim()))
  }
  const attempts = coerceRetryAttempts(diagnostics.attempts)
  if (attempts.length > 0) summary.attempts = attempts

  return Object.keys(summary).length > 0 ? summary : undefined
}

function coerceRetryAttempts(value: unknown): ChatbotRetryAttemptSummary[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((entry): ChatbotRetryAttemptSummary[] => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return []
    const source = entry as Record<string, unknown>
    const attempt: ChatbotRetryAttemptSummary = {}
    assignAttemptNumber(attempt, "attempt", source.attempt)
    assignAttemptNumber(attempt, "durationMs", source.durationMs)
    assignAttemptNumber(attempt, "timeoutMs", source.timeoutMs)
    assignAttemptNumber(attempt, "httpStatus", source.httpStatus)
    assignAttemptBoolean(attempt, "retryable", source.retryable)
    assignAttemptString(attempt, "outcome", source.outcome)
    assignAttemptString(attempt, "reason", source.reason)
    assignAttemptString(attempt, "errorCode", source.errorCode)
    return Object.keys(attempt).length > 0 ? [attempt] : []
  })
}

function assignAttemptNumber(
  target: ChatbotRetryAttemptSummary,
  key: "attempt" | "durationMs" | "timeoutMs" | "httpStatus",
  value: unknown,
): void {
  if (typeof value === "number" && Number.isFinite(value)) target[key] = value
}

function assignAttemptBoolean(target: ChatbotRetryAttemptSummary, key: "retryable", value: unknown): void {
  if (typeof value === "boolean") target[key] = value
}

function assignAttemptString(
  target: ChatbotRetryAttemptSummary,
  key: "outcome" | "reason" | "errorCode",
  value: unknown,
): void {
  if (typeof value === "string" && value.trim()) target[key] = redactForChatbotLog(value.trim())
}

function formatRetryAttempts(attempts: ChatbotRetryAttemptSummary[]): string {
  return attempts
    .map((attempt) =>
      [
        typeof attempt.attempt === "number" ? `#${attempt.attempt}` : "#?",
        attempt.outcome,
        attempt.reason,
        typeof attempt.httpStatus === "number" ? `http:${attempt.httpStatus}` : undefined,
        typeof attempt.durationMs === "number" ? `${attempt.durationMs}ms` : undefined,
        typeof attempt.timeoutMs === "number" ? `timeout:${attempt.timeoutMs}` : undefined,
      ]
        .filter(Boolean)
        .join("/"),
    )
    .join(";")
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
