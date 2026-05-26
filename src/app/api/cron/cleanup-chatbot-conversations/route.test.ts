import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  cleanupExpiredChatbotConversations: vi.fn(),
}))

vi.mock("@/lib/chatbot/server/cleanup-conversations", () => ({
  cleanupExpiredChatbotConversations: mocks.cleanupExpiredChatbotConversations,
}))

import { GET } from "./route"

function request(token = "secret") {
  return new NextRequest("http://localhost/api/cron/cleanup-chatbot-conversations", {
    headers: { authorization: `Bearer ${token}` },
  })
}

describe("GET /api/cron/cleanup-chatbot-conversations", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    vi.stubEnv("CRON_SECRET", "secret")
    mocks.cleanupExpiredChatbotConversations.mockResolvedValue({
      cutoffIso: "2026-04-26T00:00:00.000Z",
      retentionDays: 30,
      scannedConversationCount: 2,
      deletedConversationCount: 2,
      deletedMessageCount: 4,
      deletedSurveyResponseCount: 1,
      deletedInquiryCount: 1,
      unlinkedBookingGroupCount: 1,
    })
  })

  it("returns 401 when the bearer token does not match", async () => {
    const response = await GET(request("wrong"))

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" })
    expect(mocks.cleanupExpiredChatbotConversations).not.toHaveBeenCalled()
  })

  it("returns cleanup counts without raw conversation data", async () => {
    const response = await GET(request())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      cutoffIso: "2026-04-26T00:00:00.000Z",
      retentionDays: 30,
      scannedConversationCount: 2,
      deletedConversationCount: 2,
      deletedMessageCount: 4,
      deletedSurveyResponseCount: 1,
      deletedInquiryCount: 1,
      unlinkedBookingGroupCount: 1,
    })
  })
})
