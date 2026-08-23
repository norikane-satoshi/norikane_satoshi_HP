import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"

import { evaluateChatbotAuditCompleteness } from "@/lib/chatbot/audit/completeness"
import {
  bookingPrefillFieldAuditSchema,
  bookingPrefillFieldNames,
  chatbotAuditStageTimingsSchema,
  chatbotMemoCoverageSchema,
  chatbotSlackDeliveryEvidenceSchema,
  type ChatbotAuditStageTimings,
  type ChatbotCustomerAccountEvidence,
  type ChatbotSlackDeliveryEvidence,
} from "@/lib/chatbot/audit/contract"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const querySchema = z.string().uuid()

export async function GET(request: NextRequest) {
  if (!isLoopbackHostname(request.nextUrl.hostname)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 })
  }
  const parsed = querySchema.safeParse(request.nextUrl.searchParams.get("correlationId"))
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  }

  const events = await prisma.chatbotAuditEvent.findMany({
    where: { correlationId: parsed.data },
    select: {
      eventName: true,
      result: true,
      uiKind: true,
      tier: true,
      durationMs: true,
      errorCode: true,
      source: true,
      buildSha: true,
      payloadJson: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
    take: 100,
  })
  const safeEvents = events.map((event) => ({
    ...event,
    ...readSafePayload(event.payloadJson),
  }))
  const completeness = evaluateChatbotAuditCompleteness(safeEvents)
  return NextResponse.json({
    correlationId: parsed.data,
    ...completeness,
    events: safeEvents.map((event) => ({
      eventName: event.eventName,
      result: event.result,
      uiKind: event.uiKind,
      tier: event.tier,
      durationMs: event.durationMs,
      errorCode: event.errorCode,
      ...(event.errorReason ? { errorReason: event.errorReason } : {}),
      source: event.source,
      buildSha: event.buildSha,
      ...(typeof event.sequence === "number" ? { sequence: event.sequence } : {}),
      ...(typeof event.phase === "string" ? { phase: event.phase } : {}),
      ...(typeof event.retryAttempt === "number" ? { retryAttempt: event.retryAttempt } : {}),
      ...(typeof event.fallbackUsed === "boolean" ? { fallbackUsed: event.fallbackUsed } : {}),
      ...(typeof event.finalTierConsistent === "boolean"
        ? { finalTierConsistent: event.finalTierConsistent }
        : {}),
      ...(typeof event.tierSequenceValid === "boolean"
        ? { tierSequenceValid: event.tierSequenceValid }
        : {}),
      ...(event.stageTimings ? { stageTimings: event.stageTimings } : {}),
      ...(event.prefillFields ? { prefillFields: event.prefillFields } : {}),
      ...(event.memoCoverage ? { memoCoverage: event.memoCoverage } : {}),
      ...(event.customerAccountEvidence
        ? { customerAccountEvidence: event.customerAccountEvidence }
        : {}),
      ...(event.slackDeliveryEvidence
        ? { slackDeliveryEvidence: event.slackDeliveryEvidence }
        : {}),
      createdAt: event.createdAt.toISOString(),
    })),
  })
}

type SafeAuditPayload = {
  sequence?: number
  phase?: string
  retryAttempt?: number
  fallbackUsed?: boolean
  finalTierConsistent?: boolean
  tierSequenceValid?: boolean
  stageTimings?: ChatbotAuditStageTimings
  prefillFields?: Array<z.infer<typeof bookingPrefillFieldAuditSchema>>
  memoCoverage?: z.infer<typeof chatbotMemoCoverageSchema>
  customerAccountEvidence?: ChatbotCustomerAccountEvidence
  slackDeliveryEvidence?: ChatbotSlackDeliveryEvidence
  errorReason?: string
}

function readSafePayload(payloadJson: string): SafeAuditPayload {
  try {
    const parsed = JSON.parse(payloadJson) as Record<string, unknown>
    return {
      ...(typeof parsed.sequence === "number" ? { sequence: parsed.sequence } : {}),
      ...(typeof parsed.phase === "string" ? { phase: parsed.phase } : {}),
      ...(typeof parsed.retryAttempt === "number" ? { retryAttempt: parsed.retryAttempt } : {}),
      ...(typeof parsed.fallbackUsed === "boolean" ? { fallbackUsed: parsed.fallbackUsed } : {}),
      ...(typeof parsed.finalTierConsistent === "boolean"
        ? { finalTierConsistent: parsed.finalTierConsistent }
        : {}),
      ...(typeof parsed.tierSequenceValid === "boolean"
        ? { tierSequenceValid: parsed.tierSequenceValid }
        : {}),
      ...(isSafeCode(parsed.errorReason) ? { errorReason: parsed.errorReason } : {}),
      ...readSafeStageTimings(parsed.stageTimings),
      ...readSafeBookingPrefillEvidence(parsed.prefillFields, parsed.memoCoverage),
      ...(isSafeCustomerAccountEvidence(parsed.customerAccountEvidence)
        ? { customerAccountEvidence: parsed.customerAccountEvidence }
        : {}),
      ...readSafeSlackDeliveryEvidence(parsed.slackDeliveryEvidence),
    }
  } catch {
    return {}
  }
}

const safePrefillFieldsSchema = z.array(bookingPrefillFieldAuditSchema)
  .length(bookingPrefillFieldNames.length)
  .refine(
    (fields) => new Set(fields.map((field) => field.field)).size === bookingPrefillFieldNames.length,
    "booking_prefill_fields_must_be_unique",
  )

function readSafeBookingPrefillEvidence(
  fields: unknown,
  memoCoverage: unknown,
): Pick<SafeAuditPayload, "prefillFields" | "memoCoverage"> {
  const parsedFields = safePrefillFieldsSchema.safeParse(fields)
  const parsedMemoCoverage = chatbotMemoCoverageSchema.safeParse(memoCoverage)
  return {
    ...(parsedFields.success ? { prefillFields: parsedFields.data } : {}),
    ...(parsedMemoCoverage.success ? { memoCoverage: parsedMemoCoverage.data } : {}),
  }
}

function isSafeCode(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9][a-z0-9_.:-]{0,119}$/i.test(value)
}

function readSafeSlackDeliveryEvidence(
  value: unknown,
): Pick<SafeAuditPayload, "slackDeliveryEvidence"> {
  const parsed = chatbotSlackDeliveryEvidenceSchema.safeParse(value)
  return parsed.success ? { slackDeliveryEvidence: parsed.data } : {}
}

function readSafeStageTimings(value: unknown): Pick<SafeAuditPayload, "stageTimings"> {
  const parsed = chatbotAuditStageTimingsSchema.safeParse(value)
  return parsed.success ? { stageTimings: parsed.data } : {}
}

function isSafeCustomerAccountEvidence(value: unknown): value is {
  authenticated: boolean
  expectedLinked: boolean
  actualLinked: boolean
  matches: boolean
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const evidence = value as Record<string, unknown>
  return ["authenticated", "expectedLinked", "actualLinked", "matches"]
    .every((key) => typeof evidence[key] === "boolean")
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase().replace(/^\[(.*)\]$/, "$1")
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1"
}
