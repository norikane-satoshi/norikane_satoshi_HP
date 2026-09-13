import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({ prisma: {} }))

import {
  coordinateChatbotMessageRequest,
  hashChatbotMessagePayload,
  type ChatbotMessageRequestRecord,
  type ChatbotMessageRequestSnapshot,
  type ChatbotMessageRequestStore,
} from "@/lib/chatbot/server/message-request-coordinator"

class MemoryStore implements ChatbotMessageRequestStore {
  activeKey: string | null = null
  activeOwner: string | null = null
  activeLeaseExpiresAt: Date | null = null
  lockVersion = 0
  requests = new Map<string, ChatbotMessageRequestRecord>()
  legacyMessageConversationId: string | null = null

  async load(input: Parameters<ChatbotMessageRequestStore["load"]>[0]): Promise<ChatbotMessageRequestSnapshot> {
    const lookupKey = input.recoverRequestKey ?? input.requestKey
    const request = this.requests.get(lookupKey)
    return {
      conversationId: "conv_1",
      conversationSessionId: input.sessionId,
      activeKey: this.activeKey,
      activeOwner: this.activeOwner,
      activeLeaseExpiresAt: this.activeLeaseExpiresAt,
      lockVersion: this.lockVersion,
      request: request ? { ...request } : null,
      legacyMessageConversationId: request ? null : this.legacyMessageConversationId,
    }
  }

  async claimNew(input: Parameters<ChatbotMessageRequestStore["claimNew"]>[0]) {
    if (input.snapshot.lockVersion !== this.lockVersion || this.activeKey || this.requests.has(input.requestKey)) {
      return false
    }
    this.activeKey = input.requestKey
    this.activeOwner = input.owner
    this.activeLeaseExpiresAt = input.leaseExpiresAt
    this.lockVersion += 1
    this.requests.set(input.requestKey, {
      key: input.requestKey,
      conversationId: "conv_1",
      payloadHash: input.payloadHash,
      status: "processing",
      owner: input.owner,
      leaseExpiresAt: input.leaseExpiresAt,
      resultJson: null,
      version: 1,
      conversationVersion: this.lockVersion,
    })
    return true
  }

  async reclaim(input: Parameters<ChatbotMessageRequestStore["reclaim"]>[0]) {
    const current = this.requests.get(input.request.key)
    if (
      input.snapshot.lockVersion !== this.lockVersion ||
      !current ||
      current.version !== input.request.version ||
      (this.activeKey !== null && this.activeKey !== input.request.key)
    ) return false
    this.activeKey = input.request.key
    this.activeOwner = input.owner
    this.activeLeaseExpiresAt = input.leaseExpiresAt
    this.lockVersion += 1
    this.requests.set(input.request.key, {
      ...current,
      status: "processing",
      owner: input.owner,
      leaseExpiresAt: input.leaseExpiresAt,
      resultJson: null,
      version: current.version + 1,
      conversationVersion: this.lockVersion,
    })
    return true
  }

  async complete(input: Parameters<ChatbotMessageRequestStore["complete"]>[0]) {
    const current = this.requests.get(input.requestKey)
    if (
      !current || current.owner !== input.owner || current.version !== input.requestVersion ||
      this.activeKey !== input.requestKey || this.activeOwner !== input.owner
    ) return false
    this.requests.set(input.requestKey, {
      ...current,
      status: "completed",
      owner: null,
      leaseExpiresAt: null,
      resultJson: input.resultJson,
      version: current.version + 1,
    })
    this.activeKey = null
    this.activeOwner = null
    this.activeLeaseExpiresAt = null
    this.lockVersion += 1
    return true
  }

  async fail(input: Parameters<ChatbotMessageRequestStore["fail"]>[0]) {
    const current = this.requests.get(input.requestKey)
    if (
      !current || current.owner !== input.owner || current.version !== input.requestVersion ||
      this.activeKey !== input.requestKey || this.activeOwner !== input.owner
    ) return false
    this.requests.set(input.requestKey, {
      ...current,
      status: "failed",
      owner: null,
      leaseExpiresAt: null,
      version: current.version + 1,
    })
    this.activeKey = null
    this.activeOwner = null
    this.activeLeaseExpiresAt = null
    this.lockVersion += 1
    return true
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe("coordinateChatbotMessageRequest", () => {
  let store: MemoryStore

  beforeEach(() => {
    store = new MemoryStore()
  })

  it("executes only once when two workers receive the same first message", async () => {
    const execution = deferred<{ answer: string }>()
    const execute = vi.fn(() => execution.promise)
    const common = {
      sessionId: "session_1",
      requestKey: "client_msg_1",
      payloadHash: "payload_1",
      store,
      execute,
      pollIntervalMs: 1,
    }
    const first = coordinateChatbotMessageRequest({ ...common, requestId: "request_1" })
    await vi.waitFor(() => expect(store.activeKey).toBe("client_msg_1"))
    const second = coordinateChatbotMessageRequest({ ...common, requestId: "request_2" })
    execution.resolve({ answer: "一度だけ生成" })

    await expect(first).resolves.toMatchObject({ requestId: "request_1", replayed: false })
    await expect(second).resolves.toEqual({
      requestId: "request_1",
      result: { answer: "一度だけ生成" },
      replayed: true,
    })
    expect(execute).toHaveBeenCalledOnce()
  })

  it("replays an old request after a newer turn has completed", async () => {
    const executeFirst = vi.fn(async () => ({ answer: "first" }))
    await coordinateChatbotMessageRequest({
      sessionId: "session_1", requestId: "request_1", requestKey: "client_msg_1",
      payloadHash: "payload_1", store, execute: executeFirst,
    })
    await coordinateChatbotMessageRequest({
      sessionId: "session_1", requestId: "request_2", requestKey: "client_msg_2",
      payloadHash: "payload_2", store, execute: async () => ({ answer: "second" }),
    })
    const lateExecute = vi.fn(async () => ({ answer: "duplicate" }))

    await expect(coordinateChatbotMessageRequest({
      sessionId: "session_1", requestId: "request_late", requestKey: "client_msg_1",
      payloadHash: "payload_1", store, execute: lateExecute,
    })).resolves.toEqual({
      requestId: "request_1",
      result: { answer: "first" },
      replayed: true,
    })
    expect(lateExecute).not.toHaveBeenCalled()
  })

  it("lets restored-tab recovery wait for the original and rejects a foreign unknown recovery key", async () => {
    const execution = deferred<{ answer: string }>()
    const original = coordinateChatbotMessageRequest({
      sessionId: "session_1", requestId: "request_1", requestKey: "client_msg_original",
      payloadHash: "same_payload", store, execute: () => execution.promise, pollIntervalMs: 1,
    })
    await vi.waitFor(() => expect(store.activeKey).toBe("client_msg_original"))
    const recoveryExecute = vi.fn(async () => ({ answer: "duplicate" }))
    const recovery = coordinateChatbotMessageRequest({
      sessionId: "session_1", requestId: "request_2", requestKey: "client_msg_recovery",
      recoverRequestKey: "client_msg_original", payloadHash: "same_payload", store,
      execute: recoveryExecute, pollIntervalMs: 1,
    })
    execution.resolve({ answer: "original" })
    await original
    await expect(recovery).resolves.toMatchObject({ requestId: "request_1", replayed: true })
    expect(recoveryExecute).not.toHaveBeenCalled()

    await expect(coordinateChatbotMessageRequest({
      sessionId: "session_1", requestId: "request_3", requestKey: "client_msg_new",
      recoverRequestKey: "client_msg_unknown", payloadHash: "same_payload", store,
      execute: recoveryExecute,
    })).rejects.toMatchObject({ code: "chatbot_message_recovery_request_unknown", status: 409 })
  })

  it("claims the original key when recovery arrives before the first request", async () => {
    await expect(coordinateChatbotMessageRequest({
      sessionId: "session_1", requestId: "request_recovery", requestKey: "client_msg_original",
      recoverRequestKey: "client_msg_original", payloadHash: "payload_1", store,
      execute: async () => ({ answer: "recovered" }),
    })).resolves.toMatchObject({ result: { answer: "recovered" }, replayed: false })
    expect(store.requests.get("client_msg_original")?.status).toBe("completed")
  })

  it("rejects a pre-migration message id that has no durable request record", async () => {
    store.legacyMessageConversationId = "conv_1"
    const execute = vi.fn(async () => ({ answer: "must not run" }))

    await expect(coordinateChatbotMessageRequest({
      sessionId: "session_1",
      requestId: "request_late",
      requestKey: "client_msg_legacy",
      payloadHash: "payload_legacy",
      store,
      execute,
    })).rejects.toMatchObject({ code: "chatbot_message_legacy_request_untracked", status: 409 })
    expect(execute).not.toHaveBeenCalled()
    expect(store.requests.size).toBe(0)
  })

  it("allows explicit recovery after failure and rejects same-key payload changes", async () => {
    await expect(coordinateChatbotMessageRequest({
      sessionId: "session_1", requestId: "request_1", requestKey: "client_msg_1",
      payloadHash: "payload_1", store, execute: async () => { throw new Error("failed") },
    })).rejects.toThrow("failed")

    await expect(coordinateChatbotMessageRequest({
      sessionId: "session_1", requestId: "request_2", requestKey: "client_msg_recovery",
      recoverRequestKey: "client_msg_1", payloadHash: "payload_1", store,
      execute: async () => ({ answer: "recovered" }),
    })).resolves.toMatchObject({ result: { answer: "recovered" }, replayed: false })

    await expect(coordinateChatbotMessageRequest({
      sessionId: "session_1", requestId: "request_3", requestKey: "client_msg_1",
      payloadHash: "changed", store, execute: async () => ({ answer: "wrong" }),
    })).rejects.toMatchObject({ code: "chatbot_message_request_payload_mismatch", status: 409 })
  })

  it("does not recover a failed turn after a later turn changed the conversation", async () => {
    await expect(coordinateChatbotMessageRequest({
      sessionId: "session_1", requestId: "request_1", requestKey: "client_msg_1",
      payloadHash: "payload_1", store, execute: async () => { throw new Error("failed") },
    })).rejects.toThrow("failed")
    await coordinateChatbotMessageRequest({
      sessionId: "session_1", requestId: "request_2", requestKey: "client_msg_2",
      payloadHash: "payload_2", store, execute: async () => ({ answer: "later turn" }),
    })

    await expect(coordinateChatbotMessageRequest({
      sessionId: "session_1", requestId: "request_recovery", requestKey: "client_msg_1",
      recoverRequestKey: "client_msg_1", payloadHash: "payload_1", store,
      execute: async () => ({ answer: "stale recovery" }),
    })).rejects.toMatchObject({ code: "chatbot_message_recovery_request_stale", status: 409 })
  })

  it("rejects a distinct turn until the active turn is resolved", async () => {
    const firstExecution = deferred<string>()
    const order: string[] = []
    const first = coordinateChatbotMessageRequest({
      sessionId: "session_1", requestId: "request_1", requestKey: "client_msg_1",
      payloadHash: "payload_1", store, pollIntervalMs: 1,
      execute: async () => { order.push("first-start"); const value = await firstExecution.promise; order.push("first-end"); return value },
    })
    await vi.waitFor(() => expect(store.activeKey).toBe("client_msg_1"))
    await expect(coordinateChatbotMessageRequest({
      sessionId: "session_1", requestId: "request_2", requestKey: "client_msg_2",
      payloadHash: "payload_2", store, pollIntervalMs: 1,
      execute: async () => { order.push("second-start"); return "second" },
    })).rejects.toMatchObject({ code: "chatbot_message_previous_request_processing", status: 503 })
    firstExecution.resolve("first")
    await first
    expect(order).toEqual(["first-start", "first-end"])
  })

  it("rejects completion from an owner that lost its request generation", async () => {
    const execution = deferred<string>()
    const run = coordinateChatbotMessageRequest({
      sessionId: "session_1", requestId: "old_owner", requestKey: "client_msg_1",
      payloadHash: "payload_1", store, execute: () => execution.promise,
    })
    await vi.waitFor(() => expect(store.activeKey).toBe("client_msg_1"))
    const request = store.requests.get("client_msg_1")!
    store.requests.set("client_msg_1", { ...request, owner: "new_owner", version: request.version + 1 })
    store.activeOwner = "new_owner"
    execution.resolve("late result")

    await expect(run).rejects.toMatchObject({ code: "chatbot_message_request_completion_lost" })
  })

  it("replays a transactionally completed result when post-commit work is interrupted", async () => {
    const run = coordinateChatbotMessageRequest({
      sessionId: "session_1",
      requestId: "request_1",
      requestKey: "client_msg_1",
      payloadHash: "payload_1",
      store,
      completeDuringExecute: true,
      execute: async (ownership) => {
        const storedResult = { requestId: "request_1", result: { answer: "committed" } }
        await store.complete({
          conversationId: ownership!.conversationId,
          requestKey: ownership!.requestKey,
          owner: ownership!.owner,
          requestVersion: ownership!.requestVersion,
          resultJson: JSON.stringify(storedResult),
        })
        throw new Error("post-commit notification interrupted")
      },
    })

    await expect(run).resolves.toEqual({
      requestId: "request_1",
      result: { answer: "committed" },
      replayed: true,
    })
  })
})

describe("hashChatbotMessagePayload", () => {
  it("is stable across object key order and changes with semantic input", () => {
    expect(hashChatbotMessagePayload({ b: 2, a: { y: 2, x: 1 } })).toBe(
      hashChatbotMessagePayload({ a: { x: 1, y: 2 }, b: 2 }),
    )
    expect(hashChatbotMessagePayload({ message: "A" })).not.toBe(hashChatbotMessagePayload({ message: "B" }))
  })
})
