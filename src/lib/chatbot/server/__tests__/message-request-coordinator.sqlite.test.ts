import { describe, expect, it, vi } from "vitest"

import type { ChatbotMessageRequestOwnership } from "@/lib/chatbot/server/message-request-coordinator"

const describeSqlite = process.env.CHATBOT_COORDINATOR_SQLITE_INTEGRATION === "1" ? describe : describe.skip

describeSqlite("message request coordinator SQLite integration", () => {
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

  it("runs actual-handler recovery atomically and rejects a simultaneous next turn", async () => {
    const {
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
})
