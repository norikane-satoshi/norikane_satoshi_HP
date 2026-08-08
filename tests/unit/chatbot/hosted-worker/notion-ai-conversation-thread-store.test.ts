import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import {
  readNotionAiConversationThread,
  resetNotionAiConversationThreadCache,
  toNotionAiConversationScopeHash,
  writeNotionAiConversationThread,
} from "@/lib/chatbot/hosted-worker/notion-ai-conversation-thread-store"

const firstThreadUrl = "https://app.notion.com/ai?t=11112222333344445555666677778888"
const secondThreadUrl = "https://app.notion.com/ai?t=aaaabbbbccccddddeeeeffff00001111"

describe("Notion AI conversation thread store", () => {
  const temporaryDirectories: string[] = []

  afterEach(() => {
    resetNotionAiConversationThreadCache()
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  function statePath(): string {
    const directory = mkdtempSync(path.join(tmpdir(), "notion-conversation-thread-"))
    temporaryDirectories.push(directory)
    return path.join(directory, "threads.json")
  }

  it("keeps different HP conversations on different Notion threads", async () => {
    const target = statePath()
    await writeNotionAiConversationThread(
      { conversationId: "conversation-a", threadUrl: firstThreadUrl },
      target,
    )
    await writeNotionAiConversationThread(
      { conversationId: "conversation-b", threadUrl: secondThreadUrl },
      target,
    )

    await expect(readNotionAiConversationThread("conversation-a", target)).resolves.toMatchObject({
      threadUrl: firstThreadUrl,
      threadVersion: 1,
    })
    await expect(readNotionAiConversationThread("conversation-b", target)).resolves.toMatchObject({
      threadUrl: secondThreadUrl,
      threadVersion: 1,
    })
  })

  it("reuses one mapping for later turns and advances its version only after rotation", async () => {
    const target = statePath()
    const now = () => new Date("2026-08-08T00:00:00.000Z")
    await writeNotionAiConversationThread(
      { conversationId: "conversation-a", threadUrl: firstThreadUrl, now },
      target,
    )
    const unchanged = await writeNotionAiConversationThread(
      { conversationId: "conversation-a", threadUrl: firstThreadUrl, now },
      target,
    )
    const rotated = await writeNotionAiConversationThread(
      { conversationId: "conversation-a", threadUrl: secondThreadUrl, now },
      target,
    )

    expect(unchanged.threadVersion).toBe(1)
    expect(rotated.threadVersion).toBe(2)
  })

  it("stores only a hash of the HP conversation id", async () => {
    const target = statePath()
    const conversationId = "customer-conversation-private-id"
    await writeNotionAiConversationThread({ conversationId, threadUrl: firstThreadUrl }, target)

    const rawState = readFileSync(target, "utf8")
    expect(rawState).not.toContain(conversationId)
    expect(rawState).toContain(toNotionAiConversationScopeHash(conversationId))
  })

  it("fails closed on a thread URL without a Notion-minted id", async () => {
    const target = statePath()
    await expect(
      writeNotionAiConversationThread(
        { conversationId: "conversation-a", threadUrl: "https://app.notion.com/ai" },
        target,
      ),
    ).rejects.toThrow("valid thread id")
    await expect(
      writeNotionAiConversationThread(
        { conversationId: "conversation-a", threadUrl: "https://app.notion.com/ai?t=client-minted" },
        target,
      ),
    ).rejects.toThrow("valid thread id")
  })
})
