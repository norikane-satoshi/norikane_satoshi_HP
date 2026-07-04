// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ChatInput } from "@/components/chatbot/widget/ChatInput"
import { CHATBOT_CONVERSATION_CONTENT_STYLE } from "@/components/chatbot/widget/conversationTypography"

const originalMatchMedia = window.matchMedia

function mockMatchMedia(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
}

describe("ChatInput", () => {
  afterEach(() => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: originalMatchMedia,
    })
    cleanup()
  })

  it("renders the custom placeholder", () => {
    render(<ChatInput onSubmit={vi.fn()} placeholder="案件内容を書いてください" />)

    expect(screen.getByPlaceholderText("案件内容を書いてください")).toBeInTheDocument()
  })

  it("shows the default multiline and submit shortcut guidance on desktop", () => {
    mockMatchMedia(false)
    render(<ChatInput onSubmit={vi.fn()} />)

    expect(
      screen.getByPlaceholderText("案件内容を書く（Enterで改行、Cmd（Ctrl）+ Enterで送信）"),
    ).toBeInTheDocument()
  })

  it("hides physical keyboard shortcut guidance on mobile", () => {
    mockMatchMedia(true)
    render(<ChatInput onSubmit={vi.fn()} />)

    expect(screen.getByPlaceholderText("案件内容を書く")).toBeInTheDocument()
    expect(screen.queryByPlaceholderText(/Cmd（Ctrl）/)).not.toBeInTheDocument()
  })

  it("uses the same font family as submitted conversation content", () => {
    render(<ChatInput onSubmit={vi.fn()} />)

    expect(screen.getByLabelText("相談内容")).toHaveStyle({
      fontFamily: CHATBOT_CONVERSATION_CONTENT_STYLE.fontFamily,
    })
  })

  it("submits trimmed text and clears the input", async () => {
    const onSubmit = vi.fn()
    render(<ChatInput onSubmit={onSubmit} />)

    const input = screen.getByLabelText("相談内容")
    fireEvent.change(input, { target: { value: "  10月公開です  " } })
    fireEvent.click(screen.getByRole("button", { name: "送信" }))

    expect(onSubmit).toHaveBeenCalledWith("10月公開です")
    await waitFor(() => expect(input).toHaveValue(""))
  })

  it("uses a growing multiline textarea", () => {
    render(<ChatInput onSubmit={vi.fn()} />)

    const input = screen.getByLabelText("相談内容")
    expect(input.tagName).toBe("TEXTAREA")
    expect(input).toHaveAttribute("rows", "1")
    expect(input).toHaveClass("auto-resize-textarea")
    expect(input).not.toHaveClass("max-h-40")
    expect(input).not.toHaveClass("overflow-y-auto")
  })

  it("expands the textarea height to its content", () => {
    render(<ChatInput onSubmit={vi.fn()} />)

    const input = screen.getByLabelText("相談内容")
    Object.defineProperty(input, "scrollHeight", { configurable: true, value: 144 })

    fireEvent.change(input, { target: { value: "1行目\n2行目\n3行目" } })

    expect(input).toHaveStyle({ height: "144px" })
  })

  it("keeps Enter as a newline and submits with Cmd or Ctrl Enter", async () => {
    const onSubmit = vi.fn()
    render(<ChatInput onSubmit={onSubmit} />)

    const input = screen.getByLabelText("相談内容")
    fireEvent.change(input, { target: { value: "1行目" } })
    fireEvent.keyDown(input, { key: "Enter" })
    expect(onSubmit).not.toHaveBeenCalled()

    fireEvent.change(input, { target: { value: "1行目\n2行目" } })
    fireEvent.keyDown(input, { key: "Enter", metaKey: true })
    expect(onSubmit).toHaveBeenCalledWith("1行目\n2行目")
    await waitFor(() => expect(input).toHaveValue(""))

    fireEvent.change(input, { target: { value: "Ctrl送信" } })
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true })
    expect(onSubmit).toHaveBeenLastCalledWith("Ctrl送信")
  })

  it("does not submit while IME composition is active", () => {
    const onSubmit = vi.fn()
    render(<ChatInput onSubmit={onSubmit} />)

    const input = screen.getByLabelText("相談内容")
    fireEvent.change(input, { target: { value: "変換中" } })
    fireEvent.keyDown(input, { key: "Enter", metaKey: true, isComposing: true })

    expect(onSubmit).not.toHaveBeenCalled()
  })

  it("shows a stop button while stopping is enabled", () => {
    const onStop = vi.fn()
    render(<ChatInput onSubmit={vi.fn()} onStop={onStop} disabled stoppingEnabled />)

    fireEvent.click(screen.getByRole("button", { name: "停止" }))

    expect(onStop).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole("button", { name: "送信" })).not.toBeInTheDocument()
  })
})
