import { after } from "next/server"

import type { ChatbotStoredAuditEvent } from "@/lib/chatbot/audit/contract"
import { recordChatbotAuditEvent } from "@/lib/chatbot/audit/store"

export function scheduleChatbotAuditPersistence(events: ChatbotStoredAuditEvent[]): void {
  after(() => persistChatbotAuditEvents(events))
}

// For events that can only be built once work still running after the response has finished.
export function scheduleDeferredChatbotAuditPersistence(
  buildEvents: () => Promise<ChatbotStoredAuditEvent[]>,
): void {
  after(async () => {
    try {
      await persistChatbotAuditEvents(await buildEvents())
    } catch (error) {
      console.error("[chatbot audit persistence failed]", {
        stage: "build",
        errorName: error instanceof Error ? error.name : typeof error,
      })
    }
  })
}

async function persistChatbotAuditEvents(events: ChatbotStoredAuditEvent[]): Promise<void> {
  const results = await Promise.allSettled(events.map((event) => recordChatbotAuditEvent(event)))
  const failedEventIds = results.flatMap((result, index) =>
    result.status === "rejected" ? [events[index].eventId] : [],
  )
  if (failedEventIds.length > 0) {
    console.error("[chatbot audit persistence failed]", {
      failedEventIds,
      eventCount: events.length,
      schemaVersion: events[0]?.schemaVersion ?? "unknown",
    })
  }
}
