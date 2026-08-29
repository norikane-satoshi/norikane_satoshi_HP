// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"
import { cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import TermsPage, { generateMetadata } from "../page"

vi.mock("next-intl/server", () => ({getLocale: async () => "ja"}))

describe("TermsPage", () => {
  afterEach(() => cleanup())

  it("sets the terms metadata title", async () => {
    const metadata = await generateMetadata()
    expect(metadata.title).toBe("利用規約 | のりかね映像設計室")
  })

  it("renders the AI consultation, quote, booking, and disclaimer terms", async () => {
    const { container } = render(await TermsPage())

    expect(container).toHaveTextContent("利用規約")
    expect(container).toHaveTextContent("AI 相談窓口")
    expect(container).toHaveTextContent("正式見積")
    expect(container).toHaveTextContent("予約")
    expect(container).toHaveTextContent("免責")
    expect(container).toHaveTextContent("則兼本人")
    expect(container).toHaveTextContent("法令上制限できない責任")
  })
})
