import type { ChatbotLlmTier } from "@/lib/chatbot/server/llm-client"
import type { TierAttemptEvent } from "@/lib/chatbot/server/llm-orchestrator"
import {
  loadConversationSlackThread,
  saveConversationSlackThread,
  type ChatbotSlackThreadMetadata,
} from "@/lib/chatbot/server/repository"

export type ChatbotSlackProblemCode =
  | "tier-fallback"
  | "tier4-fallback"
  | "ai-response-failed"
  | "communication-failed"
  | "timeout"
  | "booking-order-failed"
  | "booking-order-completed"
  | "email-send-failed"
  | "unexpected-fallback"
  | "source-trace-mismatch"
  | "note-url-not-published"
  | "session-state-reset"

export type ChatbotSlackProblem = {
  code: ChatbotSlackProblemCode
  reason: string
}

export type ChatbotSlackNotificationEvent =
  | {
      kind: "conversation"
      requestId?: string
      conversationId: string
      sessionId: string
      userMessage: string
      assistantMessage: string
      tier: ChatbotLlmTier
      routingDecisionKind?: string
      uiKind?: string
      tierAttempts?: TierAttemptEvent[]
      problems?: ChatbotSlackProblem[]
    }
  | {
      kind: "booking-order"
      requestId?: string
      conversationId: string
      sessionId?: string
      bookingGroupId?: string
      bookingStatus?: string
      projectTitle?: string
      contactEmail?: string
      problems?: ChatbotSlackProblem[]
    }
  | {
      kind: "problem"
      requestId?: string
      conversationId?: string
      sessionId?: string
      operation: string
      stage: string
      status?: number
      problems: ChatbotSlackProblem[]
    }

type SlackNotificationConfig =
  | { status: "enabled"; botToken: string; channelId: string; privacyMode: "mask-contact" | "raw-contact" }
  | { status: "disabled"; reason: "explicitly-disabled" | "missing-env" }

type SlackThreadRepository = {
  loadConversationSlackThread: typeof loadConversationSlackThread
  saveConversationSlackThread: typeof saveConversationSlackThread
}

type NotifyOptions = {
  repository?: SlackThreadRepository
  fetchImpl?: typeof fetch
  config?: SlackNotificationConfig
}

type SlackPostMessageResponse = {
  ok?: boolean
  ts?: string
  error?: string
}

export type ChatbotSlackNotificationResult =
  | { status: "sent"; channelId: string; threadTs: string; parentCreated: boolean }
  | { status: "skipped"; reason: "explicitly-disabled" | "missing-env" | "missing-conversation-id" }
  | { status: "failed"; reason: "thread-load-failed" | "slack-api-failed" | "thread-save-failed" }

const defaultRepository: SlackThreadRepository = {
  loadConversationSlackThread,
  saveConversationSlackThread,
}

const slackApiUrl = "https://slack.com/api/chat.postMessage"

export async function notifyChatbotSlack(
  event: ChatbotSlackNotificationEvent,
  options: NotifyOptions = {},
): Promise<ChatbotSlackNotificationResult> {
  const config = options.config ?? getSlackNotificationConfig()
  if (config.status === "disabled") return { status: "skipped", reason: config.reason }

  const conversationId = event.conversationId
  if (!conversationId) return { status: "skipped", reason: "missing-conversation-id" }

  const repository = options.repository ?? defaultRepository
  let thread: ChatbotSlackThreadMetadata | null = null
  try {
    thread = await repository.loadConversationSlackThread(conversationId)
  } catch (error) {
    console.warn("[chatbot slack notification failed]", {
      reason: "thread-load-failed",
      conversationId,
      error: error instanceof Error ? error.message : String(error),
    })
    return { status: "failed", reason: "thread-load-failed" }
  }

  const blocks = buildSlackBlocks(event, config.privacyMode)
  const existingThreadTs = thread?.channelId === config.channelId ? thread.threadTs : null
  const parentCreated = !existingThreadTs
  const response = await postSlackMessage(
    {
      botToken: config.botToken,
      channelId: config.channelId,
      text: buildFallbackText(event),
      blocks,
      threadTs: existingThreadTs,
    },
    options.fetchImpl ?? fetch,
  )

  if (!response.ok || !response.ts) {
    console.warn("[chatbot slack notification failed]", {
      reason: "slack-api-failed",
      conversationId,
      slackError: response.error ?? "missing-ts",
    })
    return { status: "failed", reason: "slack-api-failed" }
  }

  const threadTs = existingThreadTs ?? response.ts
  if (parentCreated) {
    try {
      await repository.saveConversationSlackThread({
        conversationId,
        channelId: config.channelId,
        threadTs,
      })
    } catch (error) {
      console.warn("[chatbot slack notification failed]", {
        reason: "thread-save-failed",
        conversationId,
        error: error instanceof Error ? error.message : String(error),
      })
      return { status: "failed", reason: "thread-save-failed" }
    }
  }

  return { status: "sent", channelId: config.channelId, threadTs, parentCreated }
}

export function getSlackNotificationConfig(env: NodeJS.ProcessEnv = process.env): SlackNotificationConfig {
  if (env.CHATBOT_SLACK_NOTIFICATIONS_ENABLED === "false") {
    return { status: "disabled", reason: "explicitly-disabled" }
  }

  const botToken = env.CHATBOT_SLACK_BOT_TOKEN?.trim()
  const channelId = env.CHATBOT_SLACK_CHANNEL_ID?.trim()
  if (!botToken || !channelId) return { status: "disabled", reason: "missing-env" }

  const privacyMode = env.CHATBOT_SLACK_PRIVACY_MODE === "raw-contact" ? "raw-contact" : "mask-contact"
  return { status: "enabled", botToken, channelId, privacyMode }
}

export function buildTierProblems(input: {
  tier: ChatbotLlmTier
  tierAttempts?: TierAttemptEvent[]
}): ChatbotSlackProblem[] {
  if (input.tier === "local-deterministic" || input.tier === "tier-1-chrome-notion-ai") return []
  if (input.tier === "tier-4-form-fallback") {
    return [{ code: "tier4-fallback", reason: "AI tiers exhausted and Tier 4 form fallback answered." }]
  }
  return [{ code: "tier-fallback", reason: `Conversation answered by ${input.tier}.` }]
}

export function detectUnpublishedNoteUrlProblems(input: {
  assistantMessage: string
  publishedSlugs: ReadonlyArray<string>
}): ChatbotSlackProblem[] {
  const allowed = new Set(input.publishedSlugs)
  const problems: ChatbotSlackProblem[] = []
  for (const match of input.assistantMessage.matchAll(/https:\/\/norikane\.studio\/notes\/([a-z0-9-]+)/giu)) {
    const slug = match[1]
    if (!allowed.has(slug)) {
      problems.push({
        code: "note-url-not-published",
        reason: `Assistant attempted to expose unpublished note URL slug=${slug}.`,
      })
    }
  }
  return problems
}

async function postSlackMessage(
  input: {
    botToken: string
    channelId: string
    text: string
    blocks: unknown[]
    threadTs?: string | null
  },
  fetchImpl: typeof fetch,
): Promise<SlackPostMessageResponse> {
  try {
    const response = await fetchImpl(slackApiUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${input.botToken}`,
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        channel: input.channelId,
        text: input.text,
        blocks: input.blocks,
        ...(input.threadTs ? { thread_ts: input.threadTs } : {}),
      }),
    })
    const body = (await response.json().catch(() => ({}))) as SlackPostMessageResponse
    if (!response.ok) {
      return { ok: false, error: body.error ?? `http_${response.status}` }
    }
    return body
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "network_error",
    }
  }
}

function buildSlackBlocks(event: ChatbotSlackNotificationEvent, privacyMode: "mask-contact" | "raw-contact"): unknown[] {
  const problemLines = (event.problems ?? []).map((problem) => `<!here> *${problem.code}*: ${problem.reason}`)
  const fields = buildMetadataFields(event)
  const bodyLines =
    event.kind === "conversation"
      ? [
          "*User*",
          redactForSlack(event.userMessage, privacyMode),
          "",
          "*AI*",
          redactForSlack(event.assistantMessage, privacyMode),
        ]
      : event.kind === "booking-order"
        ? [
            "*Booking Order*",
            `project=${redactForSlack(event.projectTitle ?? "-", privacyMode)}`,
            `bookingGroupId=${event.bookingGroupId ?? "-"}`,
            `status=${event.bookingStatus ?? "-"}`,
            `contact=${redactForSlack(event.contactEmail ?? "-", privacyMode)}`,
          ]
        : [
            "*Problem*",
            `operation=${event.operation}`,
            `stage=${event.stage}`,
            `status=${event.status ?? "-"}`,
          ]

  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: [event.problems?.length ? "*HP chatbot problem event*" : "*HP chatbot conversation*", ...problemLines].join("\n"),
      },
    },
    {
      type: "section",
      fields,
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: truncateSlackText(bodyLines.join("\n")),
      },
    },
  ]
}

function buildMetadataFields(event: ChatbotSlackNotificationEvent): Array<{ type: "mrkdwn"; text: string }> {
  const base = [
    `*requestId*\n${event.requestId ?? "-"}`,
    `*conversationId*\n${event.conversationId ?? "-"}`,
    `*sessionId*\n${event.sessionId ?? "-"}`,
  ]
  if (event.kind === "conversation") {
    base.push(`*tier*\n${event.tier}`)
    base.push(`*routing/ui*\n${event.routingDecisionKind ?? "-"} / ${event.uiKind ?? "-"}`)
  }
  return base.map((text) => ({ type: "mrkdwn", text }))
}

function buildFallbackText(event: ChatbotSlackNotificationEvent): string {
  const severity = event.problems?.length ? "problem" : "conversation"
  return `HP chatbot ${severity}: conversationId=${event.conversationId ?? "-"} requestId=${event.requestId ?? "-"}`
}

function redactForSlack(value: string, privacyMode: "mask-contact" | "raw-contact"): string {
  const withoutSecrets = value
    .replace(/\b(?:xox[baprs]-|sk-[A-Za-z0-9_-]*|gh[pousr]_[A-Za-z0-9_]+)[A-Za-z0-9_-]*/g, "[secret]")
    .replace(/\b(?:api[_-]?key|token|secret|authorization)\s*[:=]\s*\S+/giu, "$1=[secret]")

  if (privacyMode === "raw-contact") return withoutSecrets

  return withoutSecrets
    .replace(/[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})/giu, "[email]@$1")
    .replace(/(?:\+?\d[\d -]{8,}\d)/g, "[phone]")
}

function truncateSlackText(value: string): string {
  const maxLength = 2800
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`
}
