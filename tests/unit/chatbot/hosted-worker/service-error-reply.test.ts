import { describe, expect, it } from "vitest"

import { parseInferenceNdjsonStream } from "@/lib/chatbot/hosted-worker/notion-ai-browser-client"

// Production returned rawText "Column size exceeded" as the assistant's answer once the pinned
// Notion AI thread outgrew its storage, so a customer asking about turnaround was shown a Notion
// internal error instead of a reply.
describe("notion service errors are not customer answers", () => {
  it("still extracts a real assistant reply", () => {
    const ndjson = [
      '{"type":"patch-start","data":{"s":[{"id":"a","type":"agent-turn-full-record-map"}]},"version":1}',
      '{"type":"patch","v":[{"o":"a","p":"/s/-","v":{"id":"b","type":"agent-inference","value":[{"type":"text","content":"CM30秒は0.5〜1日程度です。"}]}}]}',
    ].join("\n")

    expect(parseInferenceNdjsonStream(ndjson).assistantText).toContain("0.5〜1日")
  })
})
