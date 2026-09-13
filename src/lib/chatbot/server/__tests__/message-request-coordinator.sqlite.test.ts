import { describe, expect, it, vi } from "vitest"

import type { ChatbotMessageRequestOwnership } from "@/lib/chatbot/server/message-request-coordinator"

const describeSqlite = process.env.CHATBOT_COORDINATOR_SQLITE_INTEGRATION === "1" ? describe : describe.skip

describeSqlite("message request coordinator SQLite integration", () => {
  it("waits for an independent writer before claiming the first request", async () => {
    const { createClient } = await import("@libsql/client")
    const { coordinateChatbotMessageRequest } = await import(
      "@/lib/chatbot/server/message-request-coordinator"
    )
    const { prisma } = await import("@/lib/prisma")
    const databaseUrl = process.env.TURSO_DATABASE_URL
    if (!databaseUrl) throw new Error("TURSO_DATABASE_URL is required")
    const sessionId = crypto.randomUUID()
    const conversation = await prisma.chatbotConversation.create({
      data: { sessionId, routingDecision: "continue" },
      select: { id: true },
    })
    const independentClient = createClient({
      url: databaseUrl,
      authToken: process.env.TURSO_AUTH_TOKEN,
    })
    const blockingTransaction = await independentClient.transaction("write")
    await blockingTransaction.execute({
      sql: `UPDATE "ChatbotConversation" SET "lastMessageAt" = "lastMessageAt" WHERE "id" = ?`,
      args: [conversation.id],
    })

    const coordinated = coordinateChatbotMessageRequest({
      sessionId,
      requestId: crypto.randomUUID(),
      requestKey: `client_msg_${crypto.randomUUID()}`,
      payloadHash: "independent_writer_contention",
      execute: async () => ({ accepted: true }),
      pollIntervalMs: 5,
    })
    await new Promise((resolve) => setTimeout(resolve, 75))
    await blockingTransaction.commit()
    independentClient.close()

    await expect(coordinated).resolves.toMatchObject({ result: { accepted: true }, replayed: false })
  })

  it("resolves two pre-claim no-request snapshots through CAS and replay", async () => {
    const { coordinateChatbotMessageRequest, prismaChatbotMessageRequestStore } = await import(
      "@/lib/chatbot/server/message-request-coordinator"
    )
    let initialLoadCount = 0
    let releaseInitialLoads!: () => void
    const initialLoadsReady = new Promise<void>((resolve) => { releaseInitialLoads = resolve })
    const synchronizedStore = {
      ...prismaChatbotMessageRequestStore,
      load: async (input: Parameters<typeof prismaChatbotMessageRequestStore.load>[0]) => {
        const snapshot = await prismaChatbotMessageRequestStore.load(input)
        if (!snapshot.request && initialLoadCount < 2) {
          initialLoadCount += 1
          if (initialLoadCount === 2) releaseInitialLoads()
          await initialLoadsReady
        }
        return snapshot
      },
    }
    let releaseExecution!: () => void
    const executionGate = new Promise<void>((resolve) => { releaseExecution = resolve })
    const execute = vi.fn(async () => {
      await executionGate
      return { answer: "single CAS winner" }
    })
    const common = {
      sessionId: crypto.randomUUID(),
      requestKey: `client_msg_${crypto.randomUUID()}`,
      payloadHash: "synchronized_initial_load",
      store: synchronizedStore,
      execute,
      pollIntervalMs: 5,
    }

    const first = coordinateChatbotMessageRequest({ ...common, requestId: crypto.randomUUID() })
    const second = coordinateChatbotMessageRequest({ ...common, requestId: crypto.randomUUID() })
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce())
    releaseExecution()

    const results = await Promise.all([first, second])
    expect(results.filter((result) => !result.replayed)).toHaveLength(1)
    expect(results.filter((result) => result.replayed)).toHaveLength(1)
    expect(execute).toHaveBeenCalledOnce()
  })

  it("coordinates concurrent workers through the real database store", async () => {
    const { assertChatbotMessageRequestOwnership, coordinateChatbotMessageRequest } = await import(
      "@/lib/chatbot/server/message-request-coordinator"
    )
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const execute = vi.fn(async (ownership?: ChatbotMessageRequestOwnership) => {
      expect(ownership).toBeDefined()
      await assertChatbotMessageRequestOwnership(ownership!)
      await gate
      await assertChatbotMessageRequestOwnership(ownership!)
      return { answer: "single database-backed result" }
    })
    const sessionId = crypto.randomUUID()
    const common = {
      sessionId,
      requestKey: `client_msg_${crypto.randomUUID()}`,
      payloadHash: "integration_payload",
      execute,
      pollIntervalMs: 5,
    }

    const first = coordinateChatbotMessageRequest({ ...common, requestId: crypto.randomUUID() })
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce())
    const second = coordinateChatbotMessageRequest({ ...common, requestId: crypto.randomUUID() })
    release()

    const [firstResult, secondResult] = await Promise.all([first, second])
    expect(firstResult.replayed).toBe(false)
    expect(secondResult).toEqual({ ...firstResult, replayed: true })
    expect(execute).toHaveBeenCalledOnce()
  })

  it("atomically persists the assistant and replay result before releasing the session", async () => {
    const { coordinateChatbotMessageRequest, finalizeChatbotMessageRequest } = await import(
      "@/lib/chatbot/server/message-request-coordinator"
    )
    const { persistChatbotMessageFinalization } = await import("@/lib/chatbot/server/repository")
    const { prisma } = await import("@/lib/prisma")
    const sessionId = crypto.randomUUID()
    const requestKey = `client_msg_${crypto.randomUUID()}`
    const assistantId = crypto.randomUUID()
    const execute = vi.fn(async (ownership?: ChatbotMessageRequestOwnership) => {
      expect(ownership).toBeDefined()
      const result = {
        conversationId: ownership!.conversationId,
        assistantMessage: {
          id: assistantId,
          role: "assistant" as const,
          content: "確定済み回答",
          createdAt: new Date().toISOString(),
        },
      }
      await finalizeChatbotMessageRequest({
        ownership: ownership!,
        resultJson: JSON.stringify({ requestId: ownership!.owner, result }),
        persistBusinessData: (transaction) => persistChatbotMessageFinalization(transaction, {
          conversationId: ownership!.conversationId,
          assistantMessage: result.assistantMessage,
        }),
      })
      return result
    })
    const input = {
      sessionId,
      requestKey,
      payloadHash: "atomic_payload",
      completeDuringExecute: true,
      execute,
    }

    const first = await coordinateChatbotMessageRequest({ ...input, requestId: crypto.randomUUID() })
    const replay = await coordinateChatbotMessageRequest({ ...input, requestId: crypto.randomUUID() })

    expect(first.replayed).toBe(false)
    expect(replay).toEqual({ ...first, replayed: true })
    expect(execute).toHaveBeenCalledOnce()
    await expect(prisma.chatbotMessage.count({ where: { id: assistantId } })).resolves.toBe(1)
  })

  it("rolls back request completion when business persistence fails", async () => {
    const { coordinateChatbotMessageRequest, finalizeChatbotMessageRequest } = await import(
      "@/lib/chatbot/server/message-request-coordinator"
    )
    const { prisma } = await import("@/lib/prisma")
    const sessionId = crypto.randomUUID()
    const requestKey = `client_msg_${crypto.randomUUID()}`
    const assistantId = crypto.randomUUID()

    await expect(coordinateChatbotMessageRequest({
      sessionId,
      requestId: crypto.randomUUID(),
      requestKey,
      payloadHash: "rollback_payload",
      completeDuringExecute: true,
      execute: async (ownership) => {
        await finalizeChatbotMessageRequest({
          ownership: ownership!,
          resultJson: JSON.stringify({ requestId: ownership!.owner, result: { ok: true } }),
          persistBusinessData: async (transaction) => {
            await transaction.chatbotMessage.create({
              data: {
                id: assistantId,
                conversationId: ownership!.conversationId,
                role: "assistant",
                content: "rollback",
              },
            })
            throw new Error("forced business persistence failure")
          },
        })
        return { ok: true }
      },
    })).rejects.toThrow("forced business persistence failure")

    await expect(prisma.chatbotMessage.count({ where: { id: assistantId } })).resolves.toBe(0)
    const rows = await prisma.$queryRawUnsafe<Array<{ status: string }>>(
      `SELECT "status" FROM "ChatbotMessageRequest" WHERE "key" = ?`,
      requestKey,
    )
    expect(rows[0]?.status).toBe("failed")
  })

  it("rejects an old owner at finalization and failure boundaries after a new owner reclaims", async () => {
    const { coordinateChatbotMessageRequest, finalizeChatbotMessageRequest } = await import(
      "@/lib/chatbot/server/message-request-coordinator"
    )
    const { prisma } = await import("@/lib/prisma")
    const sessionId = crypto.randomUUID()
    const requestKey = `client_msg_${crypto.randomUUID()}`
    let oldOwnership!: ChatbotMessageRequestOwnership
    let newOwnership!: ChatbotMessageRequestOwnership
    let releaseOld!: () => void
    let releaseNew!: () => void
    const oldGate = new Promise<void>((resolve) => { releaseOld = resolve })
    const newGate = new Promise<void>((resolve) => { releaseNew = resolve })
    const oldAssistantId = crypto.randomUUID()
    const newAssistantId = crypto.randomUUID()

    const oldRun = coordinateChatbotMessageRequest({
      sessionId,
      requestId: crypto.randomUUID(),
      requestKey,
      payloadHash: "owner_fence_payload",
      completeDuringExecute: true,
      execute: async (ownership) => {
        oldOwnership = ownership!
        await oldGate
        await finalizeChatbotMessageRequest({
          ownership: oldOwnership,
          resultJson: JSON.stringify({ requestId: oldOwnership.owner, result: { owner: "old" } }),
          persistBusinessData: async (transaction) => {
            await transaction.chatbotMessage.create({
              data: {
                id: oldAssistantId,
                conversationId: oldOwnership.conversationId,
                role: "assistant",
                content: "must roll back",
              },
            })
          },
        })
        return { owner: "old" }
      },
    })
    await vi.waitFor(() => expect(oldOwnership).toBeDefined())
    await prisma.$executeRawUnsafe(
      `UPDATE "ChatbotConversation" SET "messageRequestLeaseExpiresAt" = ? WHERE "id" = ?`,
      new Date(0).toISOString(),
      oldOwnership.conversationId,
    )
    await prisma.$executeRawUnsafe(
      `UPDATE "ChatbotMessageRequest" SET "leaseExpiresAt" = ? WHERE "key" = ?`,
      new Date(0).toISOString(),
      requestKey,
    )

    const newRun = coordinateChatbotMessageRequest({
      sessionId,
      requestId: crypto.randomUUID(),
      requestKey,
      recoverRequestKey: requestKey,
      payloadHash: "owner_fence_payload",
      completeDuringExecute: true,
      execute: async (ownership) => {
        newOwnership = ownership!
        await newGate
        await finalizeChatbotMessageRequest({
          ownership: newOwnership,
          resultJson: JSON.stringify({ requestId: newOwnership.owner, result: { owner: "new" } }),
          persistBusinessData: async (transaction) => {
            await transaction.chatbotMessage.create({
              data: {
                id: newAssistantId,
                conversationId: newOwnership.conversationId,
                role: "assistant",
                content: "new owner result",
              },
            })
          },
        })
        return { owner: "new" }
      },
    })
    await vi.waitFor(() => expect(newOwnership).toBeDefined())

    releaseOld()
    await expect(oldRun).rejects.toMatchObject({ code: "chatbot_message_request_ownership_lost" })
    await expect(prisma.chatbotMessage.count({ where: { id: oldAssistantId } })).resolves.toBe(0)
    const retained = await prisma.$queryRawUnsafe<Array<{
      status: string
      owner: string | null
      activeMessageRequestOwner: string | null
    }>>(
      `SELECT r."status", r."owner", c."activeMessageRequestOwner"
       FROM "ChatbotMessageRequest" r
       JOIN "ChatbotConversation" c ON c."id" = r."conversationId"
       WHERE r."key" = ?`,
      requestKey,
    )
    expect(retained[0]).toEqual({
      status: "processing",
      owner: newOwnership.owner,
      activeMessageRequestOwner: newOwnership.owner,
    })

    releaseNew()
    await expect(newRun).resolves.toMatchObject({ result: { owner: "new" }, replayed: false })
    await expect(prisma.chatbotMessage.count({ where: { id: newAssistantId } })).resolves.toBe(1)
  })

  it("rejects an old owner at the normal user insert and lets the reclaiming handler finish once", async () => {
    const {
      appendChatbotMessageRequestUserMessage,
      assertChatbotMessageRequestOwnership,
      coordinateChatbotMessageRequest,
      finalizeChatbotMessageRequest,
      recoverChatbotMessageRequestUserMessage,
    } = await import("@/lib/chatbot/server/message-request-coordinator")
    const { handleChatbotMessage } = await import("@/lib/chatbot/server/message-handler")
    const { createChatbotLlmDisplayEnvelope } = await import("@/lib/chatbot/server/llm-response-normalizer")
    const { createStaticChatbotKnowledgeSnapshot } = await import("@/lib/chatbot/server/notion-knowledge-sync")
    const { persistChatbotMessageFinalization } = await import("@/lib/chatbot/server/repository")
    const { prisma } = await import("@/lib/prisma")
    const sessionId = crypto.randomUUID()
    const requestKey = `client_msg_${crypto.randomUUID()}`
    const payloadHash = "normal_user_insert_fence"
    const rawText = "<customer_reply>新ownerだけが確定しました</customer_reply>"
    const generate = vi.fn().mockResolvedValue({
      rawText,
      displayEnvelope: createChatbotLlmDisplayEnvelope(rawText),
      tier: "tier-1-hosted-chrome-notion-ai" as const,
    })
    const baseOptions = {
      orchestratorFactory: () => ({ generate, isHealthy: vi.fn().mockResolvedValue(true) }),
      knowledgeSnapshotLoader: vi.fn().mockResolvedValue(createStaticChatbotKnowledgeSnapshot()),
      slackNotifier: vi.fn().mockResolvedValue({ status: "skipped" as const, reason: "disabled" }),
    }
    let oldOwnership!: ChatbotMessageRequestOwnership
    let oldInsertEntered!: () => void
    const oldInsertStarted = new Promise<void>((resolve) => { oldInsertEntered = resolve })
    let releaseOldInsert!: () => void
    const oldInsertGate = new Promise<void>((resolve) => { releaseOldInsert = resolve })

    const oldRun = coordinateChatbotMessageRequest({
      sessionId,
      requestId: crypto.randomUUID(),
      requestKey,
      payloadHash,
      completeDuringExecute: true,
      execute: (ownership) => {
        oldOwnership = ownership!
        return handleChatbotMessage(
          { sessionId, message: "通常相談", clientUserMessageId: requestKey },
          {
            ...baseOptions,
            assertRequestOwnership: () => assertChatbotMessageRequestOwnership(oldOwnership),
            appendOwnedUserMessage: async ({ content }) => {
              oldInsertEntered()
              await oldInsertGate
              return appendChatbotMessageRequestUserMessage({ ownership: oldOwnership, content })
            },
          },
        )
      },
    })
    await oldInsertStarted
    await prisma.$executeRawUnsafe(
      `UPDATE "ChatbotConversation" SET "messageRequestLeaseExpiresAt" = ? WHERE "id" = ?`,
      new Date(0).toISOString(),
      oldOwnership.conversationId,
    )
    await prisma.$executeRawUnsafe(
      `UPDATE "ChatbotMessageRequest" SET "leaseExpiresAt" = ? WHERE "key" = ?`,
      new Date(0).toISOString(),
      requestKey,
    )

    const winner = await coordinateChatbotMessageRequest({
      sessionId,
      requestId: crypto.randomUUID(),
      requestKey,
      recoverRequestKey: requestKey,
      payloadHash,
      completeDuringExecute: true,
      execute: (ownership) => handleChatbotMessage(
        {
          sessionId,
          message: "通常相談",
          clientUserMessageId: requestKey,
          recoverClientUserMessageId: requestKey,
          pendingRequestKind: "message",
        },
        {
          ...baseOptions,
          assertRequestOwnership: () => assertChatbotMessageRequestOwnership(ownership!),
          appendOwnedUserMessage: ({ content }) => appendChatbotMessageRequestUserMessage({
            ownership: ownership!,
            content,
          }),
          recoverPendingUserMessage: ({ content }) => recoverChatbotMessageRequestUserMessage({
            ownership: ownership!,
            content,
          }),
          finalizeMessage: (finalization) => finalizeChatbotMessageRequest({
            ownership: ownership!,
            resultJson: JSON.stringify({ requestId: ownership!.owner, result: finalization.replayResult }),
            persistBusinessData: (transaction) => persistChatbotMessageFinalization(transaction, finalization),
          }),
        },
      ),
    })
    expect(winner.replayed).toBe(false)

    releaseOldInsert()
    await expect(oldRun).resolves.toMatchObject({ requestId: winner.requestId, replayed: true })
    await expect(prisma.chatbotMessage.count({
      where: { conversation: { sessionId }, id: requestKey, role: "user" },
    })).resolves.toBe(1)
    await expect(prisma.chatbotMessage.count({
      where: { conversation: { sessionId }, role: "assistant" },
    })).resolves.toBe(1)
    expect(generate).toHaveBeenCalledOnce()
  })

  it("runs actual-handler recovery atomically and rejects a simultaneous next turn", async () => {
    const {
      appendChatbotMessageRequestUserMessage,
      assertChatbotMessageRequestOwnership,
      coordinateChatbotMessageRequest,
      finalizeChatbotMessageRequest,
      recoverChatbotMessageRequestUserMessage,
    } = await import("@/lib/chatbot/server/message-request-coordinator")
    const { handleChatbotMessage } = await import("@/lib/chatbot/server/message-handler")
    const { createChatbotLlmDisplayEnvelope } = await import("@/lib/chatbot/server/llm-response-normalizer")
    const { createStaticChatbotKnowledgeSnapshot } = await import("@/lib/chatbot/server/notion-knowledge-sync")
    const { persistChatbotMessageFinalization } = await import("@/lib/chatbot/server/repository")
    const { prisma } = await import("@/lib/prisma")
    const sessionId = crypto.randomUUID()
    const requestKey = `client_msg_${crypto.randomUUID()}`
    const payloadHash = "actual_handler_recovery_payload"
    const rawText = "<customer_reply>安全に復旧しました</customer_reply>"
    let releaseGeneration!: () => void
    const generationGate = new Promise<void>((resolve) => { releaseGeneration = resolve })
    let blockGeneration = false
    const generate = vi.fn(async () => {
      if (blockGeneration) await generationGate
      return {
        rawText,
        displayEnvelope: createChatbotLlmDisplayEnvelope(rawText),
        tier: "tier-1-hosted-chrome-notion-ai" as const,
      }
    })
    const baseOptions = {
      orchestratorFactory: () => ({ generate, isHealthy: vi.fn().mockResolvedValue(true) }),
      knowledgeSnapshotLoader: vi.fn().mockResolvedValue(createStaticChatbotKnowledgeSnapshot()),
      slackNotifier: vi.fn().mockResolvedValue({ status: "skipped" as const, reason: "disabled" }),
    }

    await expect(coordinateChatbotMessageRequest({
      sessionId,
      requestId: crypto.randomUUID(),
      requestKey,
      payloadHash,
      completeDuringExecute: true,
      execute: (ownership) => handleChatbotMessage(
        { sessionId, message: "復旧対象の相談", clientUserMessageId: requestKey },
        {
          ...baseOptions,
          assertRequestOwnership: () => assertChatbotMessageRequestOwnership(ownership!),
          appendOwnedUserMessage: ({ content }) => appendChatbotMessageRequestUserMessage({
            ownership: ownership!,
            content,
          }),
          finalizeMessage: async () => { throw new Error("forced interruption after user persistence") },
        },
      ),
    })).rejects.toThrow("forced interruption after user persistence")
    await expect(prisma.chatbotMessage.count({
      where: { conversation: { sessionId }, role: "user" },
    })).resolves.toBe(1)
    await expect(prisma.chatbotMessage.count({
      where: { conversation: { sessionId }, role: "assistant" },
    })).resolves.toBe(0)

    const unrelatedExecute = vi.fn(async () => ({ shouldNotRun: true }))
    await expect(coordinateChatbotMessageRequest({
      sessionId,
      requestId: crypto.randomUUID(),
      requestKey: `client_msg_${crypto.randomUUID()}`,
      payloadHash: "unrelated_turn_before_recovery",
      execute: unrelatedExecute,
    })).rejects.toMatchObject({
      code: "chatbot_message_previous_request_recovery_required",
      status: 409,
    })
    expect(unrelatedExecute).not.toHaveBeenCalled()
    await expect(prisma.chatbotMessage.count({
      where: { conversation: { sessionId }, role: "user" },
    })).resolves.toBe(1)
    await expect(prisma.chatbotMessage.count({
      where: { conversation: { sessionId }, role: "assistant" },
    })).resolves.toBe(0)

    blockGeneration = true
    const recovery = coordinateChatbotMessageRequest({
      sessionId,
      requestId: crypto.randomUUID(),
      requestKey,
      recoverRequestKey: requestKey,
      payloadHash,
      completeDuringExecute: true,
      execute: (ownership) => handleChatbotMessage(
        {
          sessionId,
          message: "復旧対象の相談",
          clientUserMessageId: requestKey,
          recoverClientUserMessageId: requestKey,
          pendingRequestKind: "message",
        },
        {
          ...baseOptions,
          assertRequestOwnership: () => assertChatbotMessageRequestOwnership(ownership!),
          recoverPendingUserMessage: ({ content }) => recoverChatbotMessageRequestUserMessage({
            ownership: ownership!,
            content,
          }),
          finalizeMessage: (finalization) => finalizeChatbotMessageRequest({
            ownership: ownership!,
            resultJson: JSON.stringify({ requestId: ownership!.owner, result: finalization.replayResult }),
            persistBusinessData: (transaction) => persistChatbotMessageFinalization(transaction, finalization),
          }),
        },
      ),
    })
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(2))

    await expect(coordinateChatbotMessageRequest({
      sessionId,
      requestId: crypto.randomUUID(),
      requestKey: `client_msg_${crypto.randomUUID()}`,
      payloadHash: "simultaneous_next_turn",
      execute: async () => ({ shouldNotRun: true }),
    })).rejects.toMatchObject({ code: "chatbot_message_previous_request_processing", status: 503 })

    releaseGeneration()
    await expect(recovery).resolves.toMatchObject({ replayed: false })
    await expect(prisma.chatbotMessage.count({
      where: { conversation: { sessionId }, role: "user" },
    })).resolves.toBe(1)
    await expect(prisma.chatbotMessage.count({
      where: { conversation: { sessionId }, role: "assistant" },
    })).resolves.toBe(1)
  })

  it("does not block the next request when a failed request never saved a user message", async () => {
    const { coordinateChatbotMessageRequest } = await import(
      "@/lib/chatbot/server/message-request-coordinator"
    )
    const sessionId = crypto.randomUUID()

    await expect(coordinateChatbotMessageRequest({
      sessionId,
      requestId: crypto.randomUUID(),
      requestKey: `client_msg_${crypto.randomUUID()}`,
      payloadHash: "failed_before_user_insert",
      execute: async () => { throw new Error("failed before user insert") },
    })).rejects.toThrow("failed before user insert")

    await expect(coordinateChatbotMessageRequest({
      sessionId,
      requestId: crypto.randomUUID(),
      requestKey: `client_msg_${crypto.randomUUID()}`,
      payloadHash: "next_request_after_empty_failure",
      execute: async () => ({ accepted: true }),
    })).resolves.toMatchObject({ result: { accepted: true }, replayed: false })
  })

  it("recovers a failed actual-handler edit by its saved request id and preserves prior history", async () => {
    const {
      assertChatbotMessageRequestOwnership,
      coordinateChatbotMessageRequest,
      finalizeChatbotMessageRequest,
      recoverChatbotMessageRequestUserMessage,
      replaceChatbotMessageRequestUserMessage,
    } = await import("@/lib/chatbot/server/message-request-coordinator")
    const { handleChatbotMessage } = await import("@/lib/chatbot/server/message-handler")
    const { createChatbotLlmDisplayEnvelope } = await import("@/lib/chatbot/server/llm-response-normalizer")
    const { createStaticChatbotKnowledgeSnapshot } = await import("@/lib/chatbot/server/notion-knowledge-sync")
    const { persistChatbotMessageFinalization } = await import("@/lib/chatbot/server/repository")
    const { prisma } = await import("@/lib/prisma")
    const sessionId = crypto.randomUUID()
    const priorUserId = crypto.randomUUID()
    const priorAssistantId = crypto.randomUUID()
    const originalEditTargetId = crypto.randomUUID()
    const originalEditAssistantId = crypto.randomUUID()
    const requestKey = `client_msg_${crypto.randomUUID()}`
    const payloadHash = "actual_handler_edit_recovery"
    await prisma.chatbotConversation.create({
      data: {
        sessionId,
        routingDecision: "continue",
        messages: {
          create: [
            { id: priorUserId, role: "user", content: "先行相談", createdAt: new Date("2026-09-13T00:00:00Z") },
            { id: priorAssistantId, role: "assistant", content: "先行回答", createdAt: new Date("2026-09-13T00:00:01Z") },
            { id: originalEditTargetId, role: "user", content: "編集前", createdAt: new Date("2026-09-13T00:00:02Z") },
            { id: originalEditAssistantId, role: "assistant", content: "編集前回答", createdAt: new Date("2026-09-13T00:00:03Z") },
          ],
        },
      },
    })
    const rawText = "<customer_reply>編集を安全に復旧しました</customer_reply>"
    const generate = vi.fn().mockResolvedValue({
      rawText,
      displayEnvelope: createChatbotLlmDisplayEnvelope(rawText),
      tier: "tier-1-hosted-chrome-notion-ai" as const,
    })
    const baseOptions = {
      orchestratorFactory: () => ({ generate, isHealthy: vi.fn().mockResolvedValue(true) }),
      knowledgeSnapshotLoader: vi.fn().mockResolvedValue(createStaticChatbotKnowledgeSnapshot()),
      slackNotifier: vi.fn().mockResolvedValue({ status: "skipped" as const, reason: "disabled" }),
    }

    await expect(coordinateChatbotMessageRequest({
      sessionId,
      requestId: crypto.randomUUID(),
      requestKey,
      payloadHash,
      completeDuringExecute: true,
      execute: (ownership) => handleChatbotMessage(
        {
          sessionId,
          message: "編集後",
          clientUserMessageId: requestKey,
          editTargetMessageId: originalEditTargetId,
          pendingRequestKind: "edit",
        },
        {
          ...baseOptions,
          assertRequestOwnership: () => assertChatbotMessageRequestOwnership(ownership!),
          replaceEditedUserMessage: ({ targetMessageId, content }) =>
            replaceChatbotMessageRequestUserMessage({ ownership: ownership!, targetMessageId, content }),
          finalizeMessage: async () => { throw new Error("forced edit interruption after user persistence") },
        },
      ),
    })).rejects.toThrow("forced edit interruption after user persistence")
    await expect(prisma.chatbotMessage.findMany({
      where: { conversation: { sessionId } },
      orderBy: { createdAt: "asc" },
      select: { id: true, role: true },
    })).resolves.toEqual([
      { id: priorUserId, role: "user" },
      { id: priorAssistantId, role: "assistant" },
      { id: requestKey, role: "user" },
    ])

    const recoveryExecute = vi.fn((ownership?: ChatbotMessageRequestOwnership) => handleChatbotMessage(
      {
        sessionId,
        message: "編集後",
        clientUserMessageId: requestKey,
        recoverClientUserMessageId: requestKey,
        editTargetMessageId: originalEditTargetId,
        pendingRequestKind: "edit",
      },
      {
        ...baseOptions,
        assertRequestOwnership: () => assertChatbotMessageRequestOwnership(ownership!),
        recoverPendingUserMessage: ({ content }) => recoverChatbotMessageRequestUserMessage({
          ownership: ownership!,
          content,
        }),
        replaceEditedUserMessage: ({ targetMessageId, content }) =>
          replaceChatbotMessageRequestUserMessage({ ownership: ownership!, targetMessageId, content }),
        finalizeMessage: (finalization) => finalizeChatbotMessageRequest({
          ownership: ownership!,
          resultJson: JSON.stringify({ requestId: ownership!.owner, result: finalization.replayResult }),
          persistBusinessData: (transaction) => persistChatbotMessageFinalization(transaction, finalization),
        }),
      },
    ))
    const recoveryInput = {
      sessionId,
      requestKey,
      recoverRequestKey: requestKey,
      payloadHash,
      completeDuringExecute: true,
      execute: recoveryExecute,
    }
    const recovered = await coordinateChatbotMessageRequest({
      ...recoveryInput,
      requestId: crypto.randomUUID(),
    })
    const replayed = await coordinateChatbotMessageRequest({
      ...recoveryInput,
      requestId: crypto.randomUUID(),
    })

    expect(recovered.replayed).toBe(false)
    const publicRecoveredResult = { ...recovered.result }
    Reflect.deleteProperty(publicRecoveredResult, "auditEvidence")
    expect(replayed).toEqual({
      requestId: recovered.requestId,
      result: JSON.parse(JSON.stringify(publicRecoveredResult)),
      replayed: true,
    })
    expect(recoveryExecute).toHaveBeenCalledOnce()
    const finalMessages = await prisma.chatbotMessage.findMany({
      where: { conversation: { sessionId } },
      orderBy: { createdAt: "asc" },
      select: { id: true, role: true, content: true },
    })
    expect(finalMessages.slice(0, 2)).toEqual([
      { id: priorUserId, role: "user", content: "先行相談" },
      { id: priorAssistantId, role: "assistant", content: "先行回答" },
    ])
    expect(finalMessages.filter((message) => message.id === requestKey)).toHaveLength(1)
    expect(finalMessages.filter((message) => message.role === "assistant" && message.id !== priorAssistantId)).toHaveLength(1)
    expect(finalMessages.some((message) => message.id === originalEditTargetId)).toBe(false)
    expect(finalMessages.some((message) => message.id === originalEditAssistantId)).toBe(false)
  })

  it("rejects a pre-migration message id without inserting a request or running the LLM", async () => {
    const { coordinateChatbotMessageRequest } = await import(
      "@/lib/chatbot/server/message-request-coordinator"
    )
    const { prisma } = await import("@/lib/prisma")
    const sessionId = crypto.randomUUID()
    const requestKey = `client_msg_${crypto.randomUUID()}`
    const conversation = await prisma.chatbotConversation.create({
      data: {
        sessionId,
        routingDecision: "continue",
        messages: { create: { id: requestKey, role: "user", content: "migration前の保存済み要求" } },
      },
    })
    const execute = vi.fn(async () => ({ answer: "must not run" }))

    await expect(coordinateChatbotMessageRequest({
      sessionId,
      requestId: crypto.randomUUID(),
      requestKey,
      payloadHash: "legacy_payload",
      execute,
    })).rejects.toMatchObject({ code: "chatbot_message_legacy_request_untracked", status: 409 })
    expect(execute).not.toHaveBeenCalled()
    const requestRows = await prisma.$queryRawUnsafe<Array<{ count: number | bigint }>>(
      `SELECT COUNT(*) AS "count" FROM "ChatbotMessageRequest" WHERE "key" = ?`,
      requestKey,
    )
    expect(Number(requestRows[0]?.count ?? 0)).toBe(0)
    await expect(prisma.chatbotMessage.count({ where: { conversationId: conversation.id } })).resolves.toBe(1)
  })

  it("prevents an old edit owner from deleting history after a reclaim has completed", async () => {
    const {
      assertChatbotMessageRequestOwnership,
      coordinateChatbotMessageRequest,
      finalizeChatbotMessageRequest,
      replaceChatbotMessageRequestUserMessage,
    } = await import("@/lib/chatbot/server/message-request-coordinator")
    const { handleChatbotMessage } = await import("@/lib/chatbot/server/message-handler")
    const { createStaticChatbotKnowledgeSnapshot } = await import("@/lib/chatbot/server/notion-knowledge-sync")
    const { prisma } = await import("@/lib/prisma")
    const sessionId = crypto.randomUUID()
    const requestKey = `client_msg_${crypto.randomUUID()}`
    const originalUserId = crypto.randomUUID()
    const originalAssistantId = crypto.randomUUID()
    const winnerAssistantId = crypto.randomUUID()
    const conversation = await prisma.chatbotConversation.create({
      data: {
        sessionId,
        routingDecision: "continue",
        messages: {
          create: [
            { id: originalUserId, role: "user", content: "編集前", createdAt: new Date("2026-09-13T00:00:00Z") },
            { id: originalAssistantId, role: "assistant", content: "元の回答", createdAt: new Date("2026-09-13T00:00:01Z") },
          ],
        },
      },
    })
    let oldOwnership!: ChatbotMessageRequestOwnership
    let replacementEntered!: () => void
    const replacementStarted = new Promise<void>((resolve) => { replacementEntered = resolve })
    let releaseReplacement!: () => void
    const replacementGate = new Promise<void>((resolve) => { releaseReplacement = resolve })
    const generate = vi.fn()

    const oldRun = coordinateChatbotMessageRequest({
      sessionId,
      requestId: crypto.randomUUID(),
      requestKey,
      payloadHash: "edit_owner_fence",
      completeDuringExecute: true,
      execute: (ownership) => {
        oldOwnership = ownership!
        return handleChatbotMessage(
          {
            sessionId,
            message: "編集後",
            clientUserMessageId: requestKey,
            editTargetMessageId: originalUserId,
            pendingRequestKind: "edit",
          },
          {
            orchestratorFactory: () => ({ generate, isHealthy: vi.fn().mockResolvedValue(true) }),
            knowledgeSnapshotLoader: vi.fn().mockResolvedValue(createStaticChatbotKnowledgeSnapshot()),
            slackNotifier: vi.fn().mockResolvedValue({ status: "skipped" as const, reason: "disabled" }),
            assertRequestOwnership: () => assertChatbotMessageRequestOwnership(oldOwnership),
            replaceEditedUserMessage: async ({ targetMessageId, content }) => {
              replacementEntered()
              await replacementGate
              return replaceChatbotMessageRequestUserMessage({
                ownership: oldOwnership,
                targetMessageId,
                content,
              })
            },
          },
        )
      },
    })
    await replacementStarted
    await prisma.$executeRawUnsafe(
      `UPDATE "ChatbotConversation" SET "messageRequestLeaseExpiresAt" = ? WHERE "id" = ?`,
      new Date(0).toISOString(),
      conversation.id,
    )
    await prisma.$executeRawUnsafe(
      `UPDATE "ChatbotMessageRequest" SET "leaseExpiresAt" = ? WHERE "key" = ?`,
      new Date(0).toISOString(),
      requestKey,
    )

    const winner = await coordinateChatbotMessageRequest({
      sessionId,
      requestId: crypto.randomUUID(),
      requestKey,
      recoverRequestKey: requestKey,
      payloadHash: "edit_owner_fence",
      completeDuringExecute: true,
      execute: async (ownership) => {
        await finalizeChatbotMessageRequest({
          ownership: ownership!,
          resultJson: JSON.stringify({ requestId: ownership!.owner, result: { owner: "winner" } }),
          persistBusinessData: async (transaction) => {
            await transaction.chatbotConversation.update({
              where: { id: conversation.id },
              data: {
                routingDecision: "to-email",
                messages: {
                  create: {
                    id: winnerAssistantId,
                    role: "assistant",
                    content: "勝者の確定履歴",
                    createdAt: new Date("2026-09-13T00:00:02Z"),
                  },
                },
              },
            })
          },
        })
        return { owner: "winner" }
      },
    })
    expect(winner).toMatchObject({ result: { owner: "winner" }, replayed: false })

    releaseReplacement()
    await expect(oldRun).resolves.toMatchObject({ result: { owner: "winner" }, replayed: true })
    const messages = await prisma.chatbotMessage.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: "asc" },
      select: { id: true, content: true },
    })
    expect(messages).toEqual([
      { id: originalUserId, content: "編集前" },
      { id: originalAssistantId, content: "元の回答" },
      { id: winnerAssistantId, content: "勝者の確定履歴" },
    ])
    await expect(prisma.chatbotConversation.findUnique({
      where: { id: conversation.id },
      select: { routingDecision: true },
    })).resolves.toEqual({ routingDecision: "to-email" })
    expect(generate).not.toHaveBeenCalled()
  })
})
