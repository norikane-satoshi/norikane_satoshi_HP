import { describe, expect, it } from "vitest"

import {
  isNotionAiRateLimitResponse,
  notionAiUsageLimitMarker,
} from "@/lib/chatbot/hosted-worker/notion-ai-browser-client"

// Captured from production on 2026-08-07: Notion answers HTTP 200 with an NDJSON
// stream that carries only this record once the workspace AI allowance is spent.
const usageLimitBody =
  '{"type":"patch-start","data":{"s":[{"id":"3b413ee3-141a-810b-9738-00aa7bcbe231",' +
  '"type":"premium-feature-unavailable","featureAvailability":{"type":"unavailable",' +
  '"limit":{"type":"cumulative","current":100.45,"total":100},"upsell":{"type":"none"}},' +
  '"traceId":"6b6db30d-8b9d-4a80-b571-c1c1553022ce"}]},"version":1}'

describe("notion ai usage limit classification", () => {
  it("treats an exhausted AI allowance as an external limit, not a malformed response", () => {
    expect(isNotionAiRateLimitResponse(usageLimitBody)).toBe(true)
  })

  it("exposes a stable marker so operations can tell a quota stop from throttling", () => {
    expect(notionAiUsageLimitMarker).toBe("notion_ai_usage_limit_reached")
  })

  it("still classifies fair-use throttling and leaves normal streams alone", () => {
    expect(isNotionAiRateLimitResponse('{"type":"UserRateLimitResponse"}')).toBe(true)
    expect(isNotionAiRateLimitResponse('{"type":"agent-inference","value":[{"type":"text"}]}')).toBe(false)
  })
})
