// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { CHATBOT_CONVERSATION_CONTENT_STYLE } from "@/components/chatbot/widget/conversationTypography"
import { SecurityNote } from "@/components/chatbot/widget/SecurityNote"

describe("SecurityNote", () => {
  afterEach(() => cleanup())

  it("hides details by default when defaultOpen is false", () => {
    render(<SecurityNote defaultOpen={false} />)

    expect(screen.getByRole("button", { name: "安全に扱います" })).toHaveAttribute("aria-expanded", "false")
    expect(screen.queryByText("30 日自動削除", { exact: false })).not.toBeInTheDocument()
  })

  it("shows security details after the button is clicked", () => {
    render(<SecurityNote defaultOpen={false} />)

    fireEvent.click(screen.getByRole("button", { name: "安全に扱います" }))

    expect(screen.getByText("チャットログは 30 日自動削除の対象です。")).toBeInTheDocument()
    expect(screen.getByText("他のご相談内容は参照せず、このご相談に必要な情報だけを使います。")).toBeInTheDocument()
    expect(screen.getByText("カレンダーは空き状況の確認に必要な予定の有無だけを確認します。")).toBeInTheDocument()
    expect(screen.queryByText("本人文脈", { exact: false })).not.toBeInTheDocument()
    expect(screen.queryByText("busy 時間帯", { exact: false })).not.toBeInTheDocument()
  })

  it("opens legal text in modals instead of rendering page navigation links", () => {
    render(<SecurityNote defaultOpen />)

    expect(screen.queryByRole("link", { name: "プライバシーポリシー" })).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "利用規約" })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "プライバシーポリシー" }))
    expect(screen.getByRole("dialog", { name: "プライバシーポリシー" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "プライバシーポリシー" })).toBeInTheDocument()
    expect(document.body.style.overflow).toBe("hidden")

    fireEvent.click(screen.getByRole("button", { name: "プライバシーポリシーを閉じる" }))
    expect(screen.queryByRole("dialog", { name: "プライバシーポリシー" })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "利用規約" }))
    expect(screen.getByRole("dialog", { name: "利用規約" })).toBeInTheDocument()
    fireEvent.keyDown(document, { key: "Escape" })
    expect(screen.queryByRole("dialog", { name: "利用規約" })).not.toBeInTheDocument()
  })

  it("renders the heading with the conversation sans-serif font family", () => {
    render(<SecurityNote defaultOpen={false} />)

    expect(screen.getByRole("button", { name: "安全に扱います" }).style.fontFamily).toBe(
      CHATBOT_CONVERSATION_CONTENT_STYLE.fontFamily,
    )
  })
})
