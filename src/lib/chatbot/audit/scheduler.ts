import { after } from "next/server"

import type { ChatbotStoredAuditEvent } from "@/lib/chatbot/audit/contract"
import { recordChatbotAuditEvent } from "@/lib/chatbot/audit/store"

export function scheduleChatbotAuditPersistence(events: ChatbotStoredAuditEvent[]): void {
  after(async () => {
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
  })
}
