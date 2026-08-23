import { createHash } from "node:crypto"

import type { RoutingDecision } from "@/lib/chatbot/domain"
import {
  chatbotLlmTierIds,
  type ChatbotLlmTier,
} from "@/lib/chatbot/server/llm-client"
import { redactForChatbotLog } from "@/lib/chatbot/server/log-redaction"
import { logPrivacySafeChatbotEvent } from "@/lib/chatbot/server/boundary-event-log"

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

export type ChatbotSlackDeliveryEvidenceItem = {
  kind: ChatbotSlackNotificationInput["kind"]
  deliveryRole: "parent" | "thread-reply"
  idempotencyKeyHash?: string
  providerDedupeKeySubmitted: boolean
  providerMessageTsPresent: boolean
  providerDeliveryAccepted: boolean
}

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
  providerModel?: string
  rateLimitRetryCount?: number
  dailyQuotaModelFallbackCount?: number
  attempts?: ChatbotRetryAttemptSummary[]
  threadLifecycle?: {
    visibilityStatus?: string
    hideVerificationResult?: string
    fallbackReason?: string
  }
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
  kind: "conversation" | "issue" | "booking-order-submitted" | "message-edit"
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
  const clientMessageId = buildChatbotSlackClientMessageId(input)
  const body = {
    channel,
    text: buildSlackText(input),
    unfurl_links: false,
    ...(clientMessageId
      ? {
          client_msg_id: clientMessageId,
          metadata: {
            event_type: "norikane_chatbot_notification",
            event_payload: {
              delivery_id: clientMessageId,
              kind: input.kind,
            },
          },
        }
      : {}),
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
      logPrivacySafeChatbotEvent({
        event: "chatbot_slack_notification_failed",
        status: response.status,
        conversationId: input.conversationId,
        kind: input.kind,
      })
      return { status: "failed", reason: "send-failed" }
    }

    const payload = (await response.json().catch(() => null)) as SlackPostMessageResponse | null
    if (!payload?.ok) {
      logPrivacySafeChatbotEvent({
        event: "chatbot_slack_notification_failed",
        errorCode: payload?.error ?? "invalid_slack_response",
        conversationId: input.conversationId,
        kind: input.kind,
      })
      return { status: "failed", reason: "send-failed" }
    }

    return { status: "sent", ts: payload.ts ?? null }
  } catch (error) {
    logPrivacySafeChatbotEvent({
      event: "chatbot_slack_notification_failed",
      errorKind: error instanceof Error ? error.name : typeof error,
      conversationId: input.conversationId,
      kind: input.kind,
    })
    return { status: "failed", reason: "send-failed" }
  }
}

export function buildChatbotSlackClientMessageId(
  input: Pick<
    ChatbotSlackNotificationInput,
    "kind" | "requestId" | "conversationId" | "bookingGroupId"
  >,
): string | null {
  const logicalRequestId = input.requestId?.trim() || input.bookingGroupId?.trim()
  if (!logicalRequestId) return null

  const digest = createHash("sha256")
    .update("norikane-hp-chatbot-slack-v1")
    .update("\0")
    .update(input.conversationId)
    .update("\0")
    .update(input.kind)
    .update("\0")
    .update(logicalRequestId)
    .digest()
  const bytes = Uint8Array.from(digest.subarray(0, 16))
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Buffer.from(bytes).toString("hex")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function buildChatbotSlackDeliveryEvidenceItem(
  input: Pick<
    ChatbotSlackNotificationInput,
    "kind" | "requestId" | "conversationId" | "bookingGroupId" | "threadTs"
  >,
  result: ChatbotSlackNotificationResult,
): ChatbotSlackDeliveryEvidenceItem {
  const clientMessageId = buildChatbotSlackClientMessageId(input)
  return {
    kind: input.kind,
    deliveryRole: input.threadTs ? "thread-reply" : "parent",
    ...(clientMessageId
      ? { idempotencyKeyHash: createHash("sha256").update(clientMessageId).digest("hex") }
      : {}),
    providerDedupeKeySubmitted: Boolean(clientMessageId),
    providerMessageTsPresent: result.status === "sent" && Boolean(result.ts),
    providerDeliveryAccepted: result.status === "sent" && Boolean(result.ts),
  }
}

export function buildChatbotSlackDeliveryEvidence(
  deliveries: ChatbotSlackDeliveryEvidenceItem[],
): {
  deliveries: ChatbotSlackDeliveryEvidenceItem[]
  uniqueIdempotencyKeys: boolean
} {
  const hashes = deliveries.flatMap((delivery) =>
    delivery.idempotencyKeyHash ? [delivery.idempotencyKeyHash] : [],
  )
  return {
    deliveries,
    uniqueIdempotencyKeys:
      hashes.length === deliveries.length && new Set(hashes).size === deliveries.length,
  }
}

function buildSlackText(input: ChatbotSlackNotificationInput): string {
  const isThreadReply = Boolean(input.threadTs)

  if (input.kind === "issue") {
    const lines = [
      formatIssueTitle(input.issueReasons),
      ...formatRequiredOperationLines(input),
      ...formatIssueReasonLines(input.issueReasons),
    ]
    return lines.join("\n")
  }

  if (input.kind === "booking-order-submitted") {
    const lines = [
      "Booking Orderを受け付けました",
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
  return formatRequiredOperationLines(input)
}

function formatRequiredOperationLines(input: ChatbotSlackNotificationInput): string[] {
  return [
    ...(input.requestId ? [`requestId: ${input.requestId}`] : []),
    ...(input.tier ? [`tier: ${formatTier(input.tier)}`] : []),
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
    ...(summary.providerModel ? [`providerModel: ${summary.providerModel}`] : []),
    ...(typeof summary.rateLimitRetryCount === "number"
      ? [`rateLimitRetryCount: ${summary.rateLimitRetryCount}`]
      : []),
    ...(typeof summary.dailyQuotaModelFallbackCount === "number"
      ? [`dailyQuotaModelFallbackCount: ${summary.dailyQuotaModelFallbackCount}`]
      : []),
    ...(summary.threadLifecycle?.visibilityStatus
      ? [`threadVisibility: ${redactForChatbotLog(summary.threadLifecycle.visibilityStatus)}`]
      : []),
    ...(summary.threadLifecycle?.hideVerificationResult
      ? [`threadHideVerification: ${redactForChatbotLog(summary.threadLifecycle.hideVerificationResult)}`]
      : []),
    ...(summary.threadLifecycle?.fallbackReason
      ? [`fallbackReason: ${redactForChatbotLog(summary.threadLifecycle.fallbackReason)}`]
      : []),
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
  maybeNumber("rateLimitRetryCount")
  maybeNumber("dailyQuotaModelFallbackCount")
  maybeBoolean("repairAttempted")
  maybeBoolean("exhausted")
  maybeString("fallbackReason")
  maybeString("providerModel")

  const retryReasons = diagnostics.retryReasons
  if (Array.isArray(retryReasons)) {
    summary.retryReasons = retryReasons
      .filter((reason): reason is string => typeof reason === "string" && reason.trim().length > 0)
      .map((reason) => redactForChatbotLog(reason.trim()))
  }
  const attempts = coerceRetryAttempts(diagnostics.attempts)
  if (attempts.length > 0) summary.attempts = attempts
  if (diagnostics.threadLifecycle && typeof diagnostics.threadLifecycle === "object" && !Array.isArray(diagnostics.threadLifecycle)) {
    const lifecycle = diagnostics.threadLifecycle as Record<string, unknown>
    const safeLifecycle: NonNullable<ChatbotRetryDiagnosticsSummary["threadLifecycle"]> = {}
    for (const [sourceKey, targetKey] of [
      ["visibilityStatus", "visibilityStatus"],
      ["hideVerificationResult", "hideVerificationResult"],
      ["fallbackReason", "fallbackReason"],
    ] as const) {
      const value = lifecycle[sourceKey]
      if (typeof value === "string" && /^[a-z0-9][a-z0-9_.:-]{0,119}$/i.test(value)) {
        safeLifecycle[targetKey] = value
      }
    }
    if (Object.keys(safeLifecycle).length > 0) summary.threadLifecycle = safeLifecycle
  }

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
    case "tier2-gemini-fallback":
      return "Tier 1からTier 2（Gemini Flash）へフォールバック"
    case "tier3-form-fallback":
      return "Tier 2でもAI応答を完了できず、Tier 3（問い合わせフォーム）へ切り替え"
    case "booking-owner-email-send-failed":
      return "予約通知メールの送信に失敗"
    default:
      if (reason.startsWith("message-")) return "サーバー側で処理に失敗"
      if (reason.startsWith("booking-")) return "予約処理に失敗"
      return "サーバー側で処理に失敗"
  }
}

function formatIssueTitle(reasons: string[] | undefined): string {
  return reasons?.some((reason) => reason === "tier2-gemini-fallback" || reason === "tier3-form-fallback")
    ? "チャット応答がフォールバックしました"
    : "応答でエラーが出ました"
}

function formatTier(tier: ChatbotLlmTier): string {
  switch (tier) {
    case chatbotLlmTierIds.tier1HostedChromeNotionAi:
      return `Tier 1（Hosted Chrome / Notion AI） [${tier}]`
    case chatbotLlmTierIds.tier2GeminiFlash:
      return `Tier 2（Gemini Flash） [${tier}]`
    case chatbotLlmTierIds.tier3FormFallback:
      return `Tier 3（問い合わせフォーム） [${tier}]`
  }
}
