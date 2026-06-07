import { getBookingCalendarAdminEmail } from "@/lib/auth/server/is-admin"
import { getResendClient } from "@/lib/booking/server/email"
import type { ChatbotLlmRequest } from "@/lib/chatbot/server/llm-client"
import {
  createTier1ChromeNotionAiClient,
  tier1ObservedNotionAiModel,
  type NotionAiRuntimeInspection,
} from "@/lib/chatbot/server/llm-clients/tier1-chrome-notion-ai"
import {
  countRecentHealthFailures,
  recordChatbotHealthCheck,
  type ChatbotOpsLogClient,
} from "@/lib/chatbot/server/chatbot-ops-log"

export type Tier1HealthCheckResult = {
  ok: boolean
  probeAt: string
  rateLimitRemaining: number | null
  rateLimitRemainingRatio: number | null
  modelSelectorPresent: boolean
  responseSuccess: boolean
  consecutiveFailures: number
  alertSent: boolean
  details: Record<string, unknown>
}

type Tier1HealthCheckClient = {
  generate(request: ChatbotLlmRequest): Promise<{
    rawText: string
    latencyMs?: number
    diagnostics?: Record<string, unknown>
  }>
  inspectRuntimeContext(): Promise<NotionAiRuntimeInspection>
}

type Tier1HealthCheckOptions = {
  logClient: ChatbotOpsLogClient
  client?: Tier1HealthCheckClient
  now?: () => Date
  sendAlert?: (input: { subject: string; text: string }) => Promise<boolean>
}

const alertSubjectPrefix = "チャットボット Tier 1 警告"
const failureWindowSize = 3
const lowRateLimitRatio = 0.2

export async function runTier1HealthCheck(
  options: Tier1HealthCheckOptions,
): Promise<Tier1HealthCheckResult> {
  const probeAt = options.now?.() ?? new Date()
  const client =
    options.client ??
    createTier1ChromeNotionAiClient({
      preferredModel: tier1ObservedNotionAiModel,
    })
  const details: Record<string, unknown> = {}
  let inspection: NotionAiRuntimeInspection | undefined
  let responseSuccess = false
  let rateLimitRemaining: number | null = null
  let rateLimitRemainingRatio: number | null = null
  let errorMessage: string | undefined

  try {
    inspection = await client.inspectRuntimeContext()
    details.inspection = inspection
    const response = await client.generate(buildProbeRequest())
    responseSuccess = true
    details.latencyMs = response.latencyMs
    details.rawTextPreview = response.rawText.replace(/\s+/g, " ").slice(0, 120)
    details.diagnostics = response.diagnostics
    const rateLimit = extractRateLimit(response.diagnostics)
    rateLimitRemaining = rateLimit.remaining
    rateLimitRemainingRatio = rateLimit.remainingRatio
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error)
    details.error = errorMessage
  }

  const modelSelectorPresent = Boolean(inspection?.preferredModelAvailable)
  await recordChatbotHealthCheck({
    client: options.logClient,
    probeAt,
    rateLimitRemaining,
    modelSelectorPresent,
    responseSuccess,
    details,
  })
  const consecutiveFailures = await countRecentHealthFailures({
    client: options.logClient,
    includeCurrentSuccess: responseSuccess,
    windowSize: failureWindowSize,
  })
  const shouldAlert =
    (typeof rateLimitRemainingRatio === "number" && rateLimitRemainingRatio < lowRateLimitRatio) ||
    !modelSelectorPresent ||
    consecutiveFailures >= failureWindowSize
  const alertSent = shouldAlert
    ? await (options.sendAlert ?? sendTier1HealthAlert)({
        subject: buildAlertSubject({ modelSelectorPresent, responseSuccess, rateLimitRemainingRatio }),
        text: JSON.stringify(
          {
            probeAt: probeAt.toISOString(),
            rateLimitRemaining,
            rateLimitRemainingRatio,
            modelSelectorPresent,
            responseSuccess,
            consecutiveFailures,
            error: errorMessage,
          },
          null,
          2,
        ),
      })
    : false

  return {
    ok: responseSuccess && modelSelectorPresent && consecutiveFailures === 0,
    probeAt: probeAt.toISOString(),
    rateLimitRemaining,
    rateLimitRemainingRatio,
    modelSelectorPresent,
    responseSuccess,
    consecutiveFailures,
    alertSent,
    details,
  }
}

function buildProbeRequest(): ChatbotLlmRequest {
  return {
    systemPrompt:
      "あなたはのりかね映像設計室の新規案件相談窓口です。通常の新規相談として、短く応答してください。",
    messages: [],
    conversationState: {
      hasFinalMedium: true,
      hasJobKind: true,
      hasProjectLength: true,
      hasAdditionalWork: true,
      hasDocumentaryAttachments: true,
      hasWorkSite: true,
      hasReferenceUrls: false,
      hasContactEmail: true,
      hasDesiredSchedule: false,
      turnCount: 1,
      contactEmail: "health-check@example.test",
    },
    jobContext: {
      jobKind: "cm-30s",
      finalMedium: "web",
      workSite: "remote-grading",
      documentaryAttachment: { kind: "none" },
    },
    latestUserMessage: "health check: 30秒Web CMの所要日数を一文で返してください",
    temperature: 0,
    maxOutputTokens: 128,
  }
}

function extractRateLimit(diagnostics?: Record<string, unknown>): {
  remaining: number | null
  remainingRatio: number | null
} {
  const headers = diagnostics?.responseHeaders
  if (!headers || typeof headers !== "object") return { remaining: null, remainingRatio: null }
  const record = headers as Record<string, unknown>
  const remaining = firstHeaderNumber(record, [
    "x-ratelimit-remaining",
    "x-rate-limit-remaining",
    "ratelimit-remaining",
  ])
  const limit = firstHeaderNumber(record, ["x-ratelimit-limit", "x-rate-limit-limit", "ratelimit-limit"])
  const percent = firstHeaderNumber(record, [
    "x-ratelimit-remaining-percent",
    "x-rate-limit-remaining-percent",
  ])

  return {
    remaining,
    remainingRatio:
      typeof percent === "number"
        ? percent / 100
        : typeof remaining === "number" && typeof limit === "number" && limit > 0
          ? remaining / limit
          : null,
  }
}

function firstHeaderNumber(headers: Record<string, unknown>, names: string[]): number | null {
  const normalized = new Map(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
  )

  for (const name of names) {
    const value = normalized.get(name)
    if (typeof value === "number" && Number.isFinite(value)) return value
    if (typeof value !== "string") continue
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }

  return null
}

function buildAlertSubject(input: {
  modelSelectorPresent: boolean
  responseSuccess: boolean
  rateLimitRemainingRatio: number | null
}): string {
  if (!input.modelSelectorPresent) return `${alertSubjectPrefix}: model selector missing`
  if (!input.responseSuccess) return `${alertSubjectPrefix}: response failed`
  if (
    typeof input.rateLimitRemainingRatio === "number" &&
    input.rateLimitRemainingRatio < lowRateLimitRatio
  ) {
    return `${alertSubjectPrefix}: rate limit low`
  }

  return `${alertSubjectPrefix}: unknown`
}

async function sendTier1HealthAlert(input: { subject: string; text: string }): Promise<boolean> {
  const resend = getResendClient()
  const to = getBookingCalendarAdminEmail() || process.env.RESEND_FROM_EMAIL
  if (!resend || !to) return false

  const { error } = await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL ?? "noreply@norikane.studio",
    to,
    subject: input.subject,
    text: input.text,
  })
  if (error) throw new Error(`Resend send failed: ${error.message}`)
  return true
}
