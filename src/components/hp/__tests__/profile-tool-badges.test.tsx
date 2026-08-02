// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { ProfileToolBadges } from "@/components/hp/profile-tool-badges"

describe("ProfileToolBadges", () => {
  afterEach(cleanup)

  it("keeps each tool label visible without rendering a duplicate tooltip", () => {
    render(<ProfileToolBadges tools={["DaVinci Resolve", "Assimilate Scratch"]} />)

    const firstTool = screen.getByText("DaVinci Resolve")
    fireEvent.pointerEnter(firstTool)
    fireEvent.pointerEnter(screen.getByText("Assimilate Scratch"))

    expect(firstTool).toHaveClass("glass-badge", "glass-badge--profile-tool")
    expect(screen.getByText("Assimilate Scratch")).toHaveClass("glass-badge", "glass-badge--profile-tool")
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument()
    expect(document.querySelector(".profile-tool-tooltip")).not.toBeInTheDocument()
  })
})
