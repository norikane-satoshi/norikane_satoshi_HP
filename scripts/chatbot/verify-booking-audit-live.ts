import { createHash } from "node:crypto"
import { fileURLToPath } from "node:url"

import { config as loadDotenv } from "dotenv"
import { z } from "zod"

loadDotenv({ path: ".env.local", override: false, quiet: true })
loadDotenv({ path: ".env", override: false, quiet: true })

const deliverySchema = z.object({
  kind: z.string(),
  deliveryRole: z.enum(["parent", "thread-reply"]).optional(),
  idempotencyKeyHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  providerDedupeKeySubmitted: z.boolean(),
  providerMessageTsPresent: z.boolean(),
  providerDeliveryAccepted: z.boolean().optional(),
}).passthrough()

const auditEventSchema = z.object({
  eventName: z.string(),
  result: z.string(),
  buildSha: z.string(),
  prefillFields: z.array(z.object({ matches: z.boolean() }).passthrough()).optional(),
  memoCoverage: z.object({
    finalMedia: z.boolean(),
    materialContents: z.boolean(),
    materialTiming: z.boolean(),
    materialMethod: z.boolean(),
  }).optional(),
  customerAccountEvidence: z.object({
    authenticated: z.boolean(),
    expectedLinked: z.boolean(),
    actualLinked: z.boolean(),
    matches: z.boolean(),
  }).optional(),
  slackDeliveryEvidence: z.object({
    deliveries: z.array(deliverySchema),
    uniqueIdempotencyKeys: z.boolean(),
  }).optional(),
}).passthrough()

const auditSummarySchema = z.object({
  correlationId: z.string().uuid(),
  status: z.enum(["complete", "pending", "failed"]),
  eventCount: z.number().int().nonnegative(),
  events: z.array(auditEventSchema),
}).passthrough()

export type BookingAuditSummary = z.infer<typeof auditSummarySchema>

export function evaluateLiveBookingAudit(input: {
  summary: BookingAuditSummary
  expectedBuildSha: string
  slackReadbackHashes: Set<string>
  requireAuthenticatedCustomer: boolean
}) {
  const events = input.summary.events
  const bookingCreated = events.filter((event) => event.eventName === "booking_created")
  const accountLinked = events.filter((event) => event.eventName === "customer_account_linked")
  const bookingCardRendered = events.filter((event) => event.eventName === "booking_card_rendered")
  const prefillRendered = events.filter((event) => event.eventName === "booking_prefill_rendered")
  const submitRendered = events.filter((event) => event.eventName === "booking_submit_success_rendered")
  const bookingSlackDeliveries = events.flatMap((event) =>
    event.eventName === "slack_notification_completed"
      ? event.slackDeliveryEvidence?.deliveries.filter(
          (delivery) => delivery.kind === "booking-order-submitted",
        ) ?? []
      : [],
  )
  const expectedSlackHashes = bookingSlackDeliveries.flatMap((delivery) =>
    delivery.idempotencyKeyHash ? [delivery.idempotencyKeyHash] : [],
  )
  const accountEvidence = accountLinked[0]?.customerAccountEvidence
  const prefill = prefillRendered[0]
  const violations = [
    ...(input.summary.status !== "complete" ? ["audit-summary-not-complete"] : []),
    ...(!hasExactlyOneSuccess(bookingCreated) ? ["booking-created-not-exactly-once"] : []),
    ...(!hasExactlyOneSuccess(accountLinked) ? ["customer-account-check-not-exactly-once"] : []),
    ...(!hasExactlyOneSuccess(bookingCardRendered) ? ["booking-card-render-not-exactly-once"] : []),
    ...(!hasExactlyOneSuccess(prefillRendered) ? ["booking-prefill-render-not-exactly-once"] : []),
    ...(!hasExactlyOneSuccess(submitRendered) ? ["booking-submit-render-not-exactly-once"] : []),
    ...(accountEvidence?.matches !== true ? ["customer-account-link-mismatch"] : []),
    ...(input.requireAuthenticatedCustomer && accountEvidence?.authenticated !== true
      ? ["authenticated-customer-evidence-missing"]
      : []),
    ...(prefill?.prefillFields?.length !== 9 || prefill.prefillFields.some((field) => !field.matches)
      ? ["booking-prefill-field-mismatch"]
      : []),
    ...(!prefill?.memoCoverage || Object.values(prefill.memoCoverage).some((covered) => !covered)
      ? ["booking-memo-coverage-incomplete"]
      : []),
    ...(bookingSlackDeliveries.length !== 1 ? ["booking-slack-not-exactly-once"] : []),
    ...(bookingSlackDeliveries.some((delivery) =>
      delivery.deliveryRole !== "thread-reply" ||
      delivery.providerDedupeKeySubmitted !== true ||
      delivery.providerMessageTsPresent !== true ||
      delivery.providerDeliveryAccepted !== true
    ) ? ["booking-slack-provider-evidence-invalid"] : []),
    ...(expectedSlackHashes.length !== 1 || !input.slackReadbackHashes.has(expectedSlackHashes[0])
      ? ["booking-slack-readback-missing"]
      : []),
    ...(events.some((event) => event.buildSha !== input.expectedBuildSha)
      ? ["build-sha-mismatch"]
      : []),
  ]

  return {
    ok: violations.length === 0,
    correlationId: input.summary.correlationId,
    eventCount: input.summary.eventCount,
    expectedBuildSha: input.expectedBuildSha,
    checks: {
      auditComplete: input.summary.status === "complete",
      bookingCreatedExactlyOnce: hasExactlyOneSuccess(bookingCreated),
      customerAccountMatched: accountEvidence?.matches === true,
      authenticatedCustomer: accountEvidence?.authenticated === true,
      prefillFieldsMatched: prefill?.prefillFields?.length === 9 && prefill.prefillFields.every((field) => field.matches),
      memoCoverageComplete: Boolean(prefill?.memoCoverage && Object.values(prefill.memoCoverage).every(Boolean)),
      bookingSlackExactlyOnce: bookingSlackDeliveries.length === 1,
      bookingSlackReadbackMatched: expectedSlackHashes.length === 1 && input.slackReadbackHashes.has(expectedSlackHashes[0]),
      buildShaMatched: events.length > 0 && events.every((event) => event.buildSha === input.expectedBuildSha),
    },
    violations,
  }
}

function hasExactlyOneSuccess(events: Array<{ result: string }>): boolean {
  return events.length === 1 && events[0]?.result === "success"
}

async function fetchAuditSummary(baseUrl: string, correlationId: string): Promise<BookingAuditSummary> {
  const response = await fetch(
    `${baseUrl.replace(/\/+$/u, "")}/api/chatbot/audit-summary?correlationId=${encodeURIComponent(correlationId)}`,
  )
  if (!response.ok) throw new Error(`audit_summary_http_${response.status}`)
  return auditSummarySchema.parse(await response.json())
}

async function fetchBuildSha(baseUrl: string): Promise<string> {
  const response = await fetch(`${baseUrl.replace(/\/+$/u, "")}/api/chatbot/build-info`)
  if (!response.ok) throw new Error(`build_info_http_${response.status}`)
  const payload = z.object({ commitSha: z.string().min(1) }).passthrough().parse(await response.json())
  return payload.commitSha
}

export async function collectSlackDeliveryHashes(token: string, channel: string): Promise<Set<string>> {
  const roots = await fetchSlackMessages(token, "conversations.history", {
    channel,
    limit: "100",
    include_all_metadata: "true",
  })
  const messages = [...roots]
  for (const root of roots.filter((message) => Number(message.reply_count ?? 0) > 0)) {
    if (typeof root.ts !== "string") continue
    messages.push(...await fetchSlackMessages(token, "conversations.replies", {
      channel,
      ts: root.ts,
      limit: "100",
      include_all_metadata: "true",
    }))
  }
  return new Set(messages.flatMap((message) => {
    const deliveryId = message.metadata?.event_payload?.delivery_id
    return typeof deliveryId === "string"
      ? [createHash("sha256").update(deliveryId).digest("hex")]
      : []
  }))
}

type SlackMessage = {
  ts?: unknown
  reply_count?: unknown
  metadata?: { event_payload?: { delivery_id?: unknown } }
}

async function fetchSlackMessages(
  token: string,
  method: "conversations.history" | "conversations.replies",
  params: Record<string, string>,
): Promise<SlackMessage[]> {
  const url = new URL(`https://slack.com/api/${method}`)
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value))
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } })
  if (!response.ok) throw new Error(`slack_http_${response.status}`)
  const payload = z.object({
    ok: z.boolean(),
    messages: z.array(z.unknown()).optional(),
    error: z.string().optional(),
  }).passthrough().parse(await response.json())
  if (!payload.ok) throw new Error(`slack_api_${safeCode(payload.error)}`)
  return (payload.messages ?? []).filter(
    (message): message is SlackMessage => Boolean(message && typeof message === "object" && !Array.isArray(message)),
  )
}

function safeCode(value: string | undefined): string {
  return value && /^[a-z0-9_.:-]{1,120}$/i.test(value) ? value : "unknown"
}

function argValue(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name)
  return index >= 0 ? argv[index + 1]?.trim() || undefined : undefined
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const correlationId = z.string().uuid().parse(argValue(argv, "--correlation-id"))
  const baseUrl = argValue(argv, "--base-url") ?? "http://localhost:41238"
  const token = process.env.SLACK_BOT_TOKEN?.trim()
  const channel = process.env.SLACK_CHATBOT_CHANNEL_ID?.trim()
  if (!token || !channel) throw new Error("missing_slack_readback_config")
  const [summary, expectedBuildSha, slackReadbackHashes] = await Promise.all([
    fetchAuditSummary(baseUrl, correlationId),
    fetchBuildSha(baseUrl),
    collectSlackDeliveryHashes(token, channel),
  ])
  const report = evaluateLiveBookingAudit({
    summary,
    expectedBuildSha,
    slackReadbackHashes,
    requireAuthenticatedCustomer: !argv.includes("--allow-guest"),
  })
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  if (!report.ok) process.exitCode = 1
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "booking_audit_live_verification_failed"}\n`)
    process.exitCode = 1
  })
}
