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

    expect(field).toHaveStyle({ height: "640px" })
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
})
