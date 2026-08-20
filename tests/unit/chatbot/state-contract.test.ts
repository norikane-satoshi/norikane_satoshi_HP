import { describe, expect, it } from "vitest"

import {
  assertChatbotStateContracts,
  chatbotStateContracts,
  chatbotStateFieldContracts,
} from "@/lib/chatbot/audit/state-contract"

describe("chatbot canonical state contract", () => {
  it("has one canonical authority per state domain", () => {
    expect(() => assertChatbotStateContracts()).not.toThrow()
    expect(new Set(chatbotStateContracts.map((contract) => contract.domain)).size).toBe(chatbotStateContracts.length)
  })

  it("keeps Slack as delivery rather than a second source of truth", () => {
    const notification = chatbotStateContracts.find((contract) => contract.domain === "notification")
    expect(notification).toMatchObject({
      authority: "hp-db.ChatbotAuditEvent",
      writers: ["chatbot-audit-store"],
      mayContainCustomerContent: false,
    })
  })

  it("gives every customer-content store an explicit retention policy or durable business-record marker", () => {
    for (const contract of chatbotStateContracts.filter((entry) => entry.mayContainCustomerContent)) {
      if (contract.domain === "booking-order") {
        expect(contract.retainedDays).toBeNull()
      } else {
        expect(contract.retainedDays).toBe(30)
      }
    }
  })

  it("classifies canonical, derived, and retired fields without duplicate authorities", () => {
    expect(new Set(chatbotStateFieldContracts.map((field) => field.field)).size).toBe(chatbotStateFieldContracts.length)
    expect(chatbotStateFieldContracts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        field: "ChatbotConversation.conversationState",
        role: "canonical",
        authority: "hp-db.ChatbotConversation.conversationState",
      }),
      expect.objectContaining({
        field: "ChatbotConversation.finalMedium",
        semanticKey: "conversation.job-context.finalMedium",
        role: "canonical",
        authority: "hp-db.ChatbotConversation.finalMedium",
      }),
      expect.objectContaining({
        field: "ChatbotConversation.conversationState.durationContext.workflowFacts.finalMedium",
        semanticKey: "conversation.job-context.finalMedium",
        role: "derived-projection",
        authority: "hp-db.ChatbotConversation.finalMedium",
      }),
      expect.objectContaining({
        field: "ChatbotConversation.bookingId",
        role: "derived-reference",
        authority: "hp-db.BookingGroup.chatConversationId",
      }),
      expect.objectContaining({
        field: "notion-thread-url",
        role: "secret-reference",
        authority: "hosted-worker.thread-store",
      }),
    ]))
  })
})
