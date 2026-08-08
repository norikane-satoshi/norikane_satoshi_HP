import { afterEach, describe, expect, it, vi } from "vitest"

import {
  buildNotionAiThreadLifecycleExpression,
  estimateNotionAiRetentionDeadline,
  executeNotionAiThreadLifecycleInPage,
  isNotionAiRetentionPurgeEligible,
} from "@/lib/chatbot/hosted-worker/notion-ai-thread-lifecycle"

const spaceId = "11111111-2222-3333-4444-555555555555"
const userId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
const threadId = "99999999-8888-7777-6666-555555555555"
const deletedAt = "2026-08-08T01:00:00.000Z"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function threadRecord(input: { alive?: boolean; deletedAt?: string } = {}) {
  return {
    recordMap: {
      thread: {
        [threadId]: {
          value: {
            value: {
              alive: input.alive,
              data: input.deletedAt ? { deleted_time: input.deletedAt } : {},
              messages: ["private-message-id"],
            },
          },
        },
      },
    },
  }
}

function threadRecordWithNumericDeletedTime(input: { alive?: boolean; deletedAtMs: number }) {
  return {
    recordMap: {
      thread: {
        [threadId]: {
          value: {
            value: {
              alive: input.alive,
              data: { deleted_time: input.deletedAtMs },
            },
          },
        },
      },
    },
  }
}

function lifecycleInput(action: "inspect" | "hide-and-verify" | "verify" = "verify") {
  return {
    action,
    spaceId,
    userId,
    threadId,
    notionClientVersion: "23.13.0.0",
    retentionDays: 30,
  } as const
}

describe("Notion AI hidden thread lifecycle", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("uses the UI-equivalent alive=false transaction and verifies deleted_time plus Chat-list absence", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(jsonResponse(threadRecord({ alive: false, deletedAt })))
      .mockResolvedValueOnce(jsonResponse({ threadIds: [], transcripts: [] }))
    vi.stubGlobal("fetch", fetchMock)

    await expect(executeNotionAiThreadLifecycleInPage({
      ...lifecycleInput("hide-and-verify"),
      verifyAttempts: 1,
    })).resolves.toMatchObject({
      ok: true,
      stage: "verified",
      recordExists: true,
      alive: false,
      deletedAt,
      estimatedRetentionDeadline: "2026-09-07T01:00:00.000Z",
      hiddenFromChatList: true,
    })

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/v3/saveTransactionsFanout",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: expect.stringContaining('"path":["alive"]'),
      }),
    )
    expect(String(fetchMock.mock.calls[0]?.[1]?.body)).toContain('"args":false')
    expect(String(fetchMock.mock.calls[0]?.[1]?.body)).toContain("agentPersistenceActions.archiveInferenceThread")
  })

  it("converts the hyphenless URL thread id into the UUID form required by Notion transactions", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(jsonResponse(threadRecord({ alive: false, deletedAt })))
      .mockResolvedValueOnce(jsonResponse({ threadIds: [], transcripts: [] }))
    vi.stubGlobal("fetch", fetchMock)

    await executeNotionAiThreadLifecycleInPage({
      ...lifecycleInput("hide-and-verify"),
      threadId: threadId.replaceAll("-", ""),
      verifyAttempts: 1,
    })

    expect(String(fetchMock.mock.calls[0]?.[1]?.body)).toContain(`"id":"${threadId}"`)
    expect(String(fetchMock.mock.calls[1]?.[1]?.body)).toContain(`"id":"${threadId}"`)
  })

  it("builds a self-contained expression that runs in the page without transpiler helpers", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(threadRecord({ alive: false, deletedAt })))
      .mockResolvedValueOnce(jsonResponse({ threadIds: [], transcripts: [] }))
    vi.stubGlobal("fetch", fetchMock)

    const expression = buildNotionAiThreadLifecycleExpression(lifecycleInput("verify"))
    const runExpression = new Function(`return (${expression})`) as () => Promise<unknown>

    await expect(runExpression()).resolves.toMatchObject({
      ok: true,
      stage: "verified",
      hiddenFromChatList: true,
    })
  })

  it("does not invent deleted_time when Notion only reports alive=false", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(jsonResponse(threadRecord({ alive: false })))
      .mockResolvedValueOnce(jsonResponse({ threadIds: [], transcripts: [] }))
    vi.stubGlobal("fetch", fetchMock)

    await expect(executeNotionAiThreadLifecycleInPage({
      ...lifecycleInput("hide-and-verify"),
      verifyAttempts: 1,
    })).resolves.toMatchObject({
      ok: false,
      stage: "verify-record",
      alive: false,
      deletedAt: undefined,
    })
  })

  it("normalizes Notion's numeric deleted_time milliseconds into an ISO timestamp", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(threadRecordWithNumericDeletedTime({
        alive: false,
        deletedAtMs: Date.parse(deletedAt),
      })))
      .mockResolvedValueOnce(jsonResponse({ threadIds: [], transcripts: [] }))
    vi.stubGlobal("fetch", fetchMock)

    await expect(executeNotionAiThreadLifecycleInPage(lifecycleInput("verify"))).resolves.toMatchObject({
      ok: true,
      deletedAt,
      estimatedRetentionDeadline: "2026-09-07T01:00:00.000Z",
    })
  })

  it("fails verification when the thread remains in the workspace Chat list", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(threadRecord({ alive: false, deletedAt })))
      .mockResolvedValueOnce(jsonResponse({ threadIds: [threadId], transcripts: [{ id: threadId }] }))
    vi.stubGlobal("fetch", fetchMock)

    await expect(executeNotionAiThreadLifecycleInPage(lifecycleInput("verify"))).resolves.toMatchObject({
      ok: false,
      stage: "verify-chat-list",
      hiddenFromChatList: false,
    })
  })

  it("returns an explicit record-missing result instead of treating it as a transient API failure", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({ recordMap: { thread: {} } }))
    vi.stubGlobal("fetch", fetchMock)

    await expect(executeNotionAiThreadLifecycleInPage(lifecycleInput("inspect"))).resolves.toMatchObject({
      ok: true,
      stage: "record-missing",
      recordExists: false,
      threadRecordMissing: true,
    })
  })

  it("keeps a temporary Notion API failure distinct and retryable", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({ error: "temporary" }, 503))
    vi.stubGlobal("fetch", fetchMock)

    await expect(executeNotionAiThreadLifecycleInPage(lifecycleInput("verify"))).resolves.toMatchObject({
      ok: false,
      stage: "read-record",
      httpStatus: 503,
      retryable: true,
      threadRecordMissing: false,
    })
  })

  it("anchors the estimated Notion purge deadline to deleted_time plus 30 days", () => {
    expect(estimateNotionAiRetentionDeadline(deletedAt, 30)).toBe("2026-09-07T01:00:00.000Z")
  })

  it("labels a missing record as retention purge only after its estimated deadline", () => {
    expect(
      isNotionAiRetentionPurgeEligible({
        deletedAt,
        observedAt: "2026-09-07T01:00:00.000Z",
        retentionDays: 30,
      }),
    ).toBe(true)
    expect(
      isNotionAiRetentionPurgeEligible({
        deletedAt,
        observedAt: "2026-09-06T23:59:59.999Z",
        retentionDays: 30,
      }),
    ).toBe(false)
  })

  it("returns metadata only and never echoes record bodies, cookies, or auth headers", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(threadRecord({ alive: false, deletedAt })))
      .mockResolvedValueOnce(jsonResponse({ threadIds: [], transcripts: [], token_v2: "secret-token" }))
    vi.stubGlobal("fetch", fetchMock)

    const result = await executeNotionAiThreadLifecycleInPage(lifecycleInput("verify"))
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain("private-message-id")
    expect(serialized).not.toContain("secret-token")
    expect(serialized).not.toContain("cookie")
    expect(serialized).not.toContain("authorization")
  })
})
