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

describe("GET /api/chatbot/audit-summary", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.findMany.mockResolvedValue([
      { eventName: "request_received", result: "success", uiKind: null, tier: null, durationMs: 10, errorCode: null, source: "server", createdAt: new Date("2026-08-20T00:00:00.000Z") },
      { eventName: "response_normalized", result: "success", uiKind: "none", tier: "tier-1-hosted-chrome-notion-ai", durationMs: 20, errorCode: null, source: "server", createdAt: new Date("2026-08-20T00:00:01.000Z") },
      { eventName: "conversation_persisted", result: "success", uiKind: null, tier: null, durationMs: 5, errorCode: null, source: "server", createdAt: new Date("2026-08-20T00:00:02.000Z") },
      { eventName: "slack_notification_completed", result: "success", uiKind: null, tier: null, durationMs: 3, errorCode: null, source: "server", createdAt: new Date("2026-08-20T00:00:03.000Z") },
    ])
  })

  it("returns a privacy-safe persisted-event readback on loopback", async () => {
    const response = await GET(new NextRequest(`http://localhost/api/chatbot/audit-summary?correlationId=${correlationId}`))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      correlationId,
      status: "complete",
      eventCount: 4,
      missingEvents: [],
      events: expect.arrayContaining([
        expect.objectContaining({ eventName: "request_received", createdAt: "2026-08-20T00:00:00.000Z" }),
      ]),
    })
  })

  it("does not expose audit readback on a public hostname", async () => {
    const response = await GET(new NextRequest(`https://www.norikane.studio/api/chatbot/audit-summary?correlationId=${correlationId}`))

    expect(response.status).toBe(404)
    expect(mocks.findMany).not.toHaveBeenCalled()
  })
})
