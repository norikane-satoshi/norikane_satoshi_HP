import { z } from "zod"

const stateContractSchema = z.object({
  domain: z.enum([
    "conversation",
    "conversation-state",
    "browser-ui",
    "notion-thread-map",
    "booking-order",
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
    domain: "conversation-state",
    authority: "hp-db.ChatbotConversation.conversationState",
    writers: ["chatbot-message-server"],
    retainedDays: 30,
    mayContainCustomerContent: true,
  },
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
    domain: "notion-thread-map",
    authority: "hosted-worker.thread-store",
    writers: ["tier-1-hosted-worker"],
    retainedDays: 30,
    mayContainCustomerContent: true,
  },
  {
    domain: "booking-order",
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

const stateFieldContractSchema = z.object({
  field: z.string().min(1),
  semanticKey: z.string().min(1),
  role: z.enum(["canonical", "derived-projection", "derived-reference", "secret-reference"]),
  authority: z.string().min(1),
  writer: z.string().min(1),
}).strict()

export const chatbotStateFieldContracts = [
  {
    field: "ChatbotConversation.messages",
    semanticKey: "conversation.messages",
    role: "canonical",
    authority: "hp-db.ChatbotMessage",
    writer: "chatbot-message-server",
  },
  {
    field: "ChatbotConversation.conversationState",
    semanticKey: "conversation.flow-state",
    role: "canonical",
    authority: "hp-db.ChatbotConversation.conversationState",
    writer: "chatbot-message-server",
  },
  ...(["finalMedium", "jobType", "mainDuration", "workSite", "attachments", "additionalWork", "referenceUrls"] as const)
    .map((field) => ({
    field: `ChatbotConversation.${field}`,
    semanticKey: `conversation.job-context.${field}`,
    role: "canonical" as const,
    authority: `hp-db.ChatbotConversation.${field}`,
    writer: "chatbot-repository",
  })),
  ...([
    ["finalMedium", "finalMedium"],
    ["jobType", "jobKind"],
    ["mainDuration", "projectLengthMinutes"],
    ["workSite", "workSite"],
    ["additionalWork", "additionalWork"],
  ] as const).map(([canonicalField, projectedField]) => ({
    field: `ChatbotConversation.conversationState.durationContext.workflowFacts.${projectedField}`,
    semanticKey: `conversation.job-context.${canonicalField}`,
    role: "derived-projection" as const,
    authority: `hp-db.ChatbotConversation.${canonicalField}`,
    writer: "chatbot-duration-context-projection",
  })),
  {
    field: "ChatbotConversation.bookingId",
    semanticKey: "booking.reference",
    role: "derived-reference",
    authority: "hp-db.BookingGroup.chatConversationId",
    writer: "booking-service",
  },
  {
    field: "BookingGroup",
    semanticKey: "booking.record",
    role: "canonical",
    authority: "hp-db.BookingGroup",
    writer: "booking-service",
  },
  {
    field: "notion-thread-url",
    semanticKey: "notion.thread-reference",
    role: "secret-reference",
    authority: "hosted-worker.thread-store",
    writer: "tier-1-hosted-worker",
  },
  {
    field: "ChatbotAuditEvent",
    semanticKey: "audit.event",
    role: "canonical",
    authority: "hp-db.ChatbotAuditEvent",
    writer: "chatbot-audit-store",
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
  const fields = chatbotStateFieldContracts.map((field) => stateFieldContractSchema.parse(field))
  if (new Set(fields.map((field) => field.field)).size !== fields.length) {
    throw new Error("duplicate_chatbot_state_field")
  }
  for (const semanticKey of new Set(fields.map((field) => field.semanticKey))) {
    const canonicalCount = fields.filter(
      (field) => field.semanticKey === semanticKey && field.role === "canonical",
    ).length
    const referenceOnly = fields
      .filter((field) => field.semanticKey === semanticKey)
      .every((field) => field.role === "derived-reference" || field.role === "secret-reference")
    if (!referenceOnly && canonicalCount !== 1) {
      throw new Error(`invalid_canonical_authority_count:${semanticKey}:${canonicalCount}`)
    }
  }
}
