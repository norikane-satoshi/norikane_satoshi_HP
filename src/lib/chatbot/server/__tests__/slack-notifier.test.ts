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

function postedBody(fetcher: ReturnType<typeof okFetch>) {
  return JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))
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
        bookingProgress: true,
        userMessage: "email client@example.com phone 090-1234-5678 token=abc12345",
        assistantResponse: "reply api_key=abc67890",
      },
      { env: enabledEnv, fetcher },
    )

    expect(result).toEqual({ status: "sent", ts: "1700000000.000100" })
    const body = postedBody(fetcher)
    expect(body.unfurl_links).toBe(false)
    expect(body.thread_ts).toBeUndefined()
    expect(body.text).toContain("新しいチャット相談")
    expect(body.text).toContain("会話ID: conv_1")
    expect(body.text).toContain("セッションID: session_1")
    expect(body.text).toContain("requestId: req_1")
    expect(body.text).toContain("tier: tier-2-hosted-chrome-notion-ai")
    expect(body.text).toContain("bookingProgress: true")
    expect(body.text).toContain("応答: 通常応答")
    expect(body.text).toContain("状態: 相談継続")
    expect(body.text).toContain("ユーザー: email [email] phone [phone] token=[secret]")
    expect(body.text).not.toMatch(/Chatbot conversation/i)
    expect(body.text).not.toContain("Chatbot Conversation")
    expect(body.text).not.toContain("client@example.com")
    expect(body.text).not.toContain("abc12345")
    expect(body.text).not.toContain("abc67890")
  })

  it("posts conversation thread replies with required operation fields but without repeated conversation ids", async () => {
    const fetcher = okFetch("1700000000.000200")

    await sendChatbotSlackNotification(
      {
        kind: "conversation",
        requestId: "req_2",
        conversationId: "conv_1",
        sessionId: "session_1",
        tier: "tier-3-ollama-deepseek",
        bookingProgress: false,
        threadTs: "1700000000.000100",
        userMessage: "2通目です",
        assistantResponse: "返信です",
      },
      { env: enabledEnv, fetcher },
    )

    const body = postedBody(fetcher)
    expect(body.thread_ts).toBe("1700000000.000100")
    expect(body.text).toContain("requestId: req_2")
    expect(body.text).toContain("tier: tier-3-ollama-deepseek")
    expect(body.text).toContain("bookingProgress: false")
    expect(body.text).toContain("ユーザー: 2通目です")
    expect(body.text).toContain("AI: 返信です")
    expect(body.text).not.toMatch(/Chatbot conversation/i)
    expect(body.text).not.toContain("conversationId:")
    expect(body.text).not.toContain("sessionId:")
    expect(body.text).not.toContain("会話ID:")
    expect(body.text).not.toContain("セッションID:")
    expect(body.text).not.toContain("調査ID:")
  })

  it("posts issue thread replies without loud English headers or internal keys", async () => {
    const fetcher = okFetch("1700000000.000200")

    await sendChatbotSlackNotification(
      {
        kind: "issue",
        requestId: "req_issue",
        conversationId: "conv_1",
        sessionId: "session_1",
        tier: "tier-4-form-fallback",
        bookingProgress: true,
        threadTs: "1700000000.000100",
        issueReasons: ["tier4-form-fallback"],
      },
      { env: enabledEnv, fetcher },
    )

    const body = postedBody(fetcher)
    expect(body.unfurl_links).toBe(false)
    expect(body.thread_ts).toBe("1700000000.000100")
    expect(body.text).toContain("応答でエラーが出ました")
    expect(body.text).toContain("requestId: req_issue")
    expect(body.text).toContain("tier: tier-4-form-fallback")
    expect(body.text).toContain("bookingProgress: true")
    expect(body.text).toContain("内容: AI応答を完了できず、問い合わせフォーム案内へ切り替え")
    expect(body.text).not.toMatch(/Chatbot issue/i)
    expect(body.text).not.toContain("⚠️")
    expect(body.text).not.toContain("reasons:")
    expect(body.text).not.toContain("tier4-form-fallback")
    expect(body.text).not.toContain("conversationId:")
    expect(body.text).not.toContain("sessionId:")
  })

  it("maps message issue reasons to human-readable Japanese text", async () => {
    const fetcher = okFetch("1700000000.000200")

    await sendChatbotSlackNotification(
      {
        kind: "issue",
        requestId: "req_issue",
        conversationId: "conv_1",
        threadTs: "1700000000.000100",
        issueReasons: ["message-server-handler"],
      },
      { env: enabledEnv, fetcher },
    )

    const body = postedBody(fetcher)
    expect(body.text).toContain("内容: サーバー側で処理に失敗")
    expect(body.text).not.toContain("message-server-handler")
    expect(body.text).not.toContain("reasons:")
  })

  it("posts booking completion thread replies without repeated conversation or session ids", async () => {
    const fetcher = okFetch("1700000000.000200")

    await sendChatbotSlackNotification(
      {
        kind: "booking-completed",
        conversationId: "conv_1",
        sessionId: "session_1",
        threadTs: "1700000000.000100",
        bookingGroupId: "booking_1",
        selectedSlotCount: 2,
      },
      { env: enabledEnv, fetcher },
    )

    const body = postedBody(fetcher)
    expect(body.thread_ts).toBe("1700000000.000100")
    expect(body.text).toContain("予約が確定しました")
    expect(body.text).toContain("予約ID: booking_1")
    expect(body.text).toContain("候補数: 2件")
    expect(body.text).not.toMatch(/Chatbot booking completed/i)
    expect(body.text).not.toContain("bookingId:")
    expect(body.text).not.toContain("selectedSlotCount:")
    expect(body.text).not.toContain("conversationId:")
    expect(body.text).not.toContain("sessionId:")
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
