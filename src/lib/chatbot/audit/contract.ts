import { z } from "zod"

export const chatbotAuditSchemaVersion = "1" as const

export const bookingPrefillFieldNames = [
  "projectTitle",
  "dueDate",
  "companyName",
  "contactName",
  "contactEmail",
  "phone",
  "memo",
  "selectedSlots",
  "agreed",
] as const

export const chatbotBrowserAuditEventNames = [
  "customer_display_name_applied",
  "assistant_display_name_applied",
  "choice_panel_rendered",
  "booking_card_rendered",
  "booking_prefill_rendered",
  "booking_submit_success_rendered",
  "fallback_ui_rendered",
] as const

export const chatbotServerAuditEventNames = [
  "request_received",
  "tier_attempt_completed",
  "response_normalized",
  "conversation_persisted",
  "slack_notification_completed",
  "booking_created",
  "customer_account_linked",
  "notion_thread_hidden_verified",
  "operation_failed",
] as const

export const chatbotAuditEventNames = [
  ...chatbotBrowserAuditEventNames,
  ...chatbotServerAuditEventNames,
] as const

const safeCodeSchema = z.string().trim().regex(/^[a-z0-9][a-z0-9_.:-]{0,119}$/i)
const durationSchema = z.number().int().nonnegative().max(180_000)
const eventIdSchema = z.string().uuid()
const correlationIdSchema = z.string().uuid()
const conversationIdSchema = z.string().trim().min(1).max(160)
const conversationHashSchema = z.string().regex(/^[a-f0-9]{64}$/)
const buildShaSchema = z.string().trim().min(1).max(64).regex(/^[a-z0-9._-]+$/i)

export const chatbotAuditTierSchema = z.enum([
  "tier-1-hosted-chrome-notion-ai",
  "tier-2-gemini-flash",
  "tier-3-form-fallback",
])

export const chatbotAuditUiKindSchema = z.enum([
  "none",
  "choice-panel",
  "booking-card",
  "direct-contact-card",
  "consultation-summary-form",
  "tier3-inquiry-form",
])

export const bookingPrefillFieldAuditSchema = z
  .object({
    field: z.enum(bookingPrefillFieldNames),
    expectedFilled: z.boolean(),
    actualFilled: z.boolean(),
    matches: z.boolean(),
    source: z.enum([
      "conversation-confirmed",
      "conversation-derived",
      "unconfirmed",
      "safety-default",
    ]),
    reason: z.enum([
      "confirmed-in-chat",
      "derived-from-conversation-summary",
      "not-confirmed-in-chat",
      "requires-explicit-consent",
      "no-schedule-selected",
    ]),
  })
  .strict()

export type BookingPrefillFieldAudit = z.infer<typeof bookingPrefillFieldAuditSchema>
export type BookingPrefillFieldName = (typeof bookingPrefillFieldNames)[number]

const memoCoverageSchema = z
  .object({
    finalMedia: z.boolean(),
    materialContents: z.boolean(),
    materialTiming: z.boolean(),
    materialMethod: z.boolean(),
  })
  .strict()

const messageIntegritySchema = z
  .object({
    userTurnCount: z.number().int().nonnegative(),
    assistantTurnCount: z.number().int().nonnegative(),
    messageCount: z.number().int().nonnegative(),
    sequenceValid: z.boolean(),
  })
  .strict()

const customerAccountEvidenceSchema = z
  .object({
    authenticated: z.boolean(),
    expectedLinked: z.boolean(),
    actualLinked: z.boolean(),
    matches: z.boolean(),
  })
  .strict()

export const chatbotSlackDeliveryEvidenceSchema = z
  .object({
    deliveries: z.array(z.object({
      kind: z.enum(["conversation", "issue", "booking-order-submitted", "message-edit"]),
      idempotencyKeyHash: conversationHashSchema.optional(),
      providerDedupeKeySubmitted: z.boolean(),
      providerMessageTsPresent: z.boolean(),
    }).strict()).min(1).max(3),
    uniqueIdempotencyKeys: z.boolean(),
  })
  .strict()

export const chatbotAuditStageTimingsSchema = z
  .object({
    conversationLoad: durationSchema.optional(),
    contextPreparation: durationSchema.optional(),
    tierHealthCheck: durationSchema.optional(),
    workerQueueWait: durationSchema.optional(),
    cdpTargetSession: durationSchema.optional(),
    runtimeContextPreparation: durationSchema.optional(),
    promptToFirstChunk: durationSchema.optional(),
    responseStreaming: durationSchema.optional(),
    outputValidation: durationSchema.optional(),
    threadPreparation: durationSchema.optional(),
    threadHideVerification: durationSchema.optional(),
    notionInference: durationSchema.optional(),
    responseNormalization: durationSchema.optional(),
    conversationPersist: durationSchema.optional(),
    slackNotification: durationSchema.optional(),
    networkRoundTrip: durationSchema.optional(),
    reactCommit: durationSchema.optional(),
    totalServer: durationSchema.optional(),
  })
  .strict()

export const chatbotAuditThreadEvidenceSchema = z
  .object({
    hiddenFromChatList: z.boolean(),
    hideVerificationResult: safeCodeSchema,
    postHideInferenceVerified: z.boolean(),
    threadVersion: z.number().int().positive().optional(),
  })
  .strict()

const sharedAuditFields = {
  schemaVersion: z.literal(chatbotAuditSchemaVersion),
  eventId: eventIdSchema,
  correlationId: correlationIdSchema,
  result: z.enum(["success", "failure"]),
  tier: chatbotAuditTierSchema.optional(),
  uiKind: chatbotAuditUiKindSchema.optional(),
  durationMs: durationSchema.optional(),
  errorCode: safeCodeSchema.optional(),
  errorReason: safeCodeSchema.optional(),
  phase: z.enum(["health-check", "generate", "render", "persist", "notify"]).optional(),
  fallbackUsed: z.boolean().optional(),
  retryAttempt: z.number().int().positive().max(10).optional(),
  repairAttempted: z.boolean().optional(),
  prefillFields: z.array(bookingPrefillFieldAuditSchema).max(bookingPrefillFieldNames.length).optional(),
  memoCoverage: memoCoverageSchema.optional(),
  stageTimings: chatbotAuditStageTimingsSchema.optional(),
  threadEvidence: chatbotAuditThreadEvidenceSchema.optional(),
  messageIntegrity: messageIntegritySchema.optional(),
  tierAttemptCount: z.number().int().nonnegative().optional(),
  finalTierConsistent: z.boolean().optional(),
  tierSequenceValid: z.boolean().optional(),
  customerAccountEvidence: customerAccountEvidenceSchema.optional(),
  slackDeliveryEvidence: chatbotSlackDeliveryEvidenceSchema.optional(),
}

export const chatbotBrowserAuditEventSchema = z
  .object({
    ...sharedAuditFields,
    eventName: z.enum(chatbotBrowserAuditEventNames),
    conversationId: conversationIdSchema,
  })
  .strict()
  .superRefine((event, context) => {
    if (event.eventName === "booking_prefill_rendered") {
      if (event.prefillFields?.length !== bookingPrefillFieldNames.length) {
        context.addIssue({
          code: "custom",
          path: ["prefillFields"],
          message: "booking_prefill_rendered_requires_every_prefill_field",
        })
      }
      if (new Set(event.prefillFields?.map((field) => field.field)).size !== bookingPrefillFieldNames.length) {
        context.addIssue({
          code: "custom",
          path: ["prefillFields"],
          message: "booking_prefill_rendered_requires_unique_prefill_fields",
        })
      }
      if (!event.memoCoverage) {
        context.addIssue({
          code: "custom",
          path: ["memoCoverage"],
          message: "booking_prefill_rendered_requires_memo_coverage",
        })
      }
    } else if (event.prefillFields || event.memoCoverage) {
      context.addIssue({
        code: "custom",
        message: "prefill_evidence_is_only_valid_for_booking_prefill_rendered",
      })
    }
    if (
      event.messageIntegrity ||
      event.tierAttemptCount !== undefined ||
      event.finalTierConsistent !== undefined ||
      event.tierSequenceValid !== undefined ||
      event.customerAccountEvidence ||
      event.slackDeliveryEvidence
    ) {
      context.addIssue({
        code: "custom",
        message: "server_integrity_evidence_is_not_accepted_from_browser",
      })
    }
  })

export const chatbotServerAuditEventSchema = z
  .object({
    ...sharedAuditFields,
    eventName: z.enum(chatbotServerAuditEventNames),
    conversationId: conversationIdSchema,
  })
  .strict()
  .superRefine((event, context) => {
    if (event.eventName === "conversation_persisted" && !event.messageIntegrity) {
      context.addIssue({
        code: "custom",
        path: ["messageIntegrity"],
        message: "conversation_persisted_requires_message_integrity",
      })
    }
    if (
      event.eventName === "response_normalized" &&
      (event.tierAttemptCount === undefined || event.finalTierConsistent === undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "response_normalized_requires_tier_integrity",
      })
    }
    if (event.eventName === "response_normalized" && event.tierSequenceValid === undefined) {
      context.addIssue({
        code: "custom",
        path: ["tierSequenceValid"],
        message: "response_normalized_requires_tier_integrity",
      })
    }
    if (event.eventName === "customer_account_linked" && !event.customerAccountEvidence) {
      context.addIssue({
        code: "custom",
        path: ["customerAccountEvidence"],
        message: "customer_account_linked_requires_account_evidence",
      })
    }
    if (event.eventName !== "customer_account_linked" && event.customerAccountEvidence) {
      context.addIssue({
        code: "custom",
        path: ["customerAccountEvidence"],
        message: "account_evidence_is_only_valid_for_customer_account_linked",
      })
    }
    if (
      event.eventName === "slack_notification_completed" &&
      event.result === "success" &&
      (!event.slackDeliveryEvidence ||
        !event.slackDeliveryEvidence.uniqueIdempotencyKeys ||
        event.slackDeliveryEvidence.deliveries.some(
          (delivery) =>
            !delivery.idempotencyKeyHash ||
            !delivery.providerDedupeKeySubmitted ||
            !delivery.providerMessageTsPresent,
        ))
    ) {
      context.addIssue({
        code: "custom",
        path: ["slackDeliveryEvidence"],
        message: "successful_slack_notification_requires_delivery_evidence",
      })
    }
    if (event.eventName !== "slack_notification_completed" && event.slackDeliveryEvidence) {
      context.addIssue({
        code: "custom",
        path: ["slackDeliveryEvidence"],
        message: "slack_delivery_evidence_is_only_valid_for_slack_notification_completed",
      })
    }
  })

export const chatbotStoredAuditEventSchema = z
  .object({
    ...sharedAuditFields,
    eventName: z.enum(chatbotAuditEventNames),
    source: z.enum(["browser", "server", "hosted-worker"]),
    sequence: z.number().int().nonnegative().max(10_000),
    conversationHash: conversationHashSchema,
    buildSha: buildShaSchema,
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict()

export type ChatbotBrowserAuditEvent = z.infer<typeof chatbotBrowserAuditEventSchema>
export type ChatbotServerAuditEvent = z.infer<typeof chatbotServerAuditEventSchema>
export type ChatbotStoredAuditEvent = z.infer<typeof chatbotStoredAuditEventSchema>
export type ChatbotAuditStageTimings = z.infer<typeof chatbotAuditStageTimingsSchema>
export type ChatbotMessageIntegrity = z.infer<typeof messageIntegritySchema>
export type ChatbotCustomerAccountEvidence = z.infer<typeof customerAccountEvidenceSchema>
export type ChatbotSlackDeliveryEvidence = z.infer<typeof chatbotSlackDeliveryEvidenceSchema>

type ExpectedPrefillField = Pick<BookingPrefillFieldAudit, "source" | "reason"> & {
  filled: boolean
}

export function buildBookingPrefillFieldAudits(input: {
  expected: Partial<Record<BookingPrefillFieldName, ExpectedPrefillField>>
  actual: Record<BookingPrefillFieldName, boolean>
}): BookingPrefillFieldAudit[] {
  return bookingPrefillFieldNames.map((field) => {
    const expected = input.expected[field] ?? {
      filled: false,
      source: "unconfirmed" as const,
      reason: "not-confirmed-in-chat" as const,
    }
    const actualFilled = input.actual[field]
    return bookingPrefillFieldAuditSchema.parse({
      field,
      expectedFilled: expected.filled,
      actualFilled,
      matches: expected.filled === actualFilled,
      source: expected.source,
      reason: expected.reason,
    })
  })
}
