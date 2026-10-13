import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: { chatbotAuditEvent: { findMany: mocks.findMany } },
}))

import { GET } from "./route"

const correlationId = "11111111-1111-4111-8111-111111111111"

function row(input: Record<string, unknown> & { eventName: string; result: string; sequence: number }) {
  return {
    uiKind: null,
    tier: null,
    durationMs: 1,
    errorCode: null,
    source: "server",
    buildSha: "build-abc123",
    createdAt: new Date("2026-08-20T00:00:00.000Z"),
    ...input,
    payloadJson: JSON.stringify(input),
  }
}

describe("GET /api/chatbot/audit-summary", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.findMany.mockResolvedValue([
      row({ eventName: "request_received", result: "success", sequence: 100 }),
      row({
        eventName: "tier_attempt_completed",
        result: "success",
        sequence: 201,
        tier: "tier-2-gemini-flash",
        phase: "generate",
        retryAttempt: 1,
        errorReason: "choice-set-id-not-allowlisted",
      }),
      row({
        eventName: "response_normalized",
        result: "success",
        sequence: 300,
        uiKind: "none",
        tier: "tier-2-gemini-flash",
        finalTierConsistent: true,
        tierSequenceValid: true,
        stageTimings: {
          conversationLoad: 12,
          contextPreparation: 40,
          totalServer: 54_000,
        },
      }),
      row({ eventName: "conversation_persisted", result: "success", sequence: 400 }),
      row({
        eventName: "slack_notification_completed",
        result: "success",
        sequence: 500,
        slackDeliveryEvidence: {
          deliveries: [{
            kind: "conversation",
            deliveryRole: "parent",
            idempotencyKeyHash: "a".repeat(64),
            providerDedupeKeySubmitted: true,
            providerMessageTsPresent: true,
            providerDeliveryAccepted: true,
          }],
          uniqueIdempotencyKeys: true,
        },
      }),
    ])
  })

  it("returns a privacy-safe persisted-event readback on loopback", async () => {
    const response = await GET(new NextRequest(`http://localhost/api/chatbot/audit-summary?correlationId=${correlationId}`))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      correlationId,
      status: "complete",
      eventCount: 5,
      missingEvents: [],
      events: expect.arrayContaining([
        expect.objectContaining({
          eventName: "tier_attempt_completed",
          errorReason: "choice-set-id-not-allowlisted",
        }),
        expect.objectContaining({
          eventName: "response_normalized",
          stageTimings: {
            conversationLoad: 12,
            contextPreparation: 40,
            totalServer: 54_000,
          },
          createdAt: "2026-08-20T00:00:00.000Z",
        }),
      ]),
    })
  })

  it("does not expose audit readback on a public hostname", async () => {
    const response = await GET(new NextRequest(`https://www.norikane.studio/api/chatbot/audit-summary?correlationId=${correlationId}`))

    expect(response.status).toBe(404)
    expect(mocks.findMany).not.toHaveBeenCalled()
  })

  it("returns build and field-level Booking prefill evidence without customer values", async () => {
    const prefillFields = [
      "projectTitle",
      "dueDate",
      "companyName",
      "contactName",
      "contactEmail",
      "phone",
      "memo",
      "selectedSlots",
      "agreed",
    ].map((field) => ({
      field,
      expectedFilled: false,
      actualFilled: false,
      matches: true,
      source: field === "agreed" ? "safety-default" : "unconfirmed",
      reason: field === "agreed" ? "requires-explicit-consent" : "not-confirmed-in-chat",
    }))
    mocks.findMany.mockResolvedValue([
      row({
        eventName: "booking_prefill_rendered",
        result: "success",
        sequence: 640,
        source: "browser",
        prefillFields,
        memoCoverage: {
          finalMedia: true,
          materialContents: true,
          materialTiming: true,
          materialMethod: true,
        },
      }),
    ])

    const response = await GET(new NextRequest(`http://localhost/api/chatbot/audit-summary?correlationId=${correlationId}`))
    const payload = await response.json()

    expect(payload.events[0]).toMatchObject({
      eventName: "booking_prefill_rendered",
      buildSha: "build-abc123",
      prefillFields,
      memoCoverage: {
        finalMedia: true,
        materialContents: true,
        materialTiming: true,
        materialMethod: true,
      },
    })
    expect(JSON.stringify(payload)).not.toContain("customer@example.com")
  })
})
