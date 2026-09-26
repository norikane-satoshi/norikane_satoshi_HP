import { afterEach, describe, expect, it, vi } from "vitest"

const { findUnique, queryRawUnsafe } = vi.hoisted(() => ({
  findUnique: vi.fn(async () => null),
  queryRawUnsafe: vi.fn(async () => []),
}))
vi.mock("@/lib/prisma", () => ({
  prisma: { chatbotConversation: { findUnique }, $queryRawUnsafe: queryRawUnsafe },
}))

import { warmChatbotDatabase } from "@/lib/chatbot/server/database-warmup"

afterEach(() => vi.clearAllMocks())

describe("warmChatbotDatabase", () => {
  it("runs the claim's read queries without writing anything", async () => {
    await expect(warmChatbotDatabase()).resolves.toBe("warm")
    expect(findUnique).toHaveBeenCalledWith({ where: { sessionId: "__warmup__" }, select: { userId: true } })
    expect(queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('FROM "ChatbotConversation" c'),
      "__warmup__",
      "__warmup__",
      "__warmup__",
    )
  })

  it("reports a failure instead of throwing", async () => {
    findUnique.mockRejectedValueOnce(new Error("database unreachable"))
    await expect(warmChatbotDatabase()).resolves.toBe("failed")
  })
})
