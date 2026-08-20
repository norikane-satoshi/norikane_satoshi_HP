import { describe, expect, it } from "vitest"

import { assertChatbotStateContracts, chatbotStateContracts } from "@/lib/chatbot/audit/state-contract"

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
      if (contract.domain === "booking") {
        expect(contract.retainedDays).toBeNull()
      } else {
        expect(contract.retainedDays).toBe(30)
      }
    }
  })
})
