import { describe, expect, it, vi } from "vitest"

import { sendChatbotSlackNotification } from "@/lib/chatbot/server/slack-notifier"

function okSlackResponse(ts = "1710000000.000100"): Response {
  return {
    ok: true,
    status: 200,
    json: vi.fn(async () => ({ ok: true, ts })),
  } as unknown as Response
}

function slackFetcher(ts?: string) {
  return vi.fn<typeof fetch>(async () => okSlackResponse(ts))
}

describe("sendChatbotSlackNotification", () => {
  it("includes safe hosted Tier1 retry diagnostics in conversation Slack text", async () => {
    const fetcher = slackFetcher()

    await expect(
      sendChatbotSlackNotification(
        {
          kind: "conversation",
          requestId: "req_1",
          conversationId: "conv_1",
          sessionId: "session_1",
          tier: "tier-1-hosted-chrome-notion-ai",
          uiKind: "choice-panel",
          choiceSetId: "job-kind",
          flowStep: "intake",
          bookingProgress: false,
          pendingRecovery: true,
          pendingRequestKind: "message",
          userMessage: "相談です",
          assistantResponse: "確認します",
          retryDiagnostics: {
            attemptCount: 2,
            maxAttempts: 3,
            retryReasons: ["server-error", "timeout"],
            repairAttempted: true,
            totalGenerateDurationMs: 1234,
            totalGenerateBudgetMs: 65000,
            perAttemptTimeoutMs: 55000,
            fallbackReason: "server-error",
            exhausted: false,
            attempts: [
              { attempt: 1, outcome: "error", reason: "server-error", httpStatus: 502, durationMs: 30146, timeoutMs: 55000 },
              { attempt: 2, outcome: "error", reason: "timeout", durationMs: 55003, timeoutMs: 55000 },
              { requestBody: "do-not-leak-request" },
            ],
            token: "do-not-leak-token",
            cookie: "do-not-leak-cookie",
          },
        },
        {
          env: {
            CHATBOT_SLACK_NOTIFY_ENABLED: "true",
            SLACK_BOT_TOKEN: "xoxb-secret-token",
            SLACK_CHATBOT_CHANNEL_ID: "C123",
          },
          fetcher,
        },
      ),
    ).resolves.toEqual({ status: "sent", ts: "1710000000.000100" })

    const init = fetcher.mock.calls[0]?.[1]
    const body = JSON.parse(String(init?.body)) as { text: string }

    expect(body.text).toContain("retryAttempts: 2/3")
    expect(body.text).toContain("pendingRecovery: true")
    expect(body.text).toContain("pendingRequestKind: message")
    expect(body.text).toContain("retryReasons: server-error,timeout")
    expect(body.text).toContain("repairAttempted: true")
    expect(body.text).toContain("totalGenerateDurationMs: 1234")
    expect(body.text).toContain("totalGenerateBudgetMs: 65000")
    expect(body.text).toContain("perAttemptTimeoutMs: 55000")
    expect(body.text).toContain("fallbackReason: server-error")
    expect(body.text).toContain("retryExhausted: false")
    expect(body.text).toContain("attempts: #1/error/server-error/http:502/30146ms/timeout:55000;#2/error/timeout/55003ms/timeout:55000")
    expect(body.text).not.toContain("xoxb-secret-token")
    expect(body.text).not.toContain("do-not-leak-token")
    expect(body.text).not.toContain("do-not-leak-cookie")
    expect(body.text).not.toContain("do-not-leak-request")
    expect(body.text).not.toContain("conv_1")
    expect(body.text).not.toContain("session_1")
  })

  it("includes retry diagnostics in issue thread replies", async () => {
    const fetcher = slackFetcher()

    await sendChatbotSlackNotification(
      {
        kind: "issue",
        requestId: "req_2",
        conversationId: "conv_2",
        sessionId: "session_2",
        tier: "tier-3-form-fallback",
        threadTs: "1710000000.000100",
        issueReasons: ["tier2-gemini-fallback", "tier3-form-fallback"],
        retryDiagnostics: {
          attemptCount: 3,
          maxAttempts: 3,
          retryReasons: ["server-error", "server-error"],
          repairAttempted: true,
          fallbackReason: "budget-exhausted",
          exhausted: true,
        },
      },
      {
        env: {
          CHATBOT_SLACK_NOTIFY_ENABLED: "true",
          SLACK_BOT_TOKEN: "xoxb-secret-token",
          SLACK_CHATBOT_CHANNEL_ID: "C123",
        },
        fetcher,
      },
    )

    const init = fetcher.mock.calls[0]?.[1]
    const body = JSON.parse(String(init?.body)) as { text: string; thread_ts?: string }

    expect(body.thread_ts).toBe("1710000000.000100")
    expect(body.text).toContain("retryAttempts: 3/3")
    expect(body.text).toContain("retryReasons: server-error,server-error")
    expect(body.text).toContain("fallbackReason: budget-exhausted")
    expect(body.text).toContain("retryExhausted: true")
    expect(body.text).toContain("内容: Tier 1からTier 2（Gemini Flash）へフォールバック")
    expect(body.text).toContain("内容: Tier 2でもAI応答を完了できず、Tier 3（問い合わせフォーム）へ切り替え")
  })

  it("shows the privacy-safe same-tier Gemini model fallback in Slack", async () => {
    const fetcher = slackFetcher()

    await sendChatbotSlackNotification(
      {
        kind: "conversation",
        requestId: "req_gemini_daily_quota",
        conversationId: "conv_gemini_daily_quota",
        tier: "tier-2-gemini-flash",
        retryDiagnostics: {
          providerModel: "gemini-2.5-flash-lite",
          rateLimitRetryCount: 0,
          dailyQuotaModelFallbackCount: 1,
          token: "must-not-leak",
        } as Record<string, unknown>,
      },
      {
        env: {
          CHATBOT_SLACK_NOTIFY_ENABLED: "true",
          SLACK_BOT_TOKEN: "xoxb-secret-token",
          SLACK_CHATBOT_CHANNEL_ID: "C123",
        },
        fetcher,
      },
    )

    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)) as { text: string }
    expect(body.text).toContain("providerModel: gemini-2.5-flash-lite")
    expect(body.text).toContain("rateLimitRetryCount: 0")
    expect(body.text).toContain("dailyQuotaModelFallbackCount: 1")
    expect(body.text).not.toContain("must-not-leak")
    expect(body.text).not.toContain("xoxb-secret-token")
  })

  it("includes a safe hidden-thread failure reason while keeping current Tier names", async () => {
    const fetcher = slackFetcher()

    await sendChatbotSlackNotification(
      {
        kind: "issue",
        requestId: "req_hidden_failure",
        conversationId: "conv_hidden_failure",
        tier: "tier-2-gemini-flash",
        issueReasons: ["tier2-gemini-fallback"],
        retryDiagnostics: {
          threadLifecycle: {
            visibilityStatus: "hide-verification-failed",
            hideVerificationResult: "chat-list-present",
            fallbackReason: "notion-thread-hide-verification-failed",
          },
          cookie: "must-not-leak",
          threadUrl: "https://app.notion.com/chat?t=must-not-leak",
        } as Record<string, unknown>,
      },
      {
        env: {
          CHATBOT_SLACK_NOTIFY_ENABLED: "true",
          SLACK_BOT_TOKEN: "xoxb-secret-token",
          SLACK_CHATBOT_CHANNEL_ID: "C123",
        },
        fetcher,
      },
    )

    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)) as { text: string }
    expect(body.text).toContain("tier: Tier 2（Gemini Flash） [tier-2-gemini-flash]")
    expect(body.text).toContain("threadVisibility: hide-verification-failed")
    expect(body.text).toContain("threadHideVerification: chat-list-present")
    expect(body.text).toContain("fallbackReason: notion-thread-hide-verification-failed")
    expect(body.text).not.toContain("must-not-leak")
    expect(body.text).not.toContain("xoxb-secret-token")
  })
})
