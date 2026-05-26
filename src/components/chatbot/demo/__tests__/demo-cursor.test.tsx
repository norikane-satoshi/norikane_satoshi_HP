// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { DemoCursor } from "@/components/chatbot/demo/DemoCursor"

describe("DemoCursor", () => {
  afterEach(() => cleanup())

  it("renders an active cursor label", () => {
    render(<DemoCursor point={{ xRatio: 0.8, yRatio: 0.7 }} label="予約へ進む" />)

    expect(screen.getByText("予約へ進む")).toBeInTheDocument()
  })

  it("marks clicking state without firing DOM clicks", () => {
    const { container } = render(
      <DemoCursor point={{ xRatio: 0.5, yRatio: 0.5 }} clicking label="クリック" />,
    )

    expect(container.firstElementChild).toHaveAttribute("data-clicking", "true")
    expect(screen.getByText("クリック")).toBeInTheDocument()
  })

  it("does not render when inactive", () => {
    const { container } = render(<DemoCursor point={{ xRatio: 0.5, yRatio: 0.5 }} active={false} />)

    expect(container).toBeEmptyDOMElement()
  })
})
