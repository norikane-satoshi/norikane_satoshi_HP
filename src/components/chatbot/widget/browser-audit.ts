import {
  bookingPrefillFieldNames,
  buildBookingPrefillFieldAudits,
  chatbotBrowserAuditEventSchema,
  type BookingPrefillFieldName,
  type ChatbotBrowserAuditEvent,
} from "@/lib/chatbot/audit/contract"

type BrowserAuditFetch = typeof fetch

export type ChatbotRenderAuditContext = {
  correlationId: string
  tier: ChatbotBrowserAuditEvent["tier"]
  responseReceivedAt: number
}

export function createChatbotBrowserAuditEventId(): string {
  return crypto.randomUUID()
}

export async function postChatbotBrowserAuditEvent(
  rawEvent: ChatbotBrowserAuditEvent,
  options: { fetcher?: BrowserAuditFetch } = {},
): Promise<void> {
  const event = chatbotBrowserAuditEventSchema.parse(rawEvent)
  const fetcher = options.fetcher ?? fetch
  let lastStatus: number | undefined

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetcher("/api/chatbot/audit-event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(event),
        keepalive: true,
      })
      if (response.ok) return
      lastStatus = response.status
    } catch {
      lastStatus = undefined
    }
  }

  throw new Error(lastStatus ? `chatbot_audit_http_${lastStatus}` : "chatbot_audit_network_failure")
}

export function buildBrowserBookingPrefillAudit(input: {
  expectedFilled: Record<BookingPrefillFieldName, boolean>
  actualFilled: Record<BookingPrefillFieldName, boolean>
}) {
  const expected = Object.fromEntries(
    bookingPrefillFieldNames.map((field) => [
      field,
      expectedFieldContract(field, input.expectedFilled[field]),
    ]),
  )

  return buildBookingPrefillFieldAudits({ expected, actual: input.actualFilled })
}

export function evaluateBrowserBookingPrefillResult(input: {
  prefillFields: ReturnType<typeof buildBrowserBookingPrefillAudit>
  memoCoverage: {
    finalMedia: boolean
    materialContents: boolean
    materialTiming: boolean
    materialMethod: boolean
  }
}): "success" | "failure" {
  return input.prefillFields.every((field) => field.matches) &&
    Object.values(input.memoCoverage).every(Boolean)
    ? "success"
    : "failure"
}

function expectedFieldContract(field: BookingPrefillFieldName, filled: boolean) {
  if (filled) {
    return {
      filled: true,
      source: "conversation-derived" as const,
      reason: "derived-from-conversation-summary" as const,
    }
  }
  if (field === "agreed") {
    return {
      filled: false,
      source: "safety-default" as const,
      reason: "requires-explicit-consent" as const,
    }
  }
  if (field === "selectedSlots") {
    return {
      filled: false,
      source: "unconfirmed" as const,
      reason: "no-schedule-selected" as const,
    }
  }
  return {
    filled: false,
    source: "unconfirmed" as const,
    reason: "not-confirmed-in-chat" as const,
  }
}
