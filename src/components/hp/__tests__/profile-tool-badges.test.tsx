// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ProfileToolBadges } from "@/components/hp/profile-tool-badges"

describe("ProfileToolBadges", () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it("delays only the first tooltip and opens adjacent badges immediately", () => {
    vi.useFakeTimers()
    render(<ProfileToolBadges tools={["DaVinci Resolve", "Assimilate Scratch"]} />)

    const firstTool = screen.getByText("DaVinci Resolve")
    fireEvent.pointerEnter(firstTool)
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument()

    act(() => vi.advanceTimersByTime(500))
    expect(screen.getByRole("tooltip")).toHaveTextContent("DaVinci Resolve")

    fireEvent.pointerLeave(firstTool)
    fireEvent.pointerEnter(screen.getByText("Assimilate Scratch"))

    expect(screen.getByRole("tooltip")).toHaveTextContent("Assimilate Scratch")
    expect(screen.getByRole("tooltip")).toHaveAttribute("data-entry", "instant")
  })
})
