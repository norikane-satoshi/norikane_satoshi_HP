import { describe, expect, it, vi } from "vitest"

import {
  notionAiThreadRotationSeedMessage,
  rotateNotionAiThread,
  type NotionAiThreadRotationDeps,
} from "@/lib/chatbot/hosted-worker/notion-ai-thread-rotation"

const oldThreadUrl = "https://app.notion.com/chat?t=11112222333344445555666677778888"
const newThreadUrl = "https://app.notion.com/chat?t=aaaabbbbccccddddeeeeffff00001111"

type PageScript = {
  hrefs: string[]
  newChat?: { ok: boolean; matchCount: number }
  focus?: { ok: boolean; focused: boolean }
  composerText?: string
  send?: { ok: boolean; reason?: string }
}

function fakePage(script: PageScript) {
  const calls: string[] = []
  let hrefIndex = 0
  const deps: NotionAiThreadRotationDeps & { calls: string[]; inserted: string[] } = {
    calls,
    inserted: [],
    // No real timers: rotation polls, and a test should not wait 30 seconds to prove it gave up.
    sleep: async () => {},
    async evaluate<T>(expression: string): Promise<T> {
      if (expression.includes("location.href")) {
        calls.push("read-href")
        const href = script.hrefs[Math.min(hrefIndex, script.hrefs.length - 1)]
        hrefIndex += 1
        return { href } as T
      }
      if (expression.includes("新規チャット")) {
        calls.push("new-chat")
        return (script.newChat ?? { ok: true, matchCount: 3 }) as T
      }
      if (expression.includes("activeElement")) {
        calls.push("focus")
        return (script.focus ?? { ok: true, focused: true }) as T
      }
      if (expression.includes("composer?.innerText") || expression.includes("readNotionAiComposerTextInPage")) {
        calls.push("read-composer")
        return { text: script.composerText ?? notionAiThreadRotationSeedMessage } as T
      }
      if (expression.includes("AIメッセージを送信")) {
        calls.push("send")
        return (script.send ?? { ok: true }) as T
      }
      if (expression.includes("location.assign")) {
        calls.push("restore")
        return { href: oldThreadUrl } as T
      }
      throw new Error(`unexpected expression: ${expression.slice(0, 60)}`)
    },
    async insertText(text: string): Promise<void> {
      calls.push("insert-text")
      deps.inserted.push(text)
    },
  }
  return deps
}

// The worker cannot mint a Notion thread id itself — the inference API rejects client-minted ids —
// so rotation has to drive the page the way a person does. This pins that sequence.
describe("rotateNotionAiThread", () => {
  it("walks new chat, seed, send, then reads the thread Notion minted", async () => {
    const page = fakePage({ hrefs: [oldThreadUrl, oldThreadUrl, newThreadUrl] })

    const result = await rotateNotionAiThread(page)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.threadUrl).toBe(newThreadUrl)
    expect(result.previousThreadUrl).toBe(oldThreadUrl)
    expect(page.calls.slice(0, 6)).toEqual([
      "read-href",
      "new-chat",
      "focus",
      "insert-text",
      "read-composer",
      "send",
    ])
    expect(page.inserted).toEqual([notionAiThreadRotationSeedMessage])
  })

  it("types through CDP rather than assigning textContent", async () => {
    const page = fakePage({ hrefs: [oldThreadUrl, newThreadUrl] })
    const evaluate = vi.spyOn(page, "evaluate")

    await rotateNotionAiThread(page)

    // Assigning textContent from an evaluate looks like it worked but never reaches Notion's
    // editor state; that mistake is what made the first rotation attempt fail.
    for (const [expression] of evaluate.mock.calls) {
      expect(String(expression)).not.toContain("textContent =")
    }
    expect(page.inserted).toHaveLength(1)
  })

  it("stops at the new chat control when Notion relabels it", async () => {
    const page = fakePage({ hrefs: [oldThreadUrl], newChat: { ok: false, matchCount: 0 } })

    const result = await rotateNotionAiThread(page)

    expect(result).toMatchObject({ ok: false, stage: "new-chat", detail: "matchCount=0" })
    expect(page.inserted).toEqual([])
  })

  it("refuses to send when the seed never reached the composer", async () => {
    const page = fakePage({ hrefs: [oldThreadUrl], composerText: "" })

    const result = await rotateNotionAiThread(page)

    expect(result).toMatchObject({ ok: false, stage: "verify-seed" })
    expect(page.calls).not.toContain("send")
  })

  it("reports the send stage when the button is disabled", async () => {
    const page = fakePage({ hrefs: [oldThreadUrl], send: { ok: false, reason: "disabled" } })

    await expect(rotateNotionAiThread(page)).resolves.toMatchObject({
      ok: false,
      stage: "send-seed",
      detail: "disabled",
    })
  })

  it("gives up when Notion never mints a new thread", async () => {
    let clock = 0
    const page = fakePage({ hrefs: [oldThreadUrl] })

    const result = await rotateNotionAiThread({
      ...page,
      now: () => (clock += 5000),
      timeouts: { awaitThreadUrlMs: 10000 },
    })

    expect(result).toMatchObject({ ok: false, stage: "await-thread-url", previousThreadUrl: oldThreadUrl })
  })
})
