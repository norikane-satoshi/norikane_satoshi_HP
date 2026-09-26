import { beforeEach, describe, expect, it, vi } from "vitest"
import { createHostedWorkerQueue, generateHostedWorkerResponse } from "@/lib/chatbot/hosted-worker/generate"
import { createHostedWorkerRuntimeState } from "@/lib/chatbot/hosted-worker/health"
import { HiddenThreadPool } from "@/lib/chatbot/hosted-worker/notion-ai-thread-pool"
import type { ChatbotLlmRequest } from "@/lib/chatbot/server/llm-client"

const mocks = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(), client: vi.fn() }))
vi.mock("@/lib/chatbot/hosted-worker/notion-ai-conversation-thread-store", async importOriginal => ({
  ...await importOriginal<object>(), readNotionAiConversationThread: mocks.read,
  writeNotionAiConversationThread: mocks.write,
}))
vi.mock("@/lib/chatbot/hosted-worker/notion-ai-browser-client", async importOriginal => ({
  ...await importOriginal<object>(), createHostedNotionAiBrowserClient: mocks.client,
}))

const url = "https://app.notion.com/chat?t=aaaabbbbccccddddeeeeffff00001111"
const customer = "cmug7g0ws000204l5y1yrjkdh"
function request(conversationId: string): ChatbotLlmRequest {
  return { requestId: "pool-test", conversationId, systemPrompt: "test", latestUserMessage: "test",
    messages: [{ role: "user", content: "test" }], jobContext: {
      jobKind: "cm-30s", finalMedium: "web", workSite: "remote-grading",
      documentaryAttachment: { kind: "none" },
    },
    conversationState: { hasFinalMedium: false, hasJobKind: false, hasAdditionalWork: false,
      hasDocumentaryAttachments: false, hasWorkSite: false, hasReferenceUrls: false,
      hasContactEmail: false, hasDesiredSchedule: false, turnCount: 1 } }
}
describe("customer inventory integration", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.read.mockResolvedValue(undefined)
    mocks.write.mockImplementation(async input => ({ ...input, ...input.lifecycle, threadVersion: 1 }))
    mocks.client.mockReturnValue({ generate: vi.fn().mockResolvedValue({ text: "test" }) })
  })
  async function run(id: string, pool: HiddenThreadPool) {
    const state = createHostedWorkerRuntimeState()
    await generateHostedWorkerResponse(request(id), state, createHostedWorkerQueue(state), { threadPool: pool })
  }
  function inventory() {
    return new HiddenThreadPool({ idle: () => false, create: vi.fn(), load: async () => [{
      threadUrl: url, createdAt: Date.now(), deletedAt: new Date().toISOString(),
      alive: false, hiddenFromChatList: true,
    }] })
  }
  it("binds one unused hidden thread then retains normal lifecycle verification", async () => {
    const pool = inventory()
    await run(customer, pool)
    expect(mocks.write).toHaveBeenCalledWith(expect.objectContaining({ conversationId: customer, threadUrl: url }))
    expect(mocks.client).toHaveBeenCalledWith(expect.objectContaining({
      conversationThreadRequired: true, conversationThreadUrl: url, conversationThreadVersion: 1,
    }))
    expect(await pool.take()).toBeUndefined()
  })
  it.each(["hosted-tier1-heartbeat", "canary_test"])("keeps %s out of customer inventory", async id => {
    const pool = inventory()
    await run(id, pool)
    expect(mocks.write).not.toHaveBeenCalled()
    expect(await pool.take()).toBeDefined()
  })
  it("does not replace an existing conversation mapping", async () => {
    mocks.read.mockResolvedValue({ threadUrl: url, threadVersion: 4 })
    const pool = inventory()
    await run(customer, pool)
    expect(mocks.write).not.toHaveBeenCalled()
    expect(await pool.take()).toBeDefined()
  })
  it("uses the existing inline provisioning path when inventory is empty", async () => {
    const pool = new HiddenThreadPool({ idle: () => false, create: vi.fn() })
    await run(customer, pool)
    expect(mocks.write).not.toHaveBeenCalled()
    expect(mocks.client).toHaveBeenCalledWith(expect.objectContaining({ conversationThreadRequired: true }))
    expect(mocks.client.mock.calls[0][0]).not.toHaveProperty("conversationThreadUrl")
  })
})
