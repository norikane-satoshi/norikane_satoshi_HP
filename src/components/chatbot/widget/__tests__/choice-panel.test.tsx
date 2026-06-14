// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ChoicePanel } from "@/components/chatbot/widget/ChoicePanel"
import { finalMediumChoices } from "@/lib/chatbot/domain/survey-choice"

describe("ChoicePanel", () => {
  afterEach(() => cleanup())

  it("renders the choice question and labels", () => {
    render(<ChoicePanel choiceSet={finalMediumChoices} onSelect={vi.fn()} />)

    expect(screen.getByText("最終媒体を教えてください")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "劇場公開" })).toBeInTheDocument()
  })

  it("calls onSelect with the selected id", () => {
    const onSelect = vi.fn()
    render(<ChoicePanel choiceSet={finalMediumChoices} onSelect={onSelect} />)

    screen.getByRole("button", { name: "劇場公開" }).click()

    expect(onSelect).toHaveBeenCalledWith(["cinema"])
  })
})
