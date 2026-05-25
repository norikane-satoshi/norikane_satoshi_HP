// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { PortfolioPointer } from "@/components/chatbot/widget/PortfolioPointer"

describe("PortfolioPointer", () => {
  afterEach(() => cleanup())

  it("renders the works guidance and default link", () => {
    render(<PortfolioPointer />)

    expect(screen.getByText("Works セクションも確認できます。")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "norikane.studio Works を見る" })).toHaveAttribute("href", "/#works")
  })

  it("uses a custom works section url", () => {
    render(<PortfolioPointer worksSectionUrl="/portfolio#works" />)

    expect(screen.getByRole("link", { name: "norikane.studio Works を見る" })).toHaveAttribute(
      "href",
      "/portfolio#works",
    )
  })
})
