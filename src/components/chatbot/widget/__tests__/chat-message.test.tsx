// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ChatMessage } from "@/components/chatbot/widget/ChatMessage"
import {
  CHATBOT_CONVERSATION_CONTENT_CLASS_NAME,
  CHATBOT_CONVERSATION_CONTENT_STYLE,
} from "@/components/chatbot/widget/conversationTypography"

const conversationContentClasses = CHATBOT_CONVERSATION_CONTENT_CLASS_NAME.split(" ")

describe("ChatMessage", () => {
  afterEach(() => cleanup())

  it("renders assistant content and timestamp", () => {
    render(
      <ChatMessage
        role="assistant"
        content="案件内容を整理します。"
        createdAt={new Date("2026-05-26T12:34:00.000+09:00")}
      />,
    )

    expect(screen.getByText("AI アシスタント")).toBeInTheDocument()
    expect(screen.getByText("案件内容を整理します。")).toBeInTheDocument()
    expect(screen.getByText("12:34")).toBeInTheDocument()
  })

  it("renders user content with the customer label", () => {
    render(<ChatMessage role="user" content="劇場公開作品です。" />)

    expect(screen.getByText("お客さま")).toBeInTheDocument()
    expect(screen.getByText("劇場公開作品です。")).toBeInTheDocument()
  })

  it("uses sans typography only for the message body content", () => {
    render(<ChatMessage role="assistant" content="補足メモを整理します。" />)

    const content = screen.getByText("補足メモを整理します。")
    expect(content).toHaveClass(...conversationContentClasses)
    expect(content).toHaveStyle({ fontFamily: CHATBOT_CONVERSATION_CONTENT_STYLE.fontFamily })
    expect(screen.getByText("AI アシスタント")).not.toHaveClass(...conversationContentClasses)
  })

  it("renders assistant bold markdown without exposing raw markers", () => {
    render(<ChatMessage role="assistant" content="まず **媒体** と __公開時期__ を確認します。" />)

    const medium = screen.getByText("媒体")
    const releaseWindow = screen.getByText("公開時期")
    expect(medium.tagName).toBe("STRONG")
    expect(releaseWindow.tagName).toBe("STRONG")
    expect(medium).toHaveClass("font-semibold")
    expect(releaseWindow).toHaveClass("font-semibold")
    expect(screen.getByText(/まず/)).not.toHaveTextContent("**")
    expect(screen.getByText(/まず/)).not.toHaveTextContent("__")
  })

  it("edits only user messages after explicit truncation confirmation", () => {
    const onEdit = vi.fn()
    render(<ChatMessage id="msg_1" role="user" content="初稿です。" onEdit={onEdit} />)

    fireEvent.click(screen.getByRole("button", { name: "メッセージを編集" }))
    fireEvent.change(screen.getByLabelText("編集内容"), { target: { value: "修正版です。" } })
    fireEvent.click(screen.getByRole("button", { name: "保存" }))

    expect(screen.getByText("保存すると、これより後のやり取りは削除されます。")).toBeInTheDocument()
    expect(onEdit).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("button", { name: "OK" }))

    expect(onEdit).toHaveBeenCalledWith("msg_1", "修正版です。")
  })

  it("does not expose editing controls for assistant messages", () => {
    render(<ChatMessage id="msg_2" role="assistant" content="回答です。" onEdit={vi.fn()} />)

    expect(screen.queryByRole("button", { name: "メッセージを編集" })).not.toBeInTheDocument()
  })
})
