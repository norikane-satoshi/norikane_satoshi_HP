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

const choiceSetSchema = z.object({
  id: z.string().min(1),
  choices: z.array(z.object({ id: z.string().min(1), label: z.string().min(1) }).passthrough()).min(1),
}).passthrough()

const messageSuccessSchema = z.object({
  requestId: z.string().uuid(),
  conversationId: z.string().min(1),
  userMessage: z.object({ id: z.string().min(1), role: z.literal("user") }),
  assistantMessage: z.object({ role: z.literal("assistant") }),
  tier: acceptedTierSchema,
  ui: z.object({
    kind: z.string().min(1),
    choiceSet: choiceSetSchema.optional(),
  }).passthrough(),
}).passthrough()

const buildInfoSchema = z.object({ commitSha: z.string().min(1) }).passthrough()

export type EnduranceAuditEvent = {
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

type EnduranceTurn = {
  requestId: string
  httpStatus: number
  tier: z.infer<typeof acceptedTierSchema>
}

export type EnduranceInput = {
  expectedBuildSha: string
  requestedTurnCount?: number
  turns: EnduranceTurn[]
  conversationStable: boolean
  conversationShape: {
    messageCount: number
    userTurnCount: number
    assistantTurnCount: number
    sequenceValid: boolean
  }
  auditObservationComplete: boolean
  auditEvents: EnduranceAuditEvent[]
}

const requiredServerBoundaries = [
  "request_received",
  "response_normalized",
  "conversation_persisted",
  "slack_notification_completed",
] as const

export function evaluateEnduranceRun(input: EnduranceInput) {
  const requestedTurnCount = input.requestedTurnCount ?? input.turns.length
  const exactCorrelationIds = new Set(input.turns.map((turn) => turn.requestId))
  const exactEvents = input.auditEvents.filter((event) => exactCorrelationIds.has(event.correlationId))
  const eventsFor = (requestId: string) => exactEvents.filter((event) => event.correlationId === requestId)
  const operationFailed = exactEvents.some((event) => event.eventName === "operation_failed")
  const auditBoundaryMissing = input.turns.some((turn) => {
    const events = eventsFor(turn.requestId)
    return requiredServerBoundaries.some(
      (eventName) => events.filter(
        (event) => event.eventName === eventName && event.result === "success",
      ).length !== 1,
    ) || events.filter((event) => event.eventName === "tier_attempt_completed").length === 0
  })
  const tierEvidenceInvalid = input.turns.some((turn) => {
    const response = eventsFor(turn.requestId).find((event) => event.eventName === "response_normalized")
    return response?.tier !== turn.tier ||
      response?.finalTierConsistent !== true ||
      response?.tierSequenceValid !== true
  })
  const buildShaMismatch = exactEvents.some((event) => event.buildSha !== input.expectedBuildSha)
  const everyHttpRequestSucceeded = input.turns.length === requestedTurnCount &&
    input.turns.every((turn) => turn.httpStatus === 200)
  const unexpectedTier3 = input.turns.some((turn) => turn.tier === "tier-3-form-fallback")
  const correlationsUnique = exactCorrelationIds.size === input.turns.length
  const conversationRoundTripValid =
    input.conversationStable &&
    input.conversationShape.messageCount === requestedTurnCount * 2 &&
    input.conversationShape.userTurnCount === requestedTurnCount &&
    input.conversationShape.assistantTurnCount === requestedTurnCount &&
    input.conversationShape.sequenceValid
  const violations = [
    ...(input.turns.length !== requestedTurnCount ? ["turn-count-incomplete"] : []),
    ...(!everyHttpRequestSucceeded ? ["turn-http-failed"] : []),
    ...(unexpectedTier3 ? ["unexpected-tier3"] : []),
    ...(!correlationsUnique ? ["request-correlation-duplicate"] : []),
    ...(operationFailed ? ["operation-failed-detected"] : []),
    ...(input.auditObservationComplete && auditBoundaryMissing ? ["audit-boundary-missing"] : []),
    ...(input.auditObservationComplete && tierEvidenceInvalid ? ["tier-evidence-invalid"] : []),
    ...(input.auditObservationComplete && buildShaMismatch ? ["build-sha-mismatch"] : []),
    ...(!conversationRoundTripValid ? ["conversation-roundtrip-invalid"] : []),
  ]
  const inconclusiveReasons = input.auditObservationComplete ? [] : ["audit-observation-timeout"]
  const verdict = violations.length > 0
    ? "failed" as const
    : inconclusiveReasons.length > 0
      ? "inconclusive" as const
      : "passed" as const

  return {
    ok: verdict === "passed",
    verdict,
    expectedBuildSha: input.expectedBuildSha,
    turnCount: input.turns.length,
    requestedTurnCount,
    correlations: input.turns.map((turn) => turn.requestId),
    tiers: input.turns.map((turn) => turn.tier),
    auditEventCount: exactEvents.length,
    checks: {
      everyHttpRequestSucceeded,
      everyTierOutcomeAccepted: !unexpectedTier3 && (!input.auditObservationComplete || !tierEvidenceInvalid),
      auditBoundariesComplete: input.auditObservationComplete && !operationFailed && !auditBoundaryMissing,
      buildShaMatched: input.auditObservationComplete && !buildShaMismatch,
      conversationRoundTripValid,
      correlationsUnique,
    },
    violations,
    inconclusiveReasons,
  }
}

type MessageAttempt = EnduranceTurn & {
  payload?: z.infer<typeof messageSuccessSchema>
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
      httpStatus: response.status,
      payload: parsed.data,
      requestId: parsed.data.requestId,
      tier: parsed.data.tier,
    }
  }
  const safeFailure = z.object({ requestId: z.string().uuid().optional() }).passthrough().safeParse(raw)
  return {
    httpStatus: response.status,
    requestId: safeFailure.success && safeFailure.data.requestId ? safeFailure.data.requestId : randomUUID(),
    tier: "tier-3-form-fallback",
  }
}

async function readBuildSha(baseUrl: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/chatbot/build-info`)
  if (!response.ok) throw new Error(`build_info_http_${response.status}`)
  return buildInfoSchema.parse(await response.json()).commitSha
}

function nextCanaryMessage(
  turnIndex: number,
  previousPayload: z.infer<typeof messageSuccessSchema> | undefined,
): string {
  const choiceSet = previousPayload?.ui.kind === "choice-panel" ? previousPayload.ui.choiceSet : undefined
  if (choiceSet) {
    const preferredIds: Record<string, string[]> = {
      "job-kind": ["cm-30s"],
      "project-length": ["short-under-60s", "cm-30s"],
      "final-medium": ["youtube", "web"],
      "additional-work": ["none"],
      "documentary-attachment": ["none"],
      "work-site": ["remote-grading"],
      "production-options": ["none"],
      "booking-final-confirmation": ["continue-to-booking"],
    }
    const preferred = preferredIds[choiceSet.id] ?? []
    const choice = preferred
      .map((id) => choiceSet.choices.find((candidate) => candidate.id === id))
      .find(Boolean) ?? choiceSet.choices.find((candidate) => candidate.id !== "other") ?? choiceSet.choices[0]
    return `選択: ${choice.id}`
  }

  const followups = [
    "30秒のWeb CMです",
    "YouTubeで公開する予定です",
    "カラグレ以外の追加作業はありません",
    "付随する映像はありません",
    "作業はリモートを希望します",
    "素材はProResを来週アップローダーで送ります",
    "納品希望日はまだ未定です",
    "参考URLはありません",
    "続けて必要な確認をお願いします",
  ]
  return followups[Math.min(turnIndex - 1, followups.length - 1)]
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
  events: EnduranceAuditEvent[]
  complete: boolean
}> {
  const { prisma } = await import("@/lib/prisma")
  const deadline = Date.now() + 60_000
  let lastEvents: EnduranceAuditEvent[] = []
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
  const conversationalRoles = messages
    .map((message) => message.role)
    .filter((role) => role === "user" || role === "assistant")
  return {
    messageCount: conversationalRoles.length,
    userTurnCount: conversationalRoles.filter((role) => role === "user").length,
    assistantTurnCount: conversationalRoles.filter((role) => role === "assistant").length,
    sequenceValid: conversationalRoles.every(
      (role, index) => role === (index % 2 === 0 ? "user" : "assistant"),
    ),
  }
}

function argValue(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name)
  return index >= 0 ? argv[index + 1]?.trim() || undefined : undefined
}

function parseTurnCount(value: string | undefined): number {
  if (!value) return 8
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 2 || parsed > 20) throw new Error("invalid_turn_count")
  return parsed
}

async function main() {
  const argv = process.argv.slice(2)
  const baseUrl = (argValue(argv, "--base-url") ?? "http://localhost:41238").replace(/\/+$/u, "")
  const requestedTurnCount = parseTurnCount(argValue(argv, "--turns"))
  const expectedBuildSha = await readBuildSha(baseUrl)
  const clientSessionId = randomUUID()
  const attempts: MessageAttempt[] = []
  let conversationId: string | undefined
  let previousPayload: z.infer<typeof messageSuccessSchema> | undefined
  let conversationStable = true

  for (let turnIndex = 0; turnIndex < requestedTurnCount; turnIndex += 1) {
    const clientUserMessageId = `client_msg_${randomUUID()}`
    const message = turnIndex === 0
      ? `HP-CHATBOT-ENDURANCE-${randomUUID()}: CM30秒のカラーグレーディング相談です`
      : nextCanaryMessage(turnIndex, previousPayload)
    const attempt = await postMessage(baseUrl, {
      message,
      clientSessionId,
      clientUserMessageId,
      ...(conversationId ? { conversationId } : {}),
    })
    attempts.push(attempt)
    if (!attempt.payload) break
    if (conversationId && attempt.payload.conversationId !== conversationId) conversationStable = false
    conversationId = attempt.payload.conversationId
    previousPayload = attempt.payload
  }

  const correlationIds = attempts.map((attempt) => attempt.requestId)
  const [auditObservation, conversationShape] = await Promise.all([
    pollAuditEvents(correlationIds),
    conversationId
      ? readConversationShape(conversationId)
      : Promise.resolve({ messageCount: 0, userTurnCount: 0, assistantTurnCount: 0, sequenceValid: false }),
  ])
  const report = evaluateEnduranceRun({
    expectedBuildSha,
    requestedTurnCount,
    turns: attempts.map(({ requestId, httpStatus, tier }) => ({ requestId, httpStatus, tier })),
    conversationStable,
    conversationShape,
    auditObservationComplete: auditObservation.complete,
    auditEvents: auditObservation.events,
  })
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  if (!report.ok) process.exitCode = 1
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "endurance_live_verification_failed"}\n`)
    process.exitCode = 1
  })
}
