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
}

export function evaluateChatbotAuditCompleteness(
  events: Array<{ eventName: string; result: string; uiKind?: string | null }>,
): ChatbotAuditCompleteness {
  const names = new Set(events.map((event) => event.eventName))
  const response = events.find((event) => event.eventName === "response_normalized")
  const required = [
    ...baseRequiredEvents,
    ...(response?.uiKind === "choice-panel" ? ["choice_panel_rendered"] : []),
    ...(response?.uiKind === "booking-card" ? ["booking_card_rendered", "booking_prefill_rendered"] : []),
    ...(response?.uiKind === "tier3-inquiry-form" ? ["fallback_ui_rendered"] : []),
  ]
  const missingEvents = required.filter((eventName) => !names.has(eventName))
  const failedEvents = events
    .filter((event) => event.result === "failure")
    .map((event) => event.eventName)

  return {
    status: failedEvents.length > 0 ? "failed" : missingEvents.length > 0 ? "pending" : "complete",
    eventCount: events.length,
    missingEvents,
    failedEvents,
  }
}
