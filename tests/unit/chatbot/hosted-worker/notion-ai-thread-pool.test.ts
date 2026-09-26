import { describe, expect, it, vi } from "vitest"
import { HiddenThreadPool, type PoolThread } from "@/lib/chatbot/hosted-worker/notion-ai-thread-pool"
import { buildNotionAiBlankChatUrl } from "@/lib/chatbot/hosted-worker/notion-ai-thread-rotation"

const thread = (id: number, createdAt = Date.now()): PoolThread => ({
  threadUrl: `https://app.notion.com/chat?t=${String(id).padStart(32, "0")}`,
  createdAt, deletedAt: new Date(createdAt).toISOString(),
  alive: false, hiddenFromChatList: true,
})

describe("hidden thread inventory", () => {
  it("starts a disposable blank page on the authenticated Notion origin", () => {
    expect(buildNotionAiBlankChatUrl("about:blank")).toBe("https://app.notion.com/ai")
  })
  it("does not hand a duplicate persisted thread to two conversations", async () => {
    const pool = new HiddenThreadPool({ create: async () => thread(3), idle: () => false,
      load: async () => [thread(1), thread(1)] })
    expect(await pool.take()).toBeDefined()
    expect(await pool.take()).toBeUndefined()
  })
  it("refills only while idle, caps at two, and atomically consumes once", async () => {
    let idle = false
    let id = 0
    const create = vi.fn(async () => thread(++id))
    const pool = new HiddenThreadPool({ create, idle: () => idle })
    await pool.refill()
    expect(create).not.toHaveBeenCalled()
    idle = true
    await Promise.all([pool.refill(), pool.refill()])
    expect(create).toHaveBeenCalledTimes(2)
    const claimed = await Promise.all([pool.take(), pool.take(), pool.take()])
    expect(claimed.filter(Boolean)).toHaveLength(2)
    expect(new Set(claimed.filter(Boolean).map(t => t!.threadUrl)).size).toBe(2)
  })

  it("does not make an empty-pool customer await replenishment", async () => {
    let finish!: (value: PoolThread) => void
    const pool = new HiddenThreadPool({ idle: () => true, create: () => new Promise(resolve => { finish = resolve }) })
    const filling = pool.refill()
    expect(await pool.take()).toBeUndefined()
    pool.stop()
    finish(thread(1))
    await filling
  })

  it("expires unused threads at seven days and rejects visible threads", async () => {
    const now = Date.now()
    const pool = new HiddenThreadPool({ idle: () => true, now: () => now,
      create: async () => ({ ...thread(1), alive: true } as unknown as PoolThread),
      load: async () => [thread(2, now - 7 * 86400000)],
    })
    expect(await pool.take()).toBeUndefined()
    await pool.refill()
    expect(await pool.take()).toBeUndefined()
  })

  it("durably removes a claim before delivery and never lends on save failure", async () => {
    const save = vi.fn(async () => { throw new Error("disk unavailable") })
    const pool = new HiddenThreadPool({ idle: () => false, create: async () => thread(3),
      load: async () => [thread(1)], save })
    expect(await pool.take()).toBeUndefined()
    expect(save).toHaveBeenCalledWith([])
    expect(await pool.take()).toBeUndefined()
  })

  it("stops further refill when a customer arrives and keeps failures optional", async () => {
    let idle = true
    const create = vi.fn(async () => { idle = false; return thread(1) })
    const pool = new HiddenThreadPool({ idle: () => idle, create })
    await pool.refill()
    expect(create).toHaveBeenCalledTimes(1)
    expect(await pool.take()).toBeDefined()
  })
})
