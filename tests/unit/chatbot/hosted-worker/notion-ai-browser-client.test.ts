import { describe, expect, it } from "vitest"

import {
  createHostedNotionAiBrowserClient,
  isNotionAiChatbotTargetUrl,
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

const oldThreadUrl = "https://app.notion.com/chat?t=11112222333344445555666677778888"
const firstConversationThreadUrl = "https://app.notion.com/chat?t=aaaabbbbccccddddeeeeffff00001111"

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

function hiddenLifecycleResult(overrides: Record<string, unknown> = {}) {
  return {
    ok: true as const,
    stage: "verified",
    recordExists: true,
    alive: false,
    deletedAt: "2026-08-08T01:00:00.000Z",
    estimatedRetentionDeadline: "2026-09-07T01:00:00.000Z",
    hiddenFromChatList: true,
    ...overrides,
  }
}

describe("Notion AI conversation thread isolation", () => {
  it("trusts a different Notion-minted chat target but rejects arbitrary pages and ids", () => {
    expect(isNotionAiChatbotTargetUrl(firstConversationThreadUrl, oldThreadUrl)).toBe(true)
    expect(isNotionAiChatbotTargetUrl("https://app.notion.com/chat?t=client-minted", oldThreadUrl)).toBe(false)
    expect(
      isNotionAiChatbotTargetUrl(
        "https://example.com/chat?t=aaaabbbbccccddddeeeeffff00001111",
        oldThreadUrl,
      ),
    ).toBe(false)
    expect(isNotionAiChatbotTargetUrl("https://app.notion.com/workspace/page", oldThreadUrl)).toBe(false)
  })

  it("uses the stored hidden thread id directly without navigating the visible chat UI", async () => {
    let currentUrl = oldThreadUrl
    const calls: string[] = []
    const session = {
      async evaluate<T>(expression: string): Promise<T> {
        if (expression.includes("thread-lifecycle-v1")) {
          calls.push("lifecycle")
          return hiddenLifecycleResult() as T
        }
        if (expression.includes("runInferenceTranscript") && expression.includes("response.body")) {
          calls.push("inference")
          expect(expression).toContain('"threadId":"aaaabbbb-cccc-dddd-eeee-ffff00001111"')
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

    expect(calls).not.toContain("navigate")
    expect(calls.filter((call) => call === "lifecycle")).toHaveLength(2)
    expect(calls.indexOf("lifecycle")).toBeLessThan(calls.indexOf("inference"))
    expect(response.diagnostics?.conversationThread).toMatchObject({
      mode: "reused",
      threadIdHash: expect.stringMatching(/^[0-9a-f]{12}$/),
      visibilityStatus: "hidden",
      postHideInferenceVerified: true,
    })
    expect(response.diagnostics?.conversationThread).not.toHaveProperty("threadId")
    expect(response.diagnostics?.conversationThread).not.toHaveProperty("threadUrl")
  })

  it("mints the first thread through the Notion UI before inference", async () => {
    let currentUrl = oldThreadUrl
    const calls: string[] = []
    const rotations: Array<{ threadUrl: string; reason: string }> = []
    const session = {
      async evaluate<T>(expression: string): Promise<T> {
        if (expression.includes("runInferenceTranscript") && expression.includes("response.body")) {
          calls.push("inference")
          expect(expression).toContain('"threadId":"aaaabbbb-cccc-dddd-eeee-ffff00001111"')
          return successfulInference() as T
        }
        if (expression.includes("thread-lifecycle-v1")) {
          calls.push("hide-and-verify")
          return hiddenLifecycleResult() as T
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

    expect(calls).toEqual(expect.arrayContaining(["open-blank-chat", "insert-seed", "send-seed", "hide-and-verify", "inference"]))
    expect(calls.indexOf("send-seed")).toBeLessThan(calls.indexOf("inference"))
    expect(calls.indexOf("hide-and-verify")).toBeLessThan(calls.indexOf("inference"))
    expect(rotations).toEqual([
      { threadUrl: firstConversationThreadUrl, reason: "conversation-provisioned" },
    ])
    expect(response.diagnostics?.conversationThread).toMatchObject({
      mode: "provisioned",
      threadIdHash: expect.stringMatching(/^[0-9a-f]{12}$/),
      visibilityStatus: "hidden",
      postHideInferenceVerified: true,
    })
  })

  it("fails closed before inference when the new thread cannot be hidden and verified", async () => {
    let currentUrl = oldThreadUrl
    let inferenceCalled = false
    const session = {
      async evaluate<T>(expression: string): Promise<T> {
        if (expression.includes("thread-lifecycle-v1")) {
          return {
            ok: false,
            stage: "hide-write",
            recordExists: true,
            hiddenFromChatList: false,
            retryable: true,
          } as T
        }
        if (expression.includes("runInferenceTranscript") && expression.includes("response.body")) {
          inferenceCalled = true
          return successfulInference() as T
        }
        if (expression.includes("__notionAiChatbotRuntimeContext")) {
          return {
            spaceId: "space-1",
            userId: "user-1",
            threadId: new URL(currentUrl).searchParams.get("t"),
          } as T
        }
        if (expression.includes("location.assign")) {
          currentUrl = "https://app.notion.com/ai"
          return { href: currentUrl } as T
        }
        if (expression.includes("activeElement")) return { ok: true, focused: true } as T
        if (expression.includes("composer?.innerText")) return { text: "セッション開始" } as T
        if (expression.includes("present")) return { present: true } as T
        if (expression.includes("aria-label")) {
          currentUrl = firstConversationThreadUrl
          return { ok: true } as T
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

    await expect(client.generate(isolatedRequest())).rejects.toMatchObject({
      code: "connection",
      isRetryable: true,
    })
    expect(inferenceCalled).toBe(false)
  })

  it("reprovisions instead of reusing another thread when the stored record is gone", async () => {
    const missingThreadUrl = "https://app.notion.com/chat?t=99998888777766665555444433332222"
    let currentUrl = oldThreadUrl
    const calls: string[] = []
    let lifecycleCalls = 0
    const session = {
      async evaluate<T>(expression: string): Promise<T> {
        if (expression.includes("thread-lifecycle-v1")) {
          lifecycleCalls += 1
          calls.push("lifecycle")
          return (lifecycleCalls === 1
            ? hiddenLifecycleResult({ recordExists: false, alive: undefined, deletedAt: undefined, hiddenFromChatList: true })
            : hiddenLifecycleResult()) as T
        }
        if (expression.includes("runInferenceTranscript") && expression.includes("response.body")) {
          calls.push("inference")
          expect(expression).toContain('"threadId":"aaaabbbb-cccc-dddd-eeee-ffff00001111"')
          expect(expression).not.toContain('"threadId":"99998888-7777-6666-5555-444433332222"')
          return successfulInference() as T
        }
        if (expression.includes("__notionAiChatbotRuntimeContext")) {
          return {
            spaceId: "space-1",
            userId: "user-1",
            threadId: new URL(currentUrl).searchParams.get("t"),
          } as T
        }
        if (expression.includes("location.assign")) {
          calls.push(expression.includes("99998888777766665555444433332222") ? "navigate-missing" : "open-blank-chat")
          currentUrl = expression.includes("99998888777766665555444433332222") ? missingThreadUrl : "https://app.notion.com/ai"
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
      conversationThreadUrl: missingThreadUrl,
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

    expect(calls).not.toContain("navigate-missing")
    expect(calls).toEqual(expect.arrayContaining(["open-blank-chat", "insert-seed", "send-seed", "inference"]))
    expect(response.diagnostics?.conversationThread).toMatchObject({
      mode: "reprovisioned",
      threadReprovisioned: true,
      contextRebuiltFromHpDb: true,
    })
  })

  it("does not report Tier 1 success when inference makes the hidden thread visible again", async () => {
    let lifecycleCalls = 0
    const session = {
      async evaluate<T>(expression: string): Promise<T> {
        if (expression.includes("thread-lifecycle-v1")) {
          lifecycleCalls += 1
          return (lifecycleCalls === 1
            ? hiddenLifecycleResult()
            : hiddenLifecycleResult({ alive: true, deletedAt: undefined, hiddenFromChatList: false })) as T
        }
        if (expression.includes("runInferenceTranscript") && expression.includes("response.body")) {
          return successfulInference() as T
        }
        if (expression.includes("__notionAiChatbotRuntimeContext")) {
          return {
            spaceId: "space-1",
            userId: "user-1",
            threadId: "aaaabbbb-cccc-dddd-eeee-ffff00001111",
          } as T
        }
        if (expression.includes("location.href")) return { href: firstConversationThreadUrl } as T
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

    await expect(client.generate(isolatedRequest())).rejects.toMatchObject({ code: "connection" })
  })
})
