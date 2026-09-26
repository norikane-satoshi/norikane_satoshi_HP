import { afterEach, describe, expect, it, vi } from "vitest"

const { queryRawUnsafe, findUnique } = vi.hoisted(() => ({
  queryRawUnsafe: vi.fn(async () => [{ ok: 1 }]),
  findUnique: vi.fn(async () => null),
}))
vi.mock("@/lib/prisma", () => ({
  prisma: { $queryRawUnsafe: queryRawUnsafe, chatbotConversation: { findUnique } },
}))

import { warmChatbotDatabase } from "@/lib/chatbot/server/database-warmup"

afterEach(() => vi.clearAllMocks())

describe("warmChatbotDatabase", () => {
  it("opens the connection and runs a model query, so the first message does not pay for either", async () => {
    await expect(warmChatbotDatabase()).resolves.toBe("warm")
    expect(queryRawUnsafe).toHaveBeenCalledWith("SELECT 1")
    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({ select: { id: true } }))
  })

  it("reports a failure instead of throwing, because a cold database must not stop the server starting", async () => {
    queryRawUnsafe.mockRejectedValueOnce(new Error("database unreachable"))
    await expect(warmChatbotDatabase()).resolves.toBe("failed")
  })
})
