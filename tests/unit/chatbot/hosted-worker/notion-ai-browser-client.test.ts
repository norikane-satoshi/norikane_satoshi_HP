import { describe, expect, it } from "vitest"

import {
  createHostedNotionAiBrowserClient,
  isNotionAiRateLimitResponse,
  notionAiUsageLimitMarker,
} from "@/lib/chatbot/hosted-worker/notion-ai-browser-client"
import type { ChatbotLlmRequest } from "@/lib/chatbot/server/llm-client"

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

const oldThreadUrl = "https://app.notion.com/ai?t=11112222333344445555666677778888"
const firstConversationThreadUrl = "https://app.notion.com/ai?t=aaaabbbbccccddddeeeeffff00001111"

function isolatedRequest(): ChatbotLlmRequest {
  return {
    conversationId: "conversation-a",
    systemPrompt: "相談受付",
    messages: [{ role: "user", content: "相談です" }],
    conversationState: {
      hasFinalMedium: false,
      hasJobKind: false,
      hasAdditionalWork: false,
      hasDocumentaryAttachments: false,
      hasWorkSite: false,
      hasReferenceUrls: false,
      hasContactEmail: false,
      hasDesiredSchedule: false,
      turnCount: 1,
    },
    jobContext: { documentaryAttachment: { kind: "none" } } as ChatbotLlmRequest["jobContext"],
  }
}

function successfulInference() {
  return {
    ok: true as const,
    rawText: "<customer_reply>分離済みです</customer_reply>",
    chunkCount: 1,
    postDataBytes: 1,
    responseBytes: 1,
    responseContentType: "application/x-ndjson",
    responseHeaders: {},
    parsedPartial: true,
    parsedFinal: true,
  }
}

describe("Notion AI conversation thread isolation", () => {
  it("navigates to the stored thread before a later turn runs inference", async () => {
    let currentUrl = oldThreadUrl
    const calls: string[] = []
    const session = {
      async evaluate<T>(expression: string): Promise<T> {
        if (expression.includes("runInferenceTranscript") && expression.includes("response.body")) {
          calls.push("inference")
          return successfulInference() as T
        }
        if (expression.includes("__notionAiChatbotRuntimeContext")) {
          calls.push("runtime-context")
          return {
            spaceId: "space-1",
            userId: "user-1",
            threadId: new URL(currentUrl).searchParams.get("t"),
          } as T
        }
        if (expression.includes("location.assign")) {
          calls.push("navigate")
          currentUrl = firstConversationThreadUrl
          return { href: currentUrl } as T
        }
        if (expression.includes("location.href")) return { href: currentUrl } as T
        throw new Error(`Unexpected expression: ${expression.slice(0, 80)}`)
      },
      async insertText(): Promise<void> {},
      async close(): Promise<void> {},
    }
    const client = createHostedNotionAiBrowserClient({
      targetUrlIncludes: oldThreadUrl,
      conversationThreadRequired: true,
      conversationThreadUrl: firstConversationThreadUrl,
      fetchClient: async (url) =>
        new Response(
          JSON.stringify(
            url.endsWith("/json/list")
              ? [{ type: "page", url: oldThreadUrl, webSocketDebuggerUrl: "ws://test" }]
              : { Browser: "Chrome/test" },
          ),
          { status: 200 },
        ),
      sessionFactory: async () => session,
    })

    const response = await client.generate(isolatedRequest())

    expect(calls.indexOf("navigate")).toBeLessThan(calls.indexOf("inference"))
    expect(response.diagnostics?.conversationThread).toEqual({
      mode: "reused",
      threadId: "aaaabbbbccccddddeeeeffff00001111",
    })
  })

  it("mints the first thread through the Notion UI before inference", async () => {
    let currentUrl = oldThreadUrl
    const calls: string[] = []
    const rotations: Array<{ threadUrl: string; reason: string }> = []
    const session = {
      async evaluate<T>(expression: string): Promise<T> {
        if (expression.includes("runInferenceTranscript") && expression.includes("response.body")) {
          calls.push("inference")
          return successfulInference() as T
        }
        if (expression.includes("__notionAiChatbotRuntimeContext")) {
          calls.push("runtime-context")
          return {
            spaceId: "space-1",
            userId: "user-1",
            threadId: new URL(currentUrl).searchParams.get("t"),
          } as T
        }
        if (expression.includes("location.assign")) {
          calls.push("open-blank-chat")
          currentUrl = "https://app.notion.com/ai"
          return { href: currentUrl } as T
        }
        if (expression.includes("activeElement")) return { ok: true, focused: true } as T
        if (expression.includes("composer?.innerText")) return { text: "セッション開始" } as T
        if (expression.includes("present")) return { present: true } as T
        if (expression.includes("aria-label")) {
          calls.push("send-seed")
          currentUrl = firstConversationThreadUrl
          return { ok: true } as T
        }
        if (expression.includes("location.href")) return { href: currentUrl } as T
        throw new Error(`Unexpected expression: ${expression.slice(0, 80)}`)
      },
      async insertText(): Promise<void> {
        calls.push("insert-seed")
      },
      async close(): Promise<void> {},
    }
    const client = createHostedNotionAiBrowserClient({
      targetUrlIncludes: oldThreadUrl,
      conversationThreadRequired: true,
      fetchClient: async (url) =>
        new Response(
          JSON.stringify(
            url.endsWith("/json/list")
              ? [{ type: "page", url: oldThreadUrl, webSocketDebuggerUrl: "ws://test" }]
              : { Browser: "Chrome/test" },
          ),
          { status: 200 },
        ),
      sessionFactory: async () => session,
      onThreadRotated: async (rotation) => {
        rotations.push({ threadUrl: rotation.threadUrl, reason: rotation.reason })
      },
    })

    const response = await client.generate(isolatedRequest())

    expect(calls).toEqual(expect.arrayContaining(["open-blank-chat", "insert-seed", "send-seed", "inference"]))
    expect(calls.indexOf("send-seed")).toBeLessThan(calls.indexOf("inference"))
    expect(rotations).toEqual([
      { threadUrl: firstConversationThreadUrl, reason: "conversation-provisioned" },
    ])
    expect(response.diagnostics?.conversationThread).toEqual({
      mode: "provisioned",
      threadId: "aaaabbbbccccddddeeeeffff00001111",
    })
  })
})
