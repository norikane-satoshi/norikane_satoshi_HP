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

function touchPoint(identifier: number, clientX: number, clientY: number) {
  return { identifier, clientX, clientY, target: window } as unknown as Touch
}

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

  it("keeps the user comment surface at a readable white glass opacity", () => {
    const css = readFileSync("src/app/globals.css", "utf8")

    render(<ChatMessage role="user" content="劇場公開作品です。" />)

    const message = screen.getByText("劇場公開作品です。").closest("article")
    expect(message).toHaveAttribute("data-chatbot-user-message", "true")
    expect(css).toContain('.glass-flat[data-chatbot-user-message="true"]')
    expect(css).toContain("background: rgba(255, 255, 255, 0.50);")
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

    expect(screen.getByText("下の会話は削除されます")).toBeInTheDocument()
    expect(screen.queryByText("保存すると、これより後のやり取りは削除されます。")).not.toBeInTheDocument()
    expect(onEdit).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("button", { name: "OK" }))

    expect(onEdit).toHaveBeenCalledWith("msg_1", "修正版です。")
  })

  it("cancels editing from an outside pointer without saving or truncating", () => {
    const onEdit = vi.fn()
    render(
      <div>
        <ChatMessage id="msg_1" role="user" content="初稿です。" onEdit={onEdit} />
        <button type="button">外側</button>
      </div>,
    )

    fireEvent.click(screen.getByRole("button", { name: "メッセージを編集" }))
    fireEvent.change(screen.getByLabelText("編集内容"), { target: { value: "保存しない修正です。" } })
    fireEvent.pointerDown(screen.getByRole("button", { name: "外側" }), { pointerType: "mouse", button: 0 })

    expect(screen.queryByLabelText("編集内容")).not.toBeInTheDocument()
    expect(screen.getByText("初稿です。")).toBeInTheDocument()
    expect(onEdit).not.toHaveBeenCalled()
  })

  it("keeps editing open for textarea and edit action controls", () => {
    const onEdit = vi.fn()
    render(<ChatMessage id="msg_1" role="user" content="初稿です。" onEdit={onEdit} />)

    fireEvent.click(screen.getByRole("button", { name: "メッセージを編集" }))
    const editor = screen.getByLabelText("編集内容")
    fireEvent.pointerDown(editor, { pointerType: "mouse", button: 0 })
    expect(screen.getByLabelText("編集内容")).toBeInTheDocument()

    fireEvent.change(editor, { target: { value: "修正版です。" } })
    const saveButton = screen.getByRole("button", { name: "保存" })
    fireEvent.pointerDown(saveButton, { pointerType: "mouse", button: 0 })
    fireEvent.click(saveButton)

    expect(screen.getByText("下の会話は削除されます")).toBeInTheDocument()
    expect(onEdit).not.toHaveBeenCalled()

    const cancelConfirmButton = screen.getByRole("button", { name: "キャンセル" })
    fireEvent.pointerDown(cancelConfirmButton, { pointerType: "mouse", button: 0 })
    fireEvent.click(cancelConfirmButton)

    expect(screen.getByLabelText("編集内容")).toBeInTheDocument()
    expect(onEdit).not.toHaveBeenCalled()
  })

  it("cancels editing from an outside touch without saving", () => {
    const onEdit = vi.fn()
    render(
      <div>
        <ChatMessage id="msg_1" role="user" content="初稿です。" onEdit={onEdit} />
        <button type="button">外側</button>
      </div>,
    )

    fireEvent.click(screen.getByRole("button", { name: "メッセージを編集" }))
    fireEvent.change(screen.getByLabelText("編集内容"), { target: { value: "保存しない修正です。" } })
    fireEvent.touchStart(screen.getByRole("button", { name: "外側" }), {
      touches: [touchPoint(1, 20, 20)],
      changedTouches: [touchPoint(1, 20, 20)],
    })

    expect(screen.queryByLabelText("編集内容")).not.toBeInTheDocument()
    expect(screen.getByText("初稿です。")).toBeInTheDocument()
    expect(onEdit).not.toHaveBeenCalled()
  })

  it("marks the edit truncation confirmation as destructive on the desktop edit path", () => {
    render(<ChatMessage id="msg_1" role="user" content="初稿です。" onEdit={vi.fn()} />)

    fireEvent.click(screen.getByRole("button", { name: "メッセージを編集" }))
    fireEvent.change(screen.getByLabelText("編集内容"), { target: { value: "修正版です。" } })
    fireEvent.click(screen.getByRole("button", { name: "保存" }))

    const warning = screen.getByText("下の会話は削除されます")
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

    expect(screen.queryByText("長押しして編集")).not.toBeInTheDocument()
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

    expect(screen.getByText("長押しして編集")).toBeInTheDocument()
    expect(screen.queryByText("長押しで編集")).not.toBeInTheDocument()
    expect(screen.queryByText("長押しで編集できます")).not.toBeInTheDocument()

    fireEvent.pointerMove(message!, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 124,
      clientY: 84,
    })
    expect(screen.getByText("長押しして編集")).toBeInTheDocument()

    fireEvent.pointerUp(message!, { pointerId: 1, pointerType: "touch" })
    expect(screen.queryByText("長押しして編集")).not.toBeInTheDocument()
  })

  it("places the mobile touch affordance directly before the timestamp in the metadata row", () => {
    vi.useFakeTimers()
    render(
      <ChatMessage
        id="msg_1"
        role="user"
        content="初稿です。"
        createdAt={new Date("2026-05-26T12:34:00.000+09:00")}
        onEdit={vi.fn()}
      />,
    )

    const message = screen.getByText("初稿です。").closest("article")
    expect(message).not.toBeNull()

    fireEvent.pointerDown(message!, {
      pointerId: 1,
      pointerType: "touch",
      button: 0,
      clientX: 120,
      clientY: 80,
    })

    const hint = screen.getByText("長押しして編集")
    const timestamp = screen.getByText("12:34")
    expect(hint.parentElement).toBe(timestamp.parentElement)
    expect(hint.compareDocumentPosition(timestamp) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it("restarts mobile long press editing after swipe movement stops on the same message", () => {
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
    fireEvent.pointerMove(message!, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 120,
      clientY: 120,
    })
    act(() => {
      vi.advanceTimersByTime(599)
    })

    expect(screen.getByText("長押しして編集")).toBeInTheDocument()
    expect(screen.queryByLabelText("編集内容")).not.toBeInTheDocument()
    expect(message).toHaveClass("chatbot-message-liquid")
    expect(message).toHaveAttribute("data-chatbot-touch-state", "active")

    act(() => {
      vi.advanceTimersByTime(1)
    })

    expect(vibrate).toHaveBeenCalledWith([10])
    expect(screen.getByLabelText("編集内容")).toHaveValue("初稿です。")
  })

  it("does not enter edit mode while swipe movement keeps changing position", () => {
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

    for (const clientY of [100, 120, 140]) {
      fireEvent.pointerMove(message!, {
        pointerId: 1,
        pointerType: "touch",
        clientX: 120,
        clientY,
      })
      act(() => {
        vi.advanceTimersByTime(300)
      })
      expect(screen.queryByLabelText("編集内容")).not.toBeInTheDocument()
    }

    expect(screen.getByText("長押しして編集")).toBeInTheDocument()
    expect(message).toHaveAttribute("data-chatbot-touch-state", "active")

    fireEvent.pointerUp(message!, { pointerId: 1, pointerType: "touch" })
    expect(screen.queryByText("長押しして編集")).not.toBeInTheDocument()
  })

  it("enters edit mode from a fresh long press immediately after swipe release", () => {
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
      clientY: 124,
    })
    fireEvent.pointerUp(message!, { pointerId: 1, pointerType: "touch" })

    fireEvent.pointerDown(message!, {
      pointerId: 2,
      pointerType: "touch",
      button: 0,
      clientX: 120,
      clientY: 124,
    })
    act(() => {
      vi.advanceTimersByTime(600)
    })

    expect(screen.getByLabelText("編集内容")).toHaveValue("初稿です。")
  })

  it("keeps active swipe feedback after pointer cancel and allows a new long press", () => {
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
      clientY: 124,
    })
    fireEvent.pointerCancel(message!, { pointerId: 1, pointerType: "touch" })

    expect(screen.getByText("長押しして編集")).toBeInTheDocument()
    expect(message).toHaveAttribute("data-chatbot-touch-state", "active")

    fireEvent.pointerDown(message!, {
      pointerId: 2,
      pointerType: "touch",
      button: 0,
      clientX: 120,
      clientY: 124,
    })
    act(() => {
      vi.advanceTimersByTime(600)
    })

    expect(screen.getByLabelText("編集内容")).toHaveValue("初稿です。")
  })

  it("restarts long press editing from touch movement after browser pointer cancel", () => {
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
    fireEvent.pointerMove(message!, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 120,
      clientY: 124,
    })
    fireEvent.pointerCancel(message!, { pointerId: 1, pointerType: "touch" })

    fireEvent.touchMove(window, {
      touches: [touchPoint(7, 120, 150)],
      changedTouches: [touchPoint(7, 120, 150)],
    })

    expect(screen.getByText("長押しして編集")).toBeInTheDocument()
    expect(message).toHaveClass("chatbot-message-liquid")
    expect(message).toHaveAttribute("data-chatbot-touch-state", "active")

    act(() => {
      vi.advanceTimersByTime(599)
    })
    expect(screen.queryByLabelText("編集内容")).not.toBeInTheDocument()
    expect(vibrate).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(1)
    })

    expect(vibrate).toHaveBeenCalledTimes(1)
    expect(vibrate).toHaveBeenCalledWith([10])
    expect(screen.getByLabelText("編集内容")).toHaveValue("初稿です。")
  })

  it("limits mobile long press editing to the touched user message", () => {
    vi.useFakeTimers()
    render(
      <>
        <ChatMessage id="msg_1" role="user" content="初稿です。" onEdit={vi.fn()} />
        <ChatMessage id="msg_2" role="user" content="別稿です。" onEdit={vi.fn()} />
      </>,
    )

    const firstMessage = screen.getByText("初稿です。").closest("article")
    const secondMessage = screen.getByText("別稿です。").closest("article")
    expect(firstMessage).not.toBeNull()
    expect(secondMessage).not.toBeNull()

    fireEvent.pointerDown(firstMessage!, {
      pointerId: 1,
      pointerType: "touch",
      button: 0,
      clientX: 120,
      clientY: 80,
    })
    fireEvent.pointerDown(secondMessage!, {
      pointerId: 2,
      pointerType: "touch",
      button: 0,
      clientX: 120,
      clientY: 180,
    })
    act(() => {
      vi.advanceTimersByTime(600)
    })

    expect(screen.getAllByLabelText("編集内容")).toHaveLength(1)
    expect(screen.getByLabelText("編集内容")).toHaveValue("初稿です。")
    expect(screen.getByText("別稿です。")).toBeInTheDocument()
  })

  it("keeps pointercancel touch tracking owned by the started message only", () => {
    vi.useFakeTimers()
    render(
      <>
        <ChatMessage id="msg_1" role="user" content="初稿です。" onEdit={vi.fn()} />
        <ChatMessage id="msg_2" role="user" content="別稿です。" onEdit={vi.fn()} />
      </>,
    )

    const firstMessage = screen.getByText("初稿です。").closest("article")
    expect(firstMessage).not.toBeNull()

    fireEvent.pointerDown(firstMessage!, {
      pointerId: 1,
      pointerType: "touch",
      button: 0,
      clientX: 120,
      clientY: 80,
    })
    fireEvent.pointerMove(firstMessage!, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 120,
      clientY: 124,
    })
    fireEvent.pointerCancel(firstMessage!, { pointerId: 1, pointerType: "touch" })

    fireEvent.touchMove(window, {
      touches: [touchPoint(7, 120, 150)],
      changedTouches: [touchPoint(7, 120, 150)],
    })
    act(() => {
      vi.advanceTimersByTime(600)
    })

    expect(screen.getAllByLabelText("編集内容")).toHaveLength(1)
    expect(screen.getByLabelText("編集内容")).toHaveValue("初稿です。")
    expect(screen.getByText("別稿です。")).toBeInTheDocument()
  })

  it("clears text selection before mobile long press enters edit mode", () => {
    vi.useFakeTimers()
    const removeAllRanges = vi.fn()
    vi.spyOn(window, "getSelection").mockReturnValue({ removeAllRanges } as unknown as Selection)
    render(<ChatMessage id="msg_1" role="user" content="初稿です。" onEdit={vi.fn()} />)

    const message = screen.getByText("初稿です。").closest("article")
    expect(message).not.toBeNull()
    expect(message).toHaveClass("chatbot-message-no-select")

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

    expect(removeAllRanges).toHaveBeenCalledTimes(1)
    expect(message).not.toHaveClass("chatbot-message-no-select")
    expect(screen.getByLabelText("編集内容")).toHaveValue("初稿です。")
  })

  it("does not edit while touch movement continues after pointer cancel, then returns to idle on touch end", () => {
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
      clientY: 124,
    })
    fireEvent.pointerCancel(message!, { pointerId: 1, pointerType: "touch" })

    for (const clientY of [150, 176, 202]) {
      fireEvent.touchMove(window, {
        touches: [touchPoint(7, 120, clientY)],
        changedTouches: [touchPoint(7, 120, clientY)],
      })
      act(() => {
        vi.advanceTimersByTime(300)
      })
      expect(screen.queryByLabelText("編集内容")).not.toBeInTheDocument()
    }

    expect(screen.getByText("長押しして編集")).toBeInTheDocument()
    expect(message).toHaveAttribute("data-chatbot-touch-state", "active")

    fireEvent.touchEnd(window, {
      touches: [],
      changedTouches: [touchPoint(7, 120, 202)],
    })
    expect(screen.queryByText("長押しして編集")).not.toBeInTheDocument()
    expect(message).toHaveAttribute("data-chatbot-touch-state", "release")

    act(() => {
      vi.advanceTimersByTime(420)
    })
    expect(message).not.toHaveAttribute("data-chatbot-touch-state")
    expect(message).not.toHaveClass("chatbot-message-liquid")
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

    expect(screen.getByText("長押しして編集")).toBeInTheDocument()
    expect(message).toHaveClass("chatbot-message-liquid")
    expect(message).toHaveAttribute("data-chatbot-touch-state", "active")

    act(() => {
      vi.advanceTimersByTime(899)
    })
    expect(screen.getByText("長押しして編集")).toBeInTheDocument()
    expect(message).toHaveAttribute("data-chatbot-touch-state", "active")

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(screen.queryByText("長押しして編集")).not.toBeInTheDocument()
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

    expect(screen.getByText("長押しして編集")).toBeInTheDocument()
    expect(message).toHaveClass("chatbot-message-liquid")
    expect(message).toHaveAttribute("data-chatbot-touch-state", "active")

    fireEvent.touchEnd(window)
    expect(screen.queryByText("長押しして編集")).not.toBeInTheDocument()
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

  it("keeps chatbot liquid feedback static", () => {
    const css = readFileSync("src/app/globals.css", "utf8")

    expect(css).toContain(".chatbot-message-liquid[data-chatbot-touch-state=\"active\"]::before")
    expect(css).toContain("@media (prefers-reduced-motion: reduce)")
    expect(css).not.toMatch(/chatbot-message-liquid-(enter|flow|release|ripple)/)
    expect(css).toMatch(/\.chatbot-message-liquid::before,[\s\S]*?\.chatbot-message-liquid::after,[\s\S]*?animation: none;/)
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
