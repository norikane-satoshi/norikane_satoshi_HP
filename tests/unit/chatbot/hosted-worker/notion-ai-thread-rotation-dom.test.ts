// @vitest-environment jsdom

import { describe, expect, it } from "vitest"

import {
  clickNotionAiNewChatInPage,
  clickNotionAiSendInPage,
  focusNotionAiComposerInPage,
  readNotionAiComposerTextInPage,
  readNotionAiThreadIdFromUrl,
} from "@/lib/chatbot/hosted-worker/notion-ai-thread-rotation"

function render(html: string): void {
  document.body.innerHTML = html
}

// These run against the real page in production and against jsdom here, so they must not depend on
// innerText — jsdom does not implement it.
describe("notion ai rotation page steps", () => {
  it("clicks the deepest 新規チャット control, not the wrappers around it", () => {
    // Notion nests the label so several ancestors report the same text. Only the innermost one is
    // wired up; clicking a wrapper does nothing.
    render(`<div id="outer"><div id="row" role="button"><span id="label">新規チャット</span></div></div>`)
    const clicked: string[] = []
    for (const id of ["outer", "row", "label"]) {
      document.getElementById(id)?.addEventListener("click", (event) => {
        if (event.currentTarget === event.target) clicked.push(id)
      })
    }

    const result = clickNotionAiNewChatInPage(document)

    expect(result.ok).toBe(true)
    // outer, row and label all read as exactly the label text.
    expect(result.matchCount).toBe(3)
    // The deepest match is the span, whose nearest clickable ancestor is the role=button row.
    expect(clicked).toEqual(["row"])
  })

  it("reports no match rather than clicking something unrelated", () => {
    render(`<div role="button">送信</div>`)

    expect(clickNotionAiNewChatInPage(document)).toEqual({ ok: false, matchCount: 0 })
  })

  it("focuses the composer and reads what landed in it", () => {
    render(`<div contenteditable="true" role="textbox"></div>`)
    const composer = document.querySelector("[contenteditable='true'][role='textbox']") as HTMLElement

    expect(focusNotionAiComposerInPage(document)).toEqual({ ok: true, focused: true })

    composer.textContent = "セッション開始"
    expect(readNotionAiComposerTextInPage(document)).toEqual({ text: "セッション開始" })
  })

  it("reports a missing composer instead of throwing", () => {
    render(`<div></div>`)

    expect(focusNotionAiComposerInPage(document)).toEqual({ ok: false, focused: false })
    expect(readNotionAiComposerTextInPage(document)).toEqual({ text: "" })
  })

  it("clicks the send button and refuses a disabled one", () => {
    render(`<button aria-label="AIメッセージを送信"></button>`)
    let clicks = 0
    document.querySelector("[aria-label]")?.addEventListener("click", () => (clicks += 1))

    expect(clickNotionAiSendInPage(document)).toEqual({ ok: true })
    expect(clicks).toBe(1)

    render(`<button aria-label="AIメッセージを送信" aria-disabled="true"></button>`)
    expect(clickNotionAiSendInPage(document)).toEqual({ ok: false, reason: "disabled" })

    render(`<div></div>`)
    expect(clickNotionAiSendInPage(document)).toEqual({ ok: false, reason: "missing" })
  })

  it("reads the thread id only from a real notion chat url", () => {
    expect(readNotionAiThreadIdFromUrl("https://app.notion.com/chat?t=aaaabbbbccccddddeeeeffff00001111")).toBe(
      "aaaabbbbccccddddeeeeffff00001111",
    )
    expect(readNotionAiThreadIdFromUrl("https://app.notion.com/ai")).toBeUndefined()
    expect(readNotionAiThreadIdFromUrl("https://app.notion.com/chat?t=not-a-thread")).toBeUndefined()
  })
})
