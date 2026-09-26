import { afterEach, describe, expect, it, vi } from "vitest"

const { warmChatbotDatabase } = vi.hoisted(() => ({ warmChatbotDatabase: vi.fn(async () => "warm") }))
vi.mock("@/lib/chatbot/server/database-warmup", () => ({ warmChatbotDatabase }))

import { register } from "@/instrumentation"

afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

describe("register", () => {
  it("warms the chatbot database when a Node.js server instance starts", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs")
    vi.stubEnv("TURSO_DATABASE_URL", "libsql://example.invalid")
    await register()
    expect(warmChatbotDatabase).toHaveBeenCalledOnce()
  })

  it("leaves the edge runtime and database-less builds alone", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge")
    vi.stubEnv("TURSO_DATABASE_URL", "libsql://example.invalid")
    await register()
    vi.stubEnv("NEXT_RUNTIME", "nodejs")
    vi.stubEnv("TURSO_DATABASE_URL", "")
    await register()
    expect(warmChatbotDatabase).not.toHaveBeenCalled()
  })
})
