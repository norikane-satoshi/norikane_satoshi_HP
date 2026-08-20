import { afterEach, describe, expect, it, vi } from "vitest"

import { logPrivacySafeChatbotEvent } from "@/lib/chatbot/server/boundary-event-log"

describe("privacy-safe chatbot operational log", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it("hashes correlation identities and removes free text, user agent, prompts, and secrets", () => {
    vi.stubEnv("NODE_ENV", "production")
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => undefined)

    logPrivacySafeChatbotEvent({
      event: "chatbot_test_boundary",
      requestId: "11111111-1111-4111-8111-111111111111",
      conversationId: "conversation_private_1",
      sessionId: "session_private_1",
      userAgent: "Mozilla/5.0 (iPhone) private-device",
      latestUserMessagePreview: "client@example.jp secret customer sentence",
      systemPrompt: "secret prompt",
      tier: "tier-1-hosted-chrome-notion-ai",
      latencyMs: 54000,
      incident: false,
    })

    const serialized = String(consoleInfo.mock.calls[0]?.[0])
    const payload = JSON.parse(serialized)
    expect(payload).toMatchObject({
      event: "chatbot_test_boundary",
      requestId: "11111111-1111-4111-8111-111111111111",
      tier: "tier-1-hosted-chrome-notion-ai",
      latencyMs: 54000,
      incident: false,
      clientClass: "mobile",
    })
    expect(payload.conversationHash).toMatch(/^[a-f0-9]{64}$/)
    expect(payload.sessionHash).toMatch(/^[a-f0-9]{64}$/)
    for (const forbidden of [
      "conversation_private_1",
      "session_private_1",
      "private-device",
      "client@example.jp",
      "secret customer sentence",
      "secret prompt",
    ]) {
      expect(serialized).not.toContain(forbidden)
    }
  })
})
