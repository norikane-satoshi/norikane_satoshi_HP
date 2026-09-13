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
})
