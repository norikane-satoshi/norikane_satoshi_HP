import { describe, expect, it, vi } from "vitest"

import {
  detectUnpublishedNoteUrlProblems,
  getSlackNotificationConfig,
  notifyChatbotSlack,
} from "@/lib/chatbot/server/slack-notification"

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

describe("chatbot Slack notification", () => {
  it("creates a parent post and persists its thread ts for a new conversation", async () => {
    const repository = {
      loadConversationSlackThread: vi.fn().mockResolvedValue({
        conversationId: "conv_1",
        sessionId: "session_1",
        channelId: null,
        threadTs: null,
      }),
      saveConversationSlackThread: vi.fn().mockResolvedValue(undefined),
    }
    const fetchImpl = vi.fn().mockResolvedValue(response({ ok: true, ts: "1711111111.000100" }))

    const result = await notifyChatbotSlack(
      {
        kind: "conversation",
        requestId: "req_1",
        conversationId: "conv_1",
        sessionId: "session_1",
        userMessage: "相談です client@example.com",
        assistantMessage: "返信です",
        tier: "tier-2-hosted-chrome-notion-ai",
        problems: [{ code: "tier-fallback", reason: "Tier2 answered." }],
      },
      {
        repository,
        fetchImpl,
        config: {
          status: "enabled",
          botToken: "xoxb-secret",
          channelId: "C123",
          privacyMode: "mask-contact",
        },
      },
    )

    expect(result).toEqual({
      status: "sent",
      channelId: "C123",
      threadTs: "1711111111.000100",
      parentCreated: true,
    })
    expect(repository.saveConversationSlackThread).toHaveBeenCalledWith({
      conversationId: "conv_1",
      channelId: "C123",
      threadTs: "1711111111.000100",
    })
    const body = JSON.parse(fetchImpl.mock.calls[0]?.[1]?.body as string)
    expect(body.thread_ts).toBeUndefined()
    expect(JSON.stringify(body.blocks)).toContain("[email]@example.com")
    expect(JSON.stringify(body.blocks)).not.toContain("client@example.com")
  })

  it("replies into the stored thread for later messages", async () => {
    const repository = {
      loadConversationSlackThread: vi.fn().mockResolvedValue({
        conversationId: "conv_1",
        sessionId: "session_1",
        channelId: "C123",
        threadTs: "1711111111.000100",
      }),
      saveConversationSlackThread: vi.fn(),
    }
    const fetchImpl = vi.fn().mockResolvedValue(response({ ok: true, ts: "1711111112.000200" }))

    const result = await notifyChatbotSlack(
      {
        kind: "conversation",
        conversationId: "conv_1",
        sessionId: "session_1",
        userMessage: "2通目です",
        assistantMessage: "続きです",
        tier: "tier-1-chrome-notion-ai",
      },
      {
        repository,
        fetchImpl,
        config: {
          status: "enabled",
          botToken: "xoxb-secret",
          channelId: "C123",
          privacyMode: "mask-contact",
        },
      },
    )

    expect(result).toMatchObject({ status: "sent", parentCreated: false, threadTs: "1711111111.000100" })
    expect(repository.saveConversationSlackThread).not.toHaveBeenCalled()
    const body = JSON.parse(fetchImpl.mock.calls[0]?.[1]?.body as string)
    expect(body.thread_ts).toBe("1711111111.000100")
  })

  it("skips safely when Slack env is missing", async () => {
    expect(getSlackNotificationConfig({})).toEqual({ status: "disabled", reason: "missing-env" })
    await expect(
      notifyChatbotSlack({
        kind: "conversation",
        conversationId: "conv_1",
        sessionId: "session_1",
        userMessage: "相談です",
        assistantMessage: "返信です",
        tier: "tier-1-chrome-notion-ai",
      }, {
        config: { status: "disabled", reason: "missing-env" },
      }),
    ).resolves.toEqual({ status: "skipped", reason: "missing-env" })
  })

  it("detects unpublished note URLs in assistant text", () => {
    expect(
      detectUnpublishedNoteUrlProblems({
        assistantMessage: "公開予定はこちらです https://norikane.studio/notes/grading",
        publishedSlugs: ["correction"],
      }),
    ).toEqual([
      {
        code: "note-url-not-published",
        reason: "Assistant attempted to expose unpublished note URL slug=grading.",
      },
    ])
  })
})
