import { describe, expect, it, vi } from "vitest"

import {
  buildBrowserBookingPrefillAudit,
  evaluateBrowserBookingPrefillResult,
  postChatbotBrowserAuditEvent,
} from "@/components/chatbot/widget/browser-audit"

const correlationId = "11111111-1111-4111-8111-111111111111"

describe("chatbot browser audit acknowledgement", () => {
  it("retries with the same event id so the server can enforce exactly-once", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ accepted: true }), { status: 202 }))

    await expect(postChatbotBrowserAuditEvent({
      schemaVersion: "1",
      eventId: "22222222-2222-4222-8222-222222222222",
      eventName: "choice_panel_rendered",
      correlationId,
      conversationId: "conv_private",
      result: "success",
      tier: "tier-1-hosted-chrome-notion-ai",
      uiKind: "choice-panel",
      phase: "render",
      durationMs: 18,
      stageTimings: { reactCommit: 18 },
    }, { fetcher })).resolves.toBeUndefined()

    expect(fetcher).toHaveBeenCalledTimes(2)
    const first = JSON.parse(fetcher.mock.calls[0][1].body)
    const second = JSON.parse(fetcher.mock.calls[1][1].body)
    expect(second.eventId).toBe(first.eventId)
    expect(fetcher).toHaveBeenNthCalledWith(1, "/api/chatbot/audit-event", expect.objectContaining({
      method: "POST",
      keepalive: true,
    }))
  })

  it("reports every Booking Order field as expected versus actually rendered without field values", () => {
    const fields = buildBrowserBookingPrefillAudit({
      expectedFilled: {
        projectTitle: true,
        dueDate: true,
        companyName: true,
        contactName: true,
        contactEmail: true,
        phone: false,
        memo: true,
        selectedSlots: false,
        agreed: false,
      },
      actualFilled: {
        projectTitle: true,
        dueDate: true,
        companyName: true,
        contactName: true,
        contactEmail: true,
        phone: false,
        memo: true,
        selectedSlots: true,
        agreed: false,
      },
    })

    expect(fields).toHaveLength(9)
    expect(fields.find((field) => field.field === "selectedSlots")).toMatchObject({
      expectedFilled: false,
      actualFilled: true,
      matches: false,
      source: "unconfirmed",
      reason: "no-schedule-selected",
    })
    expect(JSON.stringify(fields)).not.toContain("client@example")
    expect(JSON.stringify(fields)).not.toContain("案件名")
  })

  it("fails the prefill verdict when any field or required handoff fact is missing", () => {
    const fields = buildBrowserBookingPrefillAudit({
      expectedFilled: {
        projectTitle: true,
        dueDate: false,
        companyName: false,
        contactName: true,
        contactEmail: true,
        phone: false,
        memo: true,
        selectedSlots: false,
        agreed: false,
      },
      actualFilled: {
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
    })

    expect(evaluateBrowserBookingPrefillResult({
      prefillFields: fields,
      memoCoverage: {
        finalMedia: true,
        materialContents: true,
        materialTiming: false,
        materialMethod: true,
      },
    })).toBe("failure")
  })
})
