import { describe, expect, it } from "vitest"

import { ChatbotLlmError } from "@/lib/chatbot/server/llm-client"
import {
  buildRunInferenceExpression,
  isNotionAiThreadCapacityError,
  notionAiThreadCapacityMarker,
} from "@/lib/chatbot/hosted-worker/notion-ai-browser-client"

function capacityError(message: string): ChatbotLlmError {
  return new ChatbotLlmError({
    message,
    code: "invalid-output",
    tier: "tier-1-hosted-chrome-notion-ai",
    isRetryable: false,
  })
}

// The thread the worker posts from grows until Notion answers "Column size exceeded". That is the
// one service error the worker can fix itself, so it must be distinguishable from a Notion outage:
// rotating on an outage would mint a chat per request and fix nothing.
describe("notion ai thread capacity classification", () => {
  it("recognises a capacity failure from the marker", () => {
    expect(
      isNotionAiThreadCapacityError(
        capacityError(`Notion AI thread storage is exhausted: Column size exceeded ${notionAiThreadCapacityMarker}`),
      ),
    ).toBe(true)
  })

  it("recognises a capacity failure delivered as an HTTP error", () => {
    expect(
      isNotionAiThreadCapacityError(
        capacityError(`Notion AI request returned 500. Column size exceeded ${notionAiThreadCapacityMarker}`),
      ),
    ).toBe(true)
  })

  it("does not treat a Notion outage as a capacity failure", () => {
    for (const phrase of ["Internal server error", "Something went wrong"]) {
      expect(
        isNotionAiThreadCapacityError(
          capacityError(`Notion AI returned a service error instead of a reply: ${phrase}`),
        ),
        phrase,
      ).toBe(false)
    }
  })

  it("ignores anything that is not a chatbot error", () => {
    expect(isNotionAiThreadCapacityError(new Error(notionAiThreadCapacityMarker))).toBe(false)
    expect(isNotionAiThreadCapacityError(undefined)).toBe(false)
  })

  it("keeps the in-page copy of the phrases in step with the exported marker", () => {
    // runInferenceInPage is stringified into the page, so its copy of these literals cannot import
    // the constants. This asserts the two copies have not drifted apart.
    const expression = buildRunInferenceExpression(
      { traceId: "t", spaceId: "s", transcript: [], threadId: "th" } as never,
      {} as never,
    )

    expect(expression).toContain(notionAiThreadCapacityMarker)
    expect(expression).toContain("Column size exceeded")
    expect(expression).toContain("Internal server error")
  })
})
