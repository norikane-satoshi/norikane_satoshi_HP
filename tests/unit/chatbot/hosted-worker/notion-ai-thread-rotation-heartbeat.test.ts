import { describe, expect, it } from "vitest"

import {
  defaultGenerateIntervalMs,
  readNotionThreadId,
} from "../../../../scripts/chatbot/hosted-tier1-heartbeat"

// The generate smoke is what grows the Notion AI thread the worker posts from, so its interval is
// the main lever on how often the worker has to rotate.
describe("heartbeat support for thread rotation", () => {
  it("samples generate every thirty minutes", () => {
    expect(defaultGenerateIntervalMs).toBe(30 * 60_000)
  })

  it("reads the worker's current thread out of the health body", () => {
    expect(readNotionThreadId({ notionThread: { threadId: "abc" } })).toBe("abc")
    expect(readNotionThreadId({ notionThread: { source: "repo-default" } })).toBeUndefined()
    expect(readNotionThreadId({})).toBeUndefined()
    expect(readNotionThreadId(undefined)).toBeUndefined()
  })
})
