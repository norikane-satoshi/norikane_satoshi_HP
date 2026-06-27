// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"
import { readFileSync } from "node:fs"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ChatMessage } from "@/components/chatbot/widget/ChatMessage"
import {
  CHATBOT_CONVERSATION_CONTENT_CLASS_NAME,
  CHATBOT_CONVERSATION_CONTENT_STYLE,
} from "@/components/chatbot/widget/conversationTypography"

const conversationContentClasses = CHATBOT_CONVERSATION_CONTENT_CLASS_NAME.split(" ")

describe("ChatMessage", () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    cleanup()
  })

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

  it("renders user content without the default customer label", () => {
    render(<ChatMessage role="user" content="劇場公開作品です。" />)

    expect(screen.queryByText("お客さま")).not.toBeInTheDocument()
    expect(screen.queryByText("お客様")).not.toBeInTheDocument()
    expect(screen.getByText("劇場公開作品です。")).toBeInTheDocument()
  })

  it("renders a user display name only when it is known", () => {
    render(<ChatMessage role="user" content="劇場公開作品です。" displayName="田中" />)

    expect(screen.getByText("田中")).toBeInTheDocument()
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

  it("marks the edit truncation confirmation as destructive on the desktop edit path", () => {
    render(<ChatMessage id="msg_1" role="user" content="初稿です。" onEdit={vi.fn()} />)

    fireEvent.click(screen.getByRole("button", { name: "メッセージを編集" }))
    fireEvent.change(screen.getByLabelText("編集内容"), { target: { value: "修正版です。" } })
    fireEvent.click(screen.getByRole("button", { name: "保存" }))

    const warning = screen.getByText("保存すると、これより後のやり取りは削除されます。")
    const confirmRegion = warning.closest("[data-edit-confirm-pending='true']")
    const okButton = screen.getByRole("button", { name: "OK" })

    expect(confirmRegion).toHaveClass("border-red-300")
    expect(warning).toHaveClass("text-red-600")
    expect(okButton).toHaveClass("border-red-300")
    expect(okButton).toHaveClass("text-red-700")
  })

  it("does not leave a mobile hint or enter edit mode after a short tap", () => {
    vi.useFakeTimers()
    render(<ChatMessage id="msg_1" role="user" content="初稿です。" onEdit={vi.fn()} />)

    const message = screen.getByText("初稿です。").closest("article")
    expect(message).not.toBeNull()

    fireEvent.pointerDown(message!, {
      pointerId: 1,
      pointerType: "touch",
      button: 0,
      clientX: 120,
      clientY: 80,
    })
    fireEvent.pointerUp(message!, { pointerId: 1, pointerType: "touch" })
    act(() => {
      vi.advanceTimersByTime(600)
    })

    expect(screen.queryByText("長押しで編集")).not.toBeInTheDocument()
    expect(screen.queryByText("長押しで編集できます")).not.toBeInTheDocument()
    expect(screen.queryByLabelText("編集内容")).not.toBeInTheDocument()
  })

  it("shows the long press affordance only while a mobile touch is active", () => {
    vi.useFakeTimers()
    render(<ChatMessage id="msg_1" role="user" content="初稿です。" onEdit={vi.fn()} />)

    const message = screen.getByText("初稿です。").closest("article")
    expect(message).not.toBeNull()

    fireEvent.pointerDown(message!, {
      pointerId: 1,
      pointerType: "touch",
      button: 0,
      clientX: 120,
      clientY: 80,
    })

    expect(screen.getByText("長押しで編集")).toBeInTheDocument()
    expect(screen.queryByText("長押しで編集できます")).not.toBeInTheDocument()

    fireEvent.pointerMove(message!, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 124,
      clientY: 84,
    })
    expect(screen.getByText("長押しで編集")).toBeInTheDocument()

    fireEvent.pointerUp(message!, { pointerId: 1, pointerType: "touch" })
    expect(screen.queryByText("長押しで編集")).not.toBeInTheDocument()
  })

  it("keeps the touch affordance visible while swipe movement cancels only the long press timer", () => {
    vi.useFakeTimers()
    render(<ChatMessage id="msg_1" role="user" content="初稿です。" onEdit={vi.fn()} />)

    const message = screen.getByText("初稿です。").closest("article")
    expect(message).not.toBeNull()

    fireEvent.pointerDown(message!, {
      pointerId: 1,
      pointerType: "touch",
      button: 0,
      clientX: 120,
      clientY: 80,
    })
    fireEvent.pointerMove(message!, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 120,
      clientY: 120,
    })
    act(() => {
      vi.advanceTimersByTime(600)
    })

    expect(screen.getByText("長押しで編集")).toBeInTheDocument()
    expect(screen.queryByLabelText("編集内容")).not.toBeInTheDocument()
    expect(message).toHaveClass("chatbot-message-liquid")
    expect(message).toHaveAttribute("data-chatbot-touch-state", "active")

    fireEvent.pointerUp(message!, { pointerId: 1, pointerType: "touch" })
    expect(screen.queryByText("長押しで編集")).not.toBeInTheDocument()
  })

  it("keeps the touch affordance and active liquid state after browser pointer cancel during swipe", () => {
    vi.useFakeTimers()
    render(<ChatMessage id="msg_1" role="user" content="初稿です。" onEdit={vi.fn()} />)

    const message = screen.getByText("初稿です。").closest("article")
    expect(message).not.toBeNull()

    fireEvent.pointerDown(message!, {
      pointerId: 1,
      pointerType: "touch",
      button: 0,
      clientX: 120,
      clientY: 80,
    })
    fireEvent.pointerCancel(message!, { pointerId: 1, pointerType: "touch" })

    expect(screen.getByText("長押しで編集")).toBeInTheDocument()
    expect(message).toHaveClass("chatbot-message-liquid")
    expect(message).toHaveAttribute("data-chatbot-touch-state", "active")

    act(() => {
      vi.advanceTimersByTime(899)
    })
    expect(screen.getByText("長押しで編集")).toBeInTheDocument()
    expect(message).toHaveAttribute("data-chatbot-touch-state", "active")

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(screen.queryByText("長押しで編集")).not.toBeInTheDocument()
    expect(message).toHaveAttribute("data-chatbot-touch-state", "release")

    act(() => {
      vi.advanceTimersByTime(420)
    })
    expect(message).not.toHaveClass("chatbot-message-liquid")
    expect(message).not.toHaveAttribute("data-chatbot-touch-state")
  })

  it("keeps the touch affordance and active liquid state after pointer leave until touch end", () => {
    vi.useFakeTimers()
    render(<ChatMessage id="msg_1" role="user" content="初稿です。" onEdit={vi.fn()} />)

    const message = screen.getByText("初稿です。").closest("article")
    expect(message).not.toBeNull()

    fireEvent.pointerDown(message!, {
      pointerId: 1,
      pointerType: "touch",
      button: 0,
      clientX: 120,
      clientY: 80,
    })
    fireEvent.pointerLeave(message!, { pointerId: 1, pointerType: "touch" })

    expect(screen.getByText("長押しで編集")).toBeInTheDocument()
    expect(message).toHaveClass("chatbot-message-liquid")
    expect(message).toHaveAttribute("data-chatbot-touch-state", "active")

    fireEvent.touchEnd(window)
    expect(screen.queryByText("長押しで編集")).not.toBeInTheDocument()
    expect(message).toHaveAttribute("data-chatbot-touch-state", "release")

    act(() => {
      vi.advanceTimersByTime(420)
    })
    expect(message).not.toHaveClass("chatbot-message-liquid")
    expect(message).not.toHaveAttribute("data-chatbot-touch-state")
  })

  it("applies liquid animation state only to touched user messages", () => {
    vi.useFakeTimers()
    const userRender = render(<ChatMessage id="msg_1" role="user" content="初稿です。" onEdit={vi.fn()} />)
    const userMessage = screen.getByText("初稿です。").closest("article")
    expect(userMessage).not.toHaveClass("chatbot-message-liquid")
    expect(userMessage).toHaveAttribute("data-chatbot-user-message", "true")
    expect(userMessage).not.toHaveAttribute("data-chatbot-touch-state")

    fireEvent.pointerDown(userMessage!, {
      pointerId: 1,
      pointerType: "touch",
      button: 0,
      clientX: 120,
      clientY: 80,
    })
    expect(userMessage).toHaveClass("chatbot-message-liquid")
    expect(userMessage).toHaveAttribute("data-chatbot-touch-state", "active")

    fireEvent.pointerUp(userMessage!, { pointerId: 1, pointerType: "touch" })
    expect(userMessage).toHaveClass("chatbot-message-liquid")
    expect(userMessage).toHaveAttribute("data-chatbot-touch-state", "release")

    act(() => {
      vi.advanceTimersByTime(420)
    })
    expect(userMessage).not.toHaveClass("chatbot-message-liquid")
    expect(userMessage).not.toHaveAttribute("data-chatbot-touch-state")

    userRender.unmount()
    render(<ChatMessage id="msg_2" role="assistant" content="回答です。" onEdit={vi.fn()} />)
    const assistantMessage = screen.getByText("回答です。").closest("article")
    expect(assistantMessage).not.toHaveClass("chatbot-message-liquid")
    expect(assistantMessage).not.toHaveAttribute("data-chatbot-user-message")
  })

  it("keeps chatbot liquid feedback disabled or static for reduced motion users", () => {
    const css = readFileSync("src/app/globals.css", "utf8")

    expect(css).toContain(".chatbot-message-liquid[data-chatbot-touch-state=\"active\"]::before")
    expect(css).toContain(".chatbot-message-liquid[data-chatbot-touch-state=\"release\"]::after")
    expect(css).toContain("@media (prefers-reduced-motion: reduce)")
    expect(css).toMatch(/\.chatbot-message-liquid::before,[\s\S]*?\.chatbot-message-liquid::after,[\s\S]*?animation: none;/)
    expect(css).toMatch(
      /\.chatbot-message-liquid\[data-chatbot-touch-state="active"\]::before,[\s\S]*?\.chatbot-message-liquid\[data-chatbot-touch-state="release"\]::after[\s\S]*?opacity: 0\.18;/,
    )
  })

  it("enters edit mode from a mobile long press on user messages", () => {
    vi.useFakeTimers()
    render(<ChatMessage id="msg_1" role="user" content="初稿です。" onEdit={vi.fn()} />)

    const message = screen.getByText("初稿です。").closest("article")
    expect(message).not.toBeNull()

    fireEvent.pointerDown(message!, {
      pointerId: 1,
      pointerType: "touch",
      button: 0,
      clientX: 120,
      clientY: 80,
    })
    act(() => {
      vi.advanceTimersByTime(600)
    })

    expect(screen.getByLabelText("編集内容")).toHaveValue("初稿です。")
  })

  it("vibrates briefly when mobile long press enters edit mode", () => {
    vi.useFakeTimers()
    const vibrate = vi.fn()
    vi.stubGlobal("navigator", { ...navigator, vibrate })
    render(<ChatMessage id="msg_1" role="user" content="初稿です。" onEdit={vi.fn()} />)

    const message = screen.getByText("初稿です。").closest("article")
    expect(message).not.toBeNull()

    fireEvent.pointerDown(message!, {
      pointerId: 1,
      pointerType: "touch",
      button: 0,
      clientX: 120,
      clientY: 80,
    })
    act(() => {
      vi.advanceTimersByTime(600)
    })

    expect(vibrate).toHaveBeenCalledWith([10])
    expect(screen.getByLabelText("編集内容")).toHaveValue("初稿です。")
  })

  it("enters edit mode from mobile long press without vibration support", () => {
    vi.useFakeTimers()
    vi.stubGlobal("navigator", { ...navigator, vibrate: undefined })
    render(<ChatMessage id="msg_1" role="user" content="初稿です。" onEdit={vi.fn()} />)

    const message = screen.getByText("初稿です。").closest("article")
    expect(message).not.toBeNull()

    fireEvent.pointerDown(message!, {
      pointerId: 1,
      pointerType: "touch",
      button: 0,
      clientX: 120,
      clientY: 80,
    })
    act(() => {
      vi.advanceTimersByTime(600)
    })

    expect(screen.getByLabelText("編集内容")).toHaveValue("初稿です。")
  })

  it("does not enter edit mode from a short mobile tap", () => {
    vi.useFakeTimers()
    render(<ChatMessage id="msg_1" role="user" content="初稿です。" onEdit={vi.fn()} />)

    const message = screen.getByText("初稿です。").closest("article")
    expect(message).not.toBeNull()

    fireEvent.pointerDown(message!, {
      pointerId: 1,
      pointerType: "touch",
      button: 0,
      clientX: 120,
      clientY: 80,
    })
    fireEvent.pointerUp(message!, { pointerId: 1, pointerType: "touch" })
    act(() => {
      vi.advanceTimersByTime(600)
    })

    expect(screen.queryByLabelText("編集内容")).not.toBeInTheDocument()
  })

  it("keeps the desktop edit button path available", () => {
    render(<ChatMessage id="msg_1" role="user" content="初稿です。" onEdit={vi.fn()} />)

    const editButton = screen.getByRole("button", { name: "メッセージを編集" })
    expect(editButton).toHaveClass("group-hover:opacity-100")
    expect(editButton).toHaveClass("group-focus-within:opacity-100")

    fireEvent.click(editButton)
    expect(screen.getByLabelText("編集内容")).toHaveValue("初稿です。")
  })

  it("does not expose editing controls for assistant messages", () => {
    render(<ChatMessage id="msg_2" role="assistant" content="回答です。" onEdit={vi.fn()} />)

    expect(screen.queryByRole("button", { name: "メッセージを編集" })).not.toBeInTheDocument()
  })
})
