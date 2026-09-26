import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import { readNotionAiThreadIdFromUrl } from "./notion-ai-thread-rotation"

export type PoolThread = {
  threadUrl: string
  createdAt: number
  deletedAt: string
  alive: false
  hiddenFromChatList: true
}
type Options = {
  create: () => Promise<PoolThread>
  idle: () => boolean
  now?: () => number
  load?: () => Promise<PoolThread[]>
  save?: (threads: PoolThread[]) => Promise<void>
}
const maxAge = 7 * 86400000

export class HiddenThreadPool {
  private threads: PoolThread[] = []
  private loaded?: Promise<void>
  private filling?: Promise<void>
  private tail: Promise<unknown> = Promise.resolve()
  private stopped = false
  private unavailable = false
  constructor(private readonly options: Options) {}

  private valid(t: PoolThread): boolean {
    const age = (this.options.now?.() ?? Date.now()) - t.createdAt
    return Boolean(readNotionAiThreadIdFromUrl(t.threadUrl)) && t.alive === false &&
      t.hiddenFromChatList === true && Number.isFinite(Date.parse(t.deletedAt)) && age >= 0 && age < maxAge
  }
  private async load() {
    this.loaded ??= (async () => {
      try {
        const unique = new Map<string, PoolThread>()
        for (const t of await this.options.load?.() ?? []) {
          if (this.valid(t)) unique.set(readNotionAiThreadIdFromUrl(t.threadUrl)!, t)
        }
        this.threads = [...unique.values()].slice(0, 2)
      }
      catch { this.unavailable = true }
    })()
    await this.loaded
  }
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn, fn)
    this.tail = result.catch(() => undefined)
    return result
  }
  async take(): Promise<PoolThread | undefined> {
    return this.exclusive(async () => {
      await this.load()
      if (this.unavailable) return undefined
      this.threads = this.threads.filter(t => this.valid(t))
      const chosen = this.threads.shift()
      if (!chosen) return undefined
      try { await this.options.save?.([...this.threads]); return chosen }
      catch { this.unavailable = true; this.threads = []; return undefined }
    })
  }
  refill(): Promise<void> {
    if (this.filling) return this.filling
    this.filling = this.refillUnqueued().finally(() => { this.filling = undefined })
    return this.filling
  }
  private async refillUnqueued() {
    await this.load()
    while (!this.stopped && !this.unavailable && this.options.idle()) {
      this.threads = this.threads.filter(t => this.valid(t))
      if (this.threads.length >= 2) return
      try {
        // Creation runs in a dedicated page, never on the customer queue or page.
        const created = await this.options.create()
        if (!this.valid(created)) return
        await this.exclusive(async () => {
          if (!this.threads.some(t => t.threadUrl === created.threadUrl)) this.threads.push(created)
          try { await this.options.save?.([...this.threads]) }
          catch { this.unavailable = true; this.threads = [] }
        })
      } catch { return }
    }
  }
  stop() { this.stopped = true }
}

export function poolFileStore() {
  const file = path.join(homedir(), ".local/state/norikane_satoshi_hp/hosted-worker-thread-pool.json")
  return {
    load: async (): Promise<PoolThread[]> => {
      try {
        const data: unknown = JSON.parse(await readFile(file, "utf8"))
        if (!Array.isArray(data)) throw new Error("Invalid thread inventory")
        return data
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
        throw error
      }
    },
    save: async (threads: PoolThread[]) => {
      await mkdir(path.dirname(file), { recursive: true })
      const temporary = `${file}.${process.pid}.tmp`
      await writeFile(temporary, JSON.stringify(threads), { mode: 0o600 })
      await rename(temporary, file)
    },
  }
}
