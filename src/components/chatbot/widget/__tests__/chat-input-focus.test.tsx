// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"

import { createRef } from "react"
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { ChatInput } from "@/components/chatbot/widget/ChatInput"

// The panel renders at the end of the document, so the input is one of the last tab stops on the
// page. A customer who opens the panel with the keyboard must be able to receive focus there
// instead of tabbing past every link on the page first.
describe("chat input focus handle", () => {
  it("exposes the textarea through the forwarded ref so the panel can focus it", () => {
    const inputRef = createRef<HTMLTextAreaElement>()
    render(<ChatInput onSubmit={vi.fn()} inputRef={inputRef} />)

    expect(inputRef.current).toBe(screen.getByLabelText("相談内容"))

    inputRef.current?.focus()
    expect(document.activeElement).toBe(inputRef.current)
  })
})
