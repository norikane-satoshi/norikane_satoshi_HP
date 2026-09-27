import { createHmac } from "node:crypto"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  chatbotDiagnosticHeader,
  chatbotDiagnosticToken,
  chatbotSlackAuditErrorCode,
  isChatbotDiagnosticRequest,
} from "@/lib/chatbot/server/diagnostic-request"

afterEach(() => vi.unstubAllEnvs())

const headersWith = (value?: string) => new Headers(value === undefined ? {} : { [chatbotDiagnosticHeader]: value })

describe("isChatbotDiagnosticRequest", () => {
  it("recognizes the token derived from the server's worker secret", () => {
    vi.stubEnv("CHATBOT_HOSTED_NOTION_AI_WORKER_TOKEN", "worker-secret")
    const token = createHmac("sha256", "worker-secret").update("chatbot-diagnostic-request").digest("hex")

    expect(chatbotDiagnosticToken()).toBe(token)
    expect(isChatbotDiagnosticRequest(headersWith(token))).toBe(true)
  })

  it("treats everything else as a real conversation, so manual tests and customers still reach Slack", () => {
    vi.stubEnv("CHATBOT_HOSTED_NOTION_AI_WORKER_TOKEN", "worker-secret")
    expect(isChatbotDiagnosticRequest(headersWith())).toBe(false)
    expect(isChatbotDiagnosticRequest(headersWith("guess"))).toBe(false)
    expect(isChatbotDiagnosticRequest(headersWith("worker-secret"))).toBe(false)

    vi.stubEnv("CHATBOT_HOSTED_NOTION_AI_WORKER_TOKEN", "")
    expect(isChatbotDiagnosticRequest(headersWith(""))).toBe(false)
  })
})

describe("chatbotSlackAuditErrorCode", () => {
  it("records a check conversation's deliberately skipped post apart from a Slack outage or missing config", () => {
    expect(chatbotSlackAuditErrorCode({ status: "skipped", reason: "diagnostic" })).toBe("slack-skipped-diagnostic")
    expect(chatbotSlackAuditErrorCode({ status: "skipped", reason: "disabled" })).toBe("slack-skipped")
    expect(chatbotSlackAuditErrorCode({ status: "failed", reason: "http-500" } as never)).toBe("slack-failed")
  })
})
