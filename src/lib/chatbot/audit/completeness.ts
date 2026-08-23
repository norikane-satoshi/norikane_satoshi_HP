const baseRequiredEvents = [
  "request_received",
  "response_normalized",
  "conversation_persisted",
  "slack_notification_completed",
] as const

export type ChatbotAuditCompleteness = {
  status: "complete" | "pending" | "failed"
  eventCount: number
  missingEvents: string[]
  failedEvents: string[]
  duplicateEvents: string[]
  integrityViolations: string[]
}

type CompletenessEvent = {
  eventName: string
  result: string
  uiKind?: string | null
  tier?: string | null
  phase?: string | null
  retryAttempt?: number | null
  sequence?: number | null
  fallbackUsed?: boolean | null
  repairAttempted?: boolean | null
  finalTierConsistent?: boolean | null
  tierSequenceValid?: boolean | null
  customerAccountEvidence?: {
    authenticated: boolean
    expectedLinked: boolean
    actualLinked: boolean
    matches: boolean
  } | null
  slackDeliveryEvidence?: {
    deliveries: Array<{
      idempotencyKeyHash?: string
      providerDedupeKeySubmitted: boolean
      providerMessageTsPresent: boolean
    }>
    uniqueIdempotencyKeys: boolean
  } | null
}

export function evaluateChatbotAuditCompleteness(
  events: CompletenessEvent[],
): ChatbotAuditCompleteness {
  const names = new Set(events.map((event) => event.eventName))
  const response = events.find((event) => event.eventName === "response_normalized")
  const required = [
    ...baseRequiredEvents,
    "tier_attempt_completed",
    ...(response?.tier === "tier-1-hosted-chrome-notion-ai" ? ["notion_thread_hidden_verified"] : []),
    ...(response?.uiKind === "choice-panel" ? ["choice_panel_rendered"] : []),
    ...(response?.uiKind === "booking-card" ? ["booking_card_rendered", "booking_prefill_rendered"] : []),
    ...(response?.uiKind === "tier3-inquiry-form" ? ["fallback_ui_rendered"] : []),
    ...(names.has("booking_created") ? ["customer_account_linked", "booking_submit_success_rendered"] : []),
  ]
  const missingEvents = required.filter((eventName) => !names.has(eventName))
  const failedEvents = events
    .filter((event) => event.result === "failure" && !isExpectedFallbackFailure(event, response?.tier, events))
    .map((event) => event.eventName)
  const duplicateEvents = singletonEventNames.filter(
    (eventName) => events.filter((event) => event.eventName === eventName).length > 1,
  )
  const integrityViolations = [
    ...(events.some((event) => event.sequence === undefined || event.sequence === null)
      ? ["event-sequence-missing"]
      : []),
    ...(events.some((event) => event.sequence !== undefined && event.sequence !== null && event.sequence !== expectedSequence(event))
      ? ["event-sequence-invalid"]
      : []),
    ...(response && (response.finalTierConsistent !== true || response.tierSequenceValid !== true)
      ? ["tier-sequence-invalid"]
      : []),
    ...(hasInvalidRepairEvidence(events) ? ["repair-evidence-invalid"] : []),
    ...events
      .filter((event) => event.eventName === "customer_account_linked" && event.customerAccountEvidence?.matches !== true)
      .map(() => "customer-account-link-mismatch"),
    ...events
      .filter((event) =>
        event.eventName === "slack_notification_completed" &&
        event.result === "success" &&
        !hasExactlyOnceSlackEvidence(event.slackDeliveryEvidence),
      )
      .map(() => "slack-delivery-not-exactly-once"),
  ]

  return {
    status:
      failedEvents.length > 0 || duplicateEvents.length > 0 || integrityViolations.length > 0
        ? "failed"
        : missingEvents.length > 0
          ? "pending"
          : "complete",
    eventCount: events.length,
    missingEvents,
    failedEvents,
    duplicateEvents,
    integrityViolations,
  }
}

function hasExactlyOnceSlackEvidence(
  evidence: CompletenessEvent["slackDeliveryEvidence"],
): boolean {
  return Boolean(
    evidence &&
    evidence.uniqueIdempotencyKeys &&
    evidence.deliveries.length > 0 &&
    evidence.deliveries.every((delivery) =>
      Boolean(
        delivery.idempotencyKeyHash &&
        delivery.providerDedupeKeySubmitted &&
        delivery.providerMessageTsPresent,
      ),
    ),
  )
}

const singletonEventNames = [
  "request_received",
  "response_normalized",
  "conversation_persisted",
  "choice_panel_rendered",
  "booking_card_rendered",
  "booking_prefill_rendered",
  "fallback_ui_rendered",
  "booking_created",
  "customer_account_linked",
  "booking_submit_success_rendered",
] as const

function isExpectedFallbackFailure(
  event: CompletenessEvent,
  finalTier: string | null | undefined,
  events: CompletenessEvent[],
): boolean {
  if (event.eventName === "tier_attempt_completed") {
    if (finalTier !== event.tier) return true
    return event.phase === "generate" &&
      event.repairAttempted === true &&
      events.some((candidate) =>
        candidate.eventName === "tier_attempt_completed" &&
        candidate.phase === "generate" &&
        candidate.tier === event.tier &&
        candidate.result === "success" &&
        candidate.repairAttempted === true &&
        (candidate.sequence ?? -1) > (event.sequence ?? Number.MAX_SAFE_INTEGER),
      )
  }
  if (event.eventName === "notion_thread_hidden_verified") {
    return finalTier !== "tier-1-hosted-chrome-notion-ai"
  }
  return false
}

function hasInvalidRepairEvidence(events: CompletenessEvent[]): boolean {
  const repairedEvents = events.filter(
    (event) => event.eventName === "tier_attempt_completed" && event.repairAttempted === true,
  )
  if (repairedEvents.length === 0) return false

  return repairedEvents.some((event) => {
    const pairedFailure = repairedEvents.some((candidate) =>
      candidate.phase === "generate" &&
      candidate.tier === event.tier &&
      candidate.result === "failure" &&
      (candidate.sequence ?? Number.MAX_SAFE_INTEGER) < (event.sequence ?? -1),
    )
    const pairedSuccess = repairedEvents.some((candidate) =>
      candidate.phase === "generate" &&
      candidate.tier === event.tier &&
      candidate.result === "success" &&
      (candidate.sequence ?? -1) > (event.sequence ?? Number.MAX_SAFE_INTEGER),
    )
    return event.result === "failure" ? !pairedSuccess : !pairedFailure
  })
}

function expectedSequence(event: CompletenessEvent): number {
  const retry = Math.max(1, Math.min(99, event.retryAttempt ?? 1))
  switch (event.eventName) {
    case "request_received": return 100
    case "tier_attempt_completed": return (event.phase === "health-check" ? 150 : 200) + retry
    case "notion_thread_hidden_verified": return 250 + retry
    case "response_normalized": return 300
    case "conversation_persisted": return 400
    case "slack_notification_completed": return 500
    case "customer_display_name_applied": return 600
    case "assistant_display_name_applied": return 610
    case "choice_panel_rendered": return 620
    case "booking_card_rendered": return 630
    case "booking_prefill_rendered": return 640
    case "fallback_ui_rendered": return 650
    case "booking_created": return 700
    case "customer_account_linked": return 710
    case "booking_submit_success_rendered": return 800
    case "operation_failed": return 900
    default: return -1
  }
}
