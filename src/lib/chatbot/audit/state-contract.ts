import { z } from "zod"

const stateContractSchema = z.object({
  domain: z.enum([
    "conversation",
    "browser-ui",
    "notion-thread",
    "booking",
    "audit",
    "notification",
  ]),
  authority: z.string().min(1),
  writers: z.array(z.string().min(1)).min(1),
  retainedDays: z.number().int().positive().nullable(),
  mayContainCustomerContent: z.boolean(),
}).strict()

export const chatbotStateContracts = [
  {
    domain: "conversation",
    authority: "hp-db.ChatbotConversation",
    writers: ["chatbot-message-server"],
    retainedDays: 30,
    mayContainCustomerContent: true,
  },
  {
    domain: "browser-ui",
    authority: "browser.session-storage",
    writers: ["chatbot-widget"],
    retainedDays: 30,
    mayContainCustomerContent: true,
  },
  {
    domain: "notion-thread",
    authority: "hosted-worker.thread-store",
    writers: ["tier-1-hosted-worker"],
    retainedDays: 30,
    mayContainCustomerContent: true,
  },
  {
    domain: "booking",
    authority: "hp-db.BookingGroup",
    writers: ["booking-service"],
    retainedDays: null,
    mayContainCustomerContent: true,
  },
  {
    domain: "audit",
    authority: "hp-db.ChatbotAuditEvent",
    writers: ["chatbot-audit-store"],
    retainedDays: 30,
    mayContainCustomerContent: false,
  },
  {
    domain: "notification",
    authority: "hp-db.ChatbotAuditEvent",
    writers: ["chatbot-audit-store"],
    retainedDays: 30,
    mayContainCustomerContent: false,
  },
] as const

export function assertChatbotStateContracts(): void {
  const parsed = chatbotStateContracts.map((contract) => stateContractSchema.parse(contract))
  const domains = parsed.map((contract) => contract.domain)
  if (new Set(domains).size !== domains.length) throw new Error("duplicate_chatbot_state_domain")
  for (const contract of parsed) {
    if (!contract.mayContainCustomerContent && contract.retainedDays !== 30) {
      throw new Error(`invalid_privacy_retention:${contract.domain}`)
    }
  }
}
