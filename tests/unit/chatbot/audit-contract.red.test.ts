import { describe, expect, it } from "vitest"

import {
  bookingPrefillFieldNames,
  buildBookingPrefillFieldAudits,
  chatbotBrowserAuditEventSchema,
  chatbotServerAuditEventSchema,
  chatbotStoredAuditEventSchema,
} from "@/lib/chatbot/audit/contract"
import {
  toStoredChatbotAuditEvent,
  toStoredChatbotServerAuditEvent,
} from "@/lib/chatbot/audit/server-projection"

const correlationId = "11111111-1111-4111-8111-111111111111"
const eventId = "22222222-2222-4222-8222-222222222222"

describe("chatbot machine-readable audit contract", () => {
  it("accepts only allowlisted browser evidence and strips the raw conversation id before storage", () => {
    const browserEvent = chatbotBrowserAuditEventSchema.parse({
      schemaVersion: "1",
      eventId,
      eventName: "booking_prefill_rendered",
      correlationId,
      conversationId: "conversation_private_1",
      result: "success",
      uiKind: "booking-card",
      durationMs: 18,
      prefillFields: buildBookingPrefillFieldAudits({
        expected: {
          contactName: {
            filled: true,
            source: "conversation-confirmed",
            reason: "confirmed-in-chat",
          },
          agreed: {
            filled: false,
            source: "safety-default",
            reason: "requires-explicit-consent",
          },
        },
        actual: {
          projectTitle: false,
          dueDate: false,
          companyName: false,
          contactName: true,
          contactEmail: true,
          phone: false,
          memo: true,
          selectedSlots: false,
          agreed: false,
        },
      }),
      memoCoverage: {
        finalMedia: true,
        materialContents: true,
        materialTiming: true,
        materialMethod: true,
      },
    })

    const stored = toStoredChatbotAuditEvent(browserEvent, {
      buildSha: "abc123",
      createdAt: "2026-08-20T00:00:00.000Z",
    })

    expect(chatbotStoredAuditEventSchema.parse(stored)).toEqual(stored)
    expect(stored.conversationHash).toMatch(/^[a-f0-9]{64}$/)
    expect(stored.sequence).toBe(640)
    expect(stored).not.toHaveProperty("conversationId")
    expect(JSON.stringify(stored)).not.toContain("conversation_private_1")
    expect(stored.prefillFields).toHaveLength(bookingPrefillFieldNames.length)
  })

  it.each([
    ["customerEmail", "client@example.jp"],
    ["customerName", "顧客名"],
    ["message", "顧客本文"],
    ["prompt", "system prompt"],
    ["token", "secret"],
    ["notionThreadId", "thread_private"],
  ])("rejects forbidden browser payload key %s", (key, value) => {
    expect(() =>
      chatbotBrowserAuditEventSchema.parse({
        schemaVersion: "1",
        eventId,
        eventName: "booking_card_rendered",
        correlationId,
        conversationId: "conversation_private_1",
        result: "success",
        uiKind: "booking-card",
        [key]: value,
      }),
    ).toThrow()
  })

  it("creates a complete field-by-field prefill verdict and detects a mismatch", () => {
    const fields = buildBookingPrefillFieldAudits({
      expected: {
        contactEmail: {
          filled: true,
          source: "conversation-confirmed",
          reason: "confirmed-in-chat",
        },
      },
      actual: {
        projectTitle: false,
        dueDate: false,
        companyName: false,
        contactName: false,
        contactEmail: false,
        phone: false,
        memo: false,
        selectedSlots: false,
        agreed: false,
      },
    })

    expect(fields.map((field) => field.field)).toEqual(bookingPrefillFieldNames)
    expect(fields.find((field) => field.field === "contactEmail")).toMatchObject({
      expectedFilled: true,
      actualFilled: false,
      matches: false,
      source: "conversation-confirmed",
      reason: "confirmed-in-chat",
    })
    expect(fields.find((field) => field.field === "projectTitle")).toMatchObject({
      expectedFilled: false,
      actualFilled: false,
      matches: true,
      source: "unconfirmed",
      reason: "not-confirmed-in-chat",
    })
  })

  it("rejects incomplete or misplaced booking prefill evidence", () => {
    expect(() => chatbotBrowserAuditEventSchema.parse({
      schemaVersion: "1",
      eventId,
      eventName: "booking_prefill_rendered",
      correlationId,
      conversationId: "conversation_private_1",
      result: "success",
      uiKind: "booking-card",
      prefillFields: [],
    })).toThrow("booking_prefill_rendered_requires_every_prefill_field")

    expect(() => chatbotBrowserAuditEventSchema.parse({
      schemaVersion: "1",
      eventId,
      eventName: "choice_panel_rendered",
      correlationId,
      conversationId: "conversation_private_1",
      result: "success",
      uiKind: "choice-panel",
      memoCoverage: {
        finalMedia: true,
        materialContents: true,
        materialTiming: true,
        materialMethod: true,
      },
    })).toThrow("prefill_evidence_is_only_valid_for_booking_prefill_rendered")
  })

  it("projects a server tier attempt without retaining raw ids, errors, or diagnostics", () => {
    const serverEvent = chatbotServerAuditEventSchema.parse({
      schemaVersion: "1",
      eventId,
      eventName: "tier_attempt_completed",
      correlationId,
      conversationId: "conversation_private_1",
      result: "failure",
      tier: "tier-1-hosted-chrome-notion-ai",
      phase: "generate",
      durationMs: 54_000,
      errorCode: "timeout",
      errorReason: "missing-structured-ui",
      retryAttempt: 1,
      fallbackUsed: true,
      threadEvidence: {
        hiddenFromChatList: true,
        hideVerificationResult: "verified",
        postHideInferenceVerified: true,
        threadVersion: 2,
      },
    })

    const stored = toStoredChatbotServerAuditEvent(serverEvent, {
      buildSha: "abc123",
      createdAt: "2026-08-20T00:00:00.000Z",
      source: "server",
    })

    expect(chatbotStoredAuditEventSchema.parse(stored)).toEqual(stored)
    expect(stored.conversationHash).toMatch(/^[a-f0-9]{64}$/)
    expect(stored.sequence).toBe(201)
    expect(stored.errorReason).toBe("missing-structured-ui")
    expect(stored).not.toHaveProperty("conversationId")
    expect(JSON.stringify(stored)).not.toContain("conversation_private_1")
  })

  it("requires response Tier ordering and authenticated account-link evidence", () => {
    expect(() => chatbotServerAuditEventSchema.parse({
      schemaVersion: "1",
      eventId,
      eventName: "response_normalized",
      correlationId,
      conversationId: "conversation_private_1",
      result: "success",
      tier: "tier-1-hosted-chrome-notion-ai",
      tierAttemptCount: 1,
      finalTierConsistent: true,
    })).toThrow("response_normalized_requires_tier_integrity")

    expect(() => chatbotServerAuditEventSchema.parse({
      schemaVersion: "1",
      eventId,
      eventName: "customer_account_linked",
      correlationId,
      conversationId: "conversation_private_1",
      result: "success",
    })).toThrow("customer_account_linked_requires_account_evidence")
  })

  it("requires provider dedupe and acknowledgement evidence for successful Slack delivery", () => {
    expect(() => chatbotServerAuditEventSchema.parse({
      schemaVersion: "1",
      eventId,
      eventName: "slack_notification_completed",
      correlationId,
      conversationId: "conversation_private_1",
      result: "success",
    })).toThrow("successful_slack_notification_requires_delivery_evidence")
  })

  it.each([
    ["error", new Error("customer content")],
    ["diagnostics", { prompt: "secret prompt" }],
    ["rawText", "customer response"],
    ["sessionId", "session_private"],
  ])("rejects forbidden server payload key %s", (key, value) => {
    expect(() =>
      chatbotServerAuditEventSchema.parse({
        schemaVersion: "1",
        eventId,
        eventName: "tier_attempt_completed",
        correlationId,
        conversationId: "conversation_private_1",
        result: "failure",
        tier: "tier-1-hosted-chrome-notion-ai",
        phase: "generate",
        durationMs: 100,
        [key]: value,
      }),
    ).toThrow()
  })
})
