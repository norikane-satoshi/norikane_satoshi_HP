// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"
import { cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import TermsPage, { metadata } from "../page"

describe("TermsPage", () => {
  afterEach(() => cleanup())

  it("sets the terms metadata title", () => {
    expect(metadata.title).toBe("利用規約 | のりかね映像設計室")
  })

  it("renders the AI consultation, quote, booking, and disclaimer terms", () => {
    const { container } = render(<TermsPage />)

    expect(container).toHaveTextContent("利用規約")
    expect(container).toHaveTextContent("AI 相談窓口")
    expect(container).toHaveTextContent("正式見積")
    expect(container).toHaveTextContent("予約")
    expect(container).toHaveTextContent("免責")
    expect(container).toHaveTextContent("のりかね本人")
    expect(container).toHaveTextContent("法令上制限できない責任")
  })
})
