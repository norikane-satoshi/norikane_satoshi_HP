import { describe, expect, it, vi } from "vitest"

import { sendChatbotSlackNotification } from "@/lib/chatbot/server/slack-notifier"

const enabledEnv = {
  CHATBOT_SLACK_NOTIFY_ENABLED: "true",
  SLACK_BOT_TOKEN: "bot-token-for-test",
  SLACK_CHATBOT_CHANNEL_ID: "channel-test",
}

function okFetch(ts = "1700000000.000100") {
  return vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, ts }), { status: 200 }))
}

describe("sendChatbotSlackNotification", () => {
  it("skips when Slack notification is disabled", async () => {
    const fetcher = okFetch()

    const result = await sendChatbotSlackNotification(
      { kind: "conversation", conversationId: "conv_1" },
      { env: { ...enabledEnv, CHATBOT_SLACK_NOTIFY_ENABLED: "false" }, fetcher },
    )

    expect(result).toEqual({ status: "skipped", reason: "disabled" })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it("skips when Slack token is missing", async () => {
    const fetcher = okFetch()

    const result = await sendChatbotSlackNotification(
      { kind: "conversation", conversationId: "conv_1" },
      { env: { CHATBOT_SLACK_NOTIFY_ENABLED: "true", SLACK_CHATBOT_CHANNEL_ID: "channel-test" }, fetcher },
    )

    expect(result).toEqual({ status: "skipped", reason: "missing-slack-config" })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it("posts parent messages without thread_ts and redacts sensitive text", async () => {
    const fetcher = okFetch()

    const result = await sendChatbotSlackNotification(
      {
        kind: "conversation",
        requestId: "req_1",
        conversationId: "conv_1",
        sessionId: "session_1",
        tier: "tier-2-hosted-chrome-notion-ai",
        routingDecisionKind: "continue",
        userMessage: "email client@example.com phone 090-1234-5678 token=abc12345",
        assistantResponse: "reply api_key=abc67890",
      },
      { env: enabledEnv, fetcher },
    )

    expect(result).toEqual({ status: "sent", ts: "1700000000.000100" })
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))
    expect(body.unfurl_links).toBe(false)
    expect(body.thread_ts).toBeUndefined()
    expect(body.text).toContain("requestId: req_1")
    expect(body.text).toContain("user: email [email] phone [phone] token=[secret]")
    expect(body.text).not.toContain("client@example.com")
    expect(body.text).not.toContain("abc12345")
    expect(body.text).not.toContain("abc67890")
  })

  it("posts thread replies with thread_ts", async () => {
    const fetcher = okFetch("1700000000.000200")

    await sendChatbotSlackNotification(
      {
        kind: "issue",
        conversationId: "conv_1",
        threadTs: "1700000000.000100",
        issueReasons: ["tier4-form-fallback"],
      },
      { env: enabledEnv, fetcher },
    )

    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))
    expect(body.unfurl_links).toBe(false)
    expect(body.thread_ts).toBe("1700000000.000100")
    expect(body.text).toContain("⚠️ Chatbot issue")
  })

  it("returns failed without throwing when Slack rejects the message", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error: "invalid_auth" }), { status: 200 }),
    )

    const result = await sendChatbotSlackNotification(
      { kind: "conversation", conversationId: "conv_1" },
      { env: enabledEnv, fetcher },
    )

    expect(result).toEqual({ status: "failed", reason: "send-failed" })
    expect(consoleWarn).toHaveBeenCalledWith(
      "[chatbot slack notification failed]",
      expect.objectContaining({ error: "invalid_auth" }),
    )
    consoleWarn.mockRestore()
  })
})
