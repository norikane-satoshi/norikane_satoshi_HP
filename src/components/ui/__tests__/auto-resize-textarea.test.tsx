// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AutoResizeTextarea } from "@/components/ui/auto-resize-textarea"

describe("AutoResizeTextarea", () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("expands and keeps the bottom of newly entered long text reachable", () => {
    const scrollIntoView = vi.fn()
    Object.defineProperty(HTMLTextAreaElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    })
    render(<AutoResizeTextarea aria-label="補足" />)

    const field = screen.getByLabelText("補足")
    Object.defineProperty(field, "scrollHeight", { configurable: true, value: 640 })

    fireEvent.change(field, { target: { value: "補足メモ\n".repeat(30) } })

    expect(field).toHaveStyle({ height: "640px", overflowY: "hidden" })
    expect(scrollIntoView).toHaveBeenLastCalledWith({
      block: "end",
      inline: "nearest",
    })
  })

  it("does not force-scroll to the bottom when editing existing middle text", () => {
    const scrollIntoView = vi.fn()
    Object.defineProperty(HTMLTextAreaElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    })
    render(<AutoResizeTextarea aria-label="補足" defaultValue={"1行目\n2行目\n3行目"} />)

    const field = screen.getByLabelText("補足") as HTMLTextAreaElement
    Object.defineProperty(field, "scrollHeight", { configurable: true, value: 120 })
    Object.defineProperty(field, "selectionEnd", { configurable: true, value: 2 })

    fireEvent.input(field, { target: { value: "1行目 編集\n2行目\n3行目" } })

    expect(field).toHaveStyle({ height: "120px" })
    expect(scrollIntoView).toHaveBeenLastCalledWith({
      block: "nearest",
      inline: "nearest",
    })
  })

  it("caps at maxRows and leaves wheel scrolling to the textarea", () => {
    render(
      <AutoResizeTextarea
        aria-label="補足"
        maxRows={2}
        style={{ lineHeight: "20px", paddingBottom: "6px", paddingTop: "4px" }}
      />,
    )

    const field = screen.getByLabelText("補足")
    Object.defineProperty(field, "scrollHeight", { configurable: true, value: 180 })

    fireEvent.change(field, { target: { value: "補足メモ\n".repeat(12) } })
    const wheel = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 120 })
    field.dispatchEvent(wheel)

    expect(field).toHaveStyle({ height: "50px", overflowY: "auto" })
    expect(wheel.defaultPrevented).toBe(false)
  })

  it("hands wheel delta to the nearest scrollable parent when the textarea cannot scroll", () => {
    render(
      <div data-testid="scroll-parent" style={{ maxHeight: "80px", overflowY: "auto" }}>
        <AutoResizeTextarea aria-label="補足" />
        <div style={{ height: "400px" }} />
      </div>,
    )

    const parent = screen.getByTestId("scroll-parent")
    Object.defineProperty(parent, "clientHeight", { configurable: true, value: 80 })
    Object.defineProperty(parent, "scrollHeight", { configurable: true, value: 400 })
    const field = screen.getByLabelText("補足")
    Object.defineProperty(field, "clientHeight", { configurable: true, value: 80 })
    Object.defineProperty(field, "scrollHeight", { configurable: true, value: 80 })

    fireEvent.wheel(field, { deltaY: 120 })

    expect(parent.scrollTop).toBe(120)
  })
})
