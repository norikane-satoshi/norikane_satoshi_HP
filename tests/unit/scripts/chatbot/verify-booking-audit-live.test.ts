import { afterEach, describe, expect, it, vi } from "vitest"

import {
  collectSlackDeliveryHashes,
  evaluateLiveBookingAudit,
} from "../../../../scripts/chatbot/verify-booking-audit-live"

const buildSha = "abc123"
const slackHash = "a".repeat(64)

function completeSummary() {
  const success = (eventName: string, extra = {}) => ({ eventName, result: "success", buildSha, ...extra })
  return {
    correlationId: "11111111-1111-4111-8111-111111111111",
    status: "complete" as const,
    eventCount: 8,
    events: [
      success("booking_card_rendered"),
      success("booking_prefill_rendered", {
        prefillFields: Array.from({ length: 9 }, () => ({ matches: true })),
        memoCoverage: {
          finalMedia: true,
          materialContents: true,
          materialTiming: true,
          materialMethod: true,
        },
      }),
      success("booking_created"),
      success("customer_account_linked", {
        customerAccountEvidence: {
          authenticated: true,
          expectedLinked: true,
          actualLinked: true,
          matches: true,
        },
      }),
      success("booking_submit_success_rendered"),
      success("slack_notification_completed", {
        slackDeliveryEvidence: {
          deliveries: [{
            kind: "booking-order-submitted",
            deliveryRole: "thread-reply" as const,
            idempotencyKeyHash: slackHash,
            providerDedupeKeySubmitted: true,
            providerMessageTsPresent: true,
            providerDeliveryAccepted: true,
          }],
          uniqueIdempotencyKeys: true,
        },
      }),
    ],
  }
}

describe("live booking audit verifier", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("passes only when browser, booking, account, build, and Slack readback evidence all match", () => {
    const report = evaluateLiveBookingAudit({
      summary: completeSummary(),
      expectedBuildSha: buildSha,
      slackReadbackHashes: new Set([slackHash]),
      requireAuthenticatedCustomer: true,
    })

    expect(report).toMatchObject({ ok: true, violations: [] })
  })

  it("fails closed when the Slack provider readback or authenticated account evidence is missing", () => {
    const summary = completeSummary()
    const account = summary.events.find((event) => event.eventName === "customer_account_linked") as
      | { customerAccountEvidence?: { authenticated: boolean } }
      | undefined
    if (account?.customerAccountEvidence) account.customerAccountEvidence.authenticated = false

    const report = evaluateLiveBookingAudit({
      summary,
      expectedBuildSha: buildSha,
      slackReadbackHashes: new Set(),
      requireAuthenticatedCustomer: true,
    })

    expect(report.ok).toBe(false)
    expect(report.violations).toEqual(expect.arrayContaining([
      "authenticated-customer-evidence-missing",
      "booking-slack-readback-missing",
    ]))
  })

  it("requests all Slack message metadata before hashing booking delivery IDs", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: true,
        messages: [{ ts: "1700000000.000100", reply_count: 1 }],
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: true,
        messages: [{
          ts: "1700000000.000200",
          metadata: { event_payload: { delivery_id: "booking-delivery-id" } },
        }],
      })))
    vi.stubGlobal("fetch", fetchMock)

    const hashes = await collectSlackDeliveryHashes("xoxb-test", "C123")

    expect([...hashes]).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    for (const [input] of fetchMock.mock.calls) {
      expect(new URL(String(input)).searchParams.get("include_all_metadata")).toBe("true")
    }
  })
})
