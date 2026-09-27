import { randomUUID } from "node:crypto"
import { fileURLToPath } from "node:url"

import { config as loadDotenv } from "dotenv"
import { z } from "zod"

loadDotenv({ path: ".env.local", override: false, quiet: true })
loadDotenv({ path: ".env", override: false, quiet: true })

const acceptedTierSchema = z.enum([
  "tier-1-hosted-chrome-notion-ai",
  "tier-2-gemini-flash",
  "tier-3-form-fallback",
])

const messageSuccessSchema = z.object({
  requestId: z.string().uuid(),
  conversationId: z.string().min(1),
  userMessage: z.object({ id: z.string().min(1), role: z.literal("user") }),
  assistantMessage: z.object({ role: z.literal("assistant") }),
  tier: acceptedTierSchema,
}).passthrough()

const buildInfoSchema = z.object({ commitSha: z.string().min(1) }).passthrough()

export type KnownRegressionAuditEvent = {
  correlationId: string
  eventName: string
  result: string
  tier?: string | null
  errorCode?: string | null
  buildSha: string
  sequence?: number | null
  finalTierConsistent?: boolean | null
  tierSequenceValid?: boolean | null
}

type RunResult = {
  requestId: string
  httpStatus: number
  tier: z.infer<typeof acceptedTierSchema>
}

export type KnownRegressionInput = {
  expectedBuildSha: string
  first: RunResult
  edit: RunResult
  conversationStable: boolean
  editTargetMatched: boolean
  conversationShape: {
    messageCount: number
    userTurnCount: number
    assistantTurnCount: number
    sequenceValid: boolean
  }
  auditObservationComplete: boolean
  auditEvents: KnownRegressionAuditEvent[]
}

const requiredServerBoundaries = [
  "request_received",
  "response_normalized",
  "conversation_persisted",
  "slack_notification_completed",
] as const

export function evaluateKnownRegressionRun(input: KnownRegressionInput) {
  const exactCorrelationIds = new Set([input.first.requestId, input.edit.requestId])
  const exactEvents = input.auditEvents.filter((event) => exactCorrelationIds.has(event.correlationId))
  const eventsByRequest = new Map([
    [input.first.requestId, exactEvents.filter((event) => event.correlationId === input.first.requestId)],
    [input.edit.requestId, exactEvents.filter((event) => event.correlationId === input.edit.requestId)],
  ])
  const operationFailed = exactEvents.some((event) => event.eventName === "operation_failed")
  const auditBoundaryMissing = [input.first, input.edit].some((run) => {
    const events = eventsByRequest.get(run.requestId) ?? []
    return requiredServerBoundaries.some(
      (eventName) => events.filter((event) => event.eventName === eventName && event.result === "success").length !== 1,
    ) || events.filter((event) => event.eventName === "tier_attempt_completed").length === 0
  })
  const tierEvidenceInvalid = [input.first, input.edit].some((run) => {
    const response = (eventsByRequest.get(run.requestId) ?? [])
      .find((event) => event.eventName === "response_normalized")
    return response?.tier !== run.tier ||
      response?.finalTierConsistent !== true ||
      response?.tierSequenceValid !== true
  })
  const buildShaMismatch = exactEvents.some((event) => event.buildSha !== input.expectedBuildSha)
  const unexpectedTier3 = input.first.tier === "tier-3-form-fallback" || input.edit.tier === "tier-3-form-fallback"
  const conversationRoundTripValid =
    input.conversationStable &&
    input.editTargetMatched &&
    input.conversationShape.messageCount === 2 &&
    input.conversationShape.userTurnCount === 1 &&
    input.conversationShape.assistantTurnCount === 1 &&
    input.conversationShape.sequenceValid
  const violations = [
    ...(input.first.httpStatus !== 200 ? ["initial-send-http-failed"] : []),
    ...(input.edit.httpStatus !== 200 ? ["edit-resend-http-failed"] : []),
    ...(unexpectedTier3 ? ["unexpected-tier3"] : []),
    ...(operationFailed ? ["operation-failed-detected"] : []),
    ...(input.auditObservationComplete && auditBoundaryMissing ? ["audit-boundary-missing"] : []),
    ...(input.auditObservationComplete && tierEvidenceInvalid ? ["tier-evidence-invalid"] : []),
    ...(input.auditObservationComplete && buildShaMismatch ? ["build-sha-mismatch"] : []),
    ...(!conversationRoundTripValid ? ["conversation-roundtrip-invalid"] : []),
  ]
  const inconclusiveReasons = input.auditObservationComplete ? [] : ["audit-observation-timeout"]

  return {
    ok: violations.length === 0 && inconclusiveReasons.length === 0,
    verdict: inconclusiveReasons.length > 0 ? "inconclusive" as const : violations.length > 0 ? "failed" as const : "passed" as const,
    expectedBuildSha: input.expectedBuildSha,
    correlations: [input.first.requestId, input.edit.requestId],
    tiers: [input.first.tier, input.edit.tier],
    auditEventCount: exactEvents.length,
    checks: {
      initialSendSucceeded: input.first.httpStatus === 200,
      editResendSucceeded: input.edit.httpStatus === 200,
      tierOutcomeAccepted: !unexpectedTier3 && (!input.auditObservationComplete || !tierEvidenceInvalid),
      auditBoundariesComplete: input.auditObservationComplete && !operationFailed && !auditBoundaryMissing,
      buildShaMatched: input.auditObservationComplete && !buildShaMismatch,
      conversationRoundTripValid,
    },
    violations,
    inconclusiveReasons,
  }
}

type MessageAttempt = {
  status: number
  payload?: z.infer<typeof messageSuccessSchema>
  requestId: string
  tier: z.infer<typeof acceptedTierSchema>
}

async function postMessage(baseUrl: string, body: Record<string, unknown>): Promise<MessageAttempt> {
  const response = await fetch(`${baseUrl}/api/chatbot/message`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  const raw: unknown = await response.json().catch(() => ({}))
  const parsed = messageSuccessSchema.safeParse(raw)
  if (parsed.success) {
    return {
      status: response.status,
      payload: parsed.data,
      requestId: parsed.data.requestId,
      tier: parsed.data.tier,
    }
  }
  const safeFailure = z.object({ requestId: z.string().uuid().optional() }).passthrough().safeParse(raw)
  return {
    status: response.status,
    requestId: safeFailure.success && safeFailure.data.requestId ? safeFailure.data.requestId : randomUUID(),
    tier: "tier-3-form-fallback",
  }
}

async function readBuildSha(baseUrl: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/chatbot/build-info`)
  if (!response.ok) throw new Error(`build_info_http_${response.status}`)
  return buildInfoSchema.parse(await response.json()).commitSha
}

function readSafePayload(payloadJson: string) {
  try {
    const payload = JSON.parse(payloadJson) as Record<string, unknown>
    return {
      sequence: typeof payload.sequence === "number" ? payload.sequence : undefined,
      finalTierConsistent:
        typeof payload.finalTierConsistent === "boolean" ? payload.finalTierConsistent : undefined,
      tierSequenceValid: typeof payload.tierSequenceValid === "boolean" ? payload.tierSequenceValid : undefined,
    }
  } catch {
    return {}
  }
}

async function pollAuditEvents(correlationIds: string[]): Promise<{
  events: KnownRegressionAuditEvent[]
  complete: boolean
}> {
  const { prisma } = await import("@/lib/prisma")
  const deadline = Date.now() + 45_000
  let lastEvents: KnownRegressionAuditEvent[] = []
  do {
    const rows = await prisma.chatbotAuditEvent.findMany({
      where: { correlationId: { in: correlationIds } },
      select: {
        correlationId: true,
        eventName: true,
        result: true,
        tier: true,
        errorCode: true,
        buildSha: true,
        payloadJson: true,
      },
    })
    const events = rows.map((row) => ({ ...row, ...readSafePayload(row.payloadJson) }))
    lastEvents = events
    const ready = correlationIds.every((correlationId) =>
      requiredServerBoundaries.every((eventName) =>
        events.some((event) => event.correlationId === correlationId && event.eventName === eventName),
      ),
    )
    if (ready || events.some((event) => event.eventName === "operation_failed")) {
      return { events, complete: true }
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  } while (Date.now() < deadline)
  return { events: lastEvents, complete: false }
}

async function readConversationShape(conversationId: string) {
  const { prisma } = await import("@/lib/prisma")
  const messages = await prisma.chatbotMessage.findMany({
    where: { conversationId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { role: true },
  })
  return {
    messageCount: messages.length,
    userTurnCount: messages.filter((message) => message.role === "user").length,
    assistantTurnCount: messages.filter((message) => message.role === "assistant").length,
    sequenceValid: messages.length === 2 && messages[0]?.role === "user" && messages[1]?.role === "assistant",
  }
}

function argValue(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name)
  return index >= 0 ? argv[index + 1]?.trim() || undefined : undefined
}

async function main() {
  const baseUrl = (argValue(process.argv.slice(2), "--base-url") ?? "http://localhost:41238").replace(/\/+$/u, "")
  const expectedBuildSha = await readBuildSha(baseUrl)
  const clientSessionId = randomUUID()
  const firstUserMessageId = `client_msg_${randomUUID()}`
  const editedUserMessageId = `client_msg_${randomUUID()}`
  const first = await postMessage(baseUrl, {
    message: "HP-CHATBOT-REGRESSION-CANARY",
    clientSessionId,
    clientUserMessageId: firstUserMessageId,
  })
  if (!first.payload) throw new Error("initial_send_failed")
  const edit = await postMessage(baseUrl, {
    message: "HP-CHATBOT-REGRESSION-CANARY-EDITED",
    conversationId: first.payload.conversationId,
    clientSessionId,
    clientUserMessageId: editedUserMessageId,
    editTargetMessageId: firstUserMessageId,
  })
  const correlationIds = [first.requestId, edit.requestId]
  const [auditObservation, conversationShape] = await Promise.all([
    pollAuditEvents(correlationIds),
    readConversationShape(first.payload.conversationId),
  ])
  const report = evaluateKnownRegressionRun({
    expectedBuildSha,
    first: { requestId: first.requestId, httpStatus: first.status, tier: first.tier },
    edit: { requestId: edit.requestId, httpStatus: edit.status, tier: edit.tier },
    conversationStable: edit.payload?.conversationId === first.payload.conversationId,
    editTargetMatched:
      first.payload.userMessage.id === firstUserMessageId &&
      edit.payload?.userMessage.id === editedUserMessageId,
    conversationShape,
    auditObservationComplete: auditObservation.complete,
    auditEvents: auditObservation.events,
  })
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  if (!report.ok) process.exitCode = 1
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "known_regression_live_verification_failed"}\n`)
    process.exitCode = 1
  })
}
