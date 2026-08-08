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
  focus?: { ok: boolean; focused: boolean }
  composerText?: string
  send?: { ok: boolean; reason?: string }
  /** Consumed one per poll, so a test can hold the thread busy for a few samples. */
  sendPresence?: boolean[]
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
      if (expression.includes("location.assign")) {
        calls.push(expression.includes("/ai") ? "open-blank-chat" : "restore")
        return { href: oldThreadUrl } as T
      }
      if (expression.includes("activeElement")) {
        calls.push("focus")
        return (script.focus ?? { ok: true, focused: true }) as T
      }
      if (expression.includes("composer?.innerText") || expression.includes("readNotionAiComposerTextInPage")) {
        calls.push("read-composer")
        return { text: script.composerText ?? notionAiThreadRotationSeedMessage } as T
      }
      if (expression.includes("present")) {
        calls.push("send-presence")
        const scripted = script.sendPresence?.shift()
        return { present: scripted ?? true } as T
      }
      if (expression.includes("aria-label")) {
        calls.push("send")
        return (script.send ?? { ok: true }) as T
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
// so rotation has to drive the page the way a person does. This pins that sequence, verified
// against the live page on 2026-08-08.
describe("rotateNotionAiThread", () => {
  it("walks blank chat, seed, send, then reads the thread Notion minted", async () => {
    const page = fakePage({ hrefs: [oldThreadUrl, oldThreadUrl, newThreadUrl] })

    const result = await rotateNotionAiThread(page)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.threadUrl).toBe(newThreadUrl)
    expect(result.previousThreadUrl).toBe(oldThreadUrl)
    expect(page.calls.slice(0, 6)).toEqual([
      "read-href",
      "open-blank-chat",
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

  it("gives up on the composer rather than typing into a page that never loaded", async () => {
    let clock = 0
    const page = fakePage({ hrefs: [oldThreadUrl], focus: { ok: false, focused: false } })

    const result = await rotateNotionAiThread({
      ...page,
      now: () => (clock += 5000),
      timeouts: { awaitComposerMs: 10000 },
    })

    expect(result).toMatchObject({ ok: false, stage: "focus-composer" })
    expect(page.inserted).toEqual([])
  })

  it("refuses to send when the seed never reached the composer", async () => {
    let clock = 0
    const page = fakePage({ hrefs: [oldThreadUrl], composerText: "" })

    const result = await rotateNotionAiThread({
      ...page,
      now: () => (clock += 5000),
      timeouts: { awaitSeedMs: 10000 },
    })

    expect(result).toMatchObject({ ok: false, stage: "verify-seed" })
    expect(page.calls).not.toContain("send")
  })

  it("reports the send stage when the button stays disabled", async () => {
    let clock = 0
    const page = fakePage({ hrefs: [oldThreadUrl], send: { ok: false, reason: "disabled" } })

    await expect(
      rotateNotionAiThread({ ...page, now: () => (clock += 5000), timeouts: { awaitSendMs: 10000 } }),
    ).resolves.toMatchObject({ ok: false, stage: "send-seed", detail: "disabled" })
  })

  it("stops the whole routine at the total budget rather than holding the request open", async () => {
    let clock = 0
    const page = fakePage({ hrefs: [oldThreadUrl], focus: { ok: false, focused: false } })

    const result = await rotateNotionAiThread({
      ...page,
      now: () => (clock += 5000),
      // Each stage budget is generous on its own; the total is what has to stop this.
      timeouts: { totalMs: 20000, awaitComposerMs: 600000 },
    })

    expect(result).toMatchObject({ ok: false, stage: "focus-composer" })
    expect(clock).toBeLessThan(120000)
  })

  it("waits for the seed's own reply before reporting the thread usable", async () => {
    // Notion hides the send control while it streams, and an inference posted during that stream
    // comes back with zero bytes — which is how the first live rotation lost its retry.
    const page = fakePage({
      hrefs: [oldThreadUrl, newThreadUrl],
      sendPresence: [false, false, true],
    })

    const result = await rotateNotionAiThread(page)

    expect(result.ok).toBe(true)
    expect(page.calls.filter((call) => call === "send-presence")).toHaveLength(3)
  })

  it("reports the thread anyway when the reply never settles", async () => {
    let clock = 0
    const page = fakePage({ hrefs: [oldThreadUrl, newThreadUrl], sendPresence: Array(50).fill(false) })

    const result = await rotateNotionAiThread({
      ...page,
      now: () => (clock += 5000),
      timeouts: { awaitIdleMs: 10000 },
    })

    // The thread exists and is usable next request; only this request's retry is at risk.
    expect(result).toMatchObject({ ok: true, threadUrl: newThreadUrl })
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
