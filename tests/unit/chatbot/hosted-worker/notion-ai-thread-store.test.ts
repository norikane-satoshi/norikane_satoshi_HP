import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import {
  primeNotionAiThreadRotationCache,
  readNotionAiThreadRotation,
  resetNotionAiThreadRotationCache,
  resolveEffectiveNotionAiThreadUrl,
  toNotionAiThreadId,
  writeNotionAiThreadRotation,
  type NotionAiThreadRotationRecord,
} from "@/lib/chatbot/hosted-worker/notion-ai-thread-store"

const dirs: string[] = []

function statePath(): string {
  const dir = mkdtempSync(join(tmpdir(), "notion-thread-store-"))
  dirs.push(dir)
  return join(dir, "hosted-worker-notion-thread.json")
}

function record(overrides: Partial<NotionAiThreadRotationRecord> = {}): NotionAiThreadRotationRecord {
  return {
    threadUrl: "https://app.notion.com/chat?t=aaaabbbbccccddddeeeeffff00001111",
    threadId: "aaaabbbb-cccc-dddd-eeee-ffff00001111",
    rotatedAt: "2026-08-08T00:00:00.000Z",
    rotationCount: 1,
    ...overrides,
  }
}

afterEach(() => {
  resetNotionAiThreadRotationCache()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe("notion ai thread store", () => {
  it("round-trips a rotation record", async () => {
    const path = statePath()
    await writeNotionAiThreadRotation(record({ previousThreadId: "old-thread" }), path)

    await expect(readNotionAiThreadRotation(path)).resolves.toMatchObject({
      threadId: "aaaabbbb-cccc-dddd-eeee-ffff00001111",
      previousThreadId: "old-thread",
      rotationCount: 1,
    })
  })

  it("falls back to undefined for a missing or corrupt record", async () => {
    await expect(readNotionAiThreadRotation(join(statePath(), "missing.json"))).resolves.toBeUndefined()

    const path = statePath()
    await writeNotionAiThreadRotation(record(), path)
    const { writeFile } = await import("node:fs/promises")
    await writeFile(path, "{ not json", "utf8")
    resetNotionAiThreadRotationCache()

    await expect(readNotionAiThreadRotation(path)).resolves.toBeUndefined()
  })

  it("ignores a record that is missing the fields the worker needs", async () => {
    const path = statePath()
    const { writeFile } = await import("node:fs/promises")
    await writeFile(path, JSON.stringify({ rotatedAt: "2026-08-08T00:00:00.000Z" }), "utf8")

    await expect(readNotionAiThreadRotation(path)).resolves.toBeUndefined()
  })

  it("prefers the rotated thread over configuration", () => {
    const resolved = resolveEffectiveNotionAiThreadUrl({
      env: {
        CHATBOT_HOSTED_WORKER_NOTION_THREAD_URL: "https://www.notion.so/chat?t=deadbeef",
        NOTION_AI_CHATBOT_THREAD_URL: "https://www.notion.so/chat?t=cafebabe",
      } as unknown as NodeJS.ProcessEnv,
      rotation: record(),
    })

    // Configuration is what pointed at the exhausted thread, so it must not win over the rotation.
    expect(resolved).toEqual({ threadUrl: record().threadUrl, source: "rotated" })
  })

  it("hands control back to configuration when rotation is switched off", () => {
    const resolved = resolveEffectiveNotionAiThreadUrl({
      env: {
        CHATBOT_HOSTED_WORKER_THREAD_ROTATION: "off",
        CHATBOT_HOSTED_WORKER_NOTION_THREAD_URL: "https://www.notion.so/chat?t=deadbeef",
      } as unknown as NodeJS.ProcessEnv,
      rotation: record(),
    })

    expect(resolved).toEqual({ threadUrl: "https://www.notion.so/chat?t=deadbeef", source: "worker-env" })
  })

  it("keeps the existing environment precedence when nothing was rotated", () => {
    expect(
      resolveEffectiveNotionAiThreadUrl({
        env: {
          CHATBOT_HOSTED_WORKER_NOTION_THREAD_URL: "https://www.notion.so/chat?t=deadbeef",
          NOTION_AI_CHATBOT_THREAD_URL: "https://www.notion.so/chat?t=cafebabe",
        } as unknown as NodeJS.ProcessEnv,
      }),
    ).toEqual({ threadUrl: "https://www.notion.so/chat?t=deadbeef", source: "worker-env" })

    expect(
      resolveEffectiveNotionAiThreadUrl({
        env: { NOTION_AI_CHATBOT_THREAD_URL: "https://www.notion.so/chat?t=cafebabe" } as unknown as NodeJS.ProcessEnv,
      }),
    ).toEqual({ threadUrl: "https://www.notion.so/chat?t=cafebabe", source: "thread-env" })

    expect(resolveEffectiveNotionAiThreadUrl({ env: {} as unknown as NodeJS.ProcessEnv }).source).toBe("repo-default")
  })

  it("serves the primed cache to synchronous callers", async () => {
    const path = statePath()
    await writeNotionAiThreadRotation(record(), path)
    resetNotionAiThreadRotationCache()

    expect(resolveEffectiveNotionAiThreadUrl({ env: {} as unknown as NodeJS.ProcessEnv }).source).toBe("repo-default")
    await primeNotionAiThreadRotationCache(path)
    expect(resolveEffectiveNotionAiThreadUrl({ env: {} as unknown as NodeJS.ProcessEnv }).source).toBe("rotated")
  })

  it("reads the thread id out of either notion host", () => {
    expect(toNotionAiThreadId("https://app.notion.com/chat?t=aaaabbbbccccddddeeeeffff00001111")).toBe(
      "aaaabbbb-cccc-dddd-eeee-ffff00001111",
    )
    expect(toNotionAiThreadId("https://www.notion.so/chat")).toBeUndefined()
    expect(toNotionAiThreadId("not a url")).toBeUndefined()
  })
})
