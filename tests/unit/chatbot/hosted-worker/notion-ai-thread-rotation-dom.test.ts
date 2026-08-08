// @vitest-environment jsdom

import { describe, expect, it } from "vitest"

import {
  buildNotionAiBlankChatUrl,
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

  it("finds the send button in either locale", () => {
    // The live page labels the new-chat control "New chat" and the send control
    // "AIメッセージを送信" in the same session, so neither language can be assumed.
    for (const label of ["AIメッセージを送信", "Send AI message"]) {
      render(`<button aria-label="${label}"></button>`)
      let clicks = 0
      document.querySelector("[aria-label]")?.addEventListener("click", () => (clicks += 1))

      expect(clickNotionAiSendInPage(document)).toEqual({ ok: true })
      expect(clicks).toBe(1)
    }
  })

  it("separates a disabled send button from one that has not rendered yet", () => {
    render(`<button aria-label="AIメッセージを送信" aria-disabled="true"></button>`)
    expect(clickNotionAiSendInPage(document)).toEqual({ ok: false, reason: "disabled" })

    // Notion only renders send once the composer holds text; that is a wait, not a failure.
    render(`<div></div>`)
    expect(clickNotionAiSendInPage(document)).toEqual({ ok: false, reason: "missing" })
  })

  it("keeps the blank chat on the host the tab is already signed in to", () => {
    expect(buildNotionAiBlankChatUrl("https://www.notion.so/chat?t=abc")).toBe("https://www.notion.so/ai")
    expect(buildNotionAiBlankChatUrl("https://app.notion.com/chat?t=abc")).toBe("https://app.notion.com/ai")
    expect(buildNotionAiBlankChatUrl(undefined)).toBe("https://app.notion.com/ai")
    expect(buildNotionAiBlankChatUrl("not a url")).toBe("https://app.notion.com/ai")
  })

  it("reads the thread id only from a real notion chat url", () => {
    expect(readNotionAiThreadIdFromUrl("https://app.notion.com/chat?t=aaaabbbbccccddddeeeeffff00001111")).toBe(
      "aaaabbbbccccddddeeeeffff00001111",
    )
    expect(readNotionAiThreadIdFromUrl("https://app.notion.com/ai")).toBeUndefined()
    expect(readNotionAiThreadIdFromUrl("https://app.notion.com/chat?t=not-a-thread")).toBeUndefined()
  })
})
