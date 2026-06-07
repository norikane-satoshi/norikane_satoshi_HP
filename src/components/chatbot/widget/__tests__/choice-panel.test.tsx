// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ChoicePanel } from "@/components/chatbot/widget/ChoicePanel"
import { additionalWorkChoices, finalMediumChoices } from "@/lib/chatbot/domain/survey-choice"

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

    fireEvent.click(screen.getByRole("button", { name: "劇場公開" }))

    expect(onSelect).toHaveBeenCalledWith(["cinema"])
  })

  it("keeps none exclusive in multiple selection mode", () => {
    const onSelect = vi.fn()
    render(<ChoicePanel choiceSet={additionalWorkChoices} onSelect={onSelect} allowMultiple />)

    fireEvent.click(screen.getByRole("button", { name: "消し物" }))
    fireEvent.click(screen.getByRole("button", { name: "肌修正" }))
    fireEvent.click(screen.getByRole("button", { name: "なし" }))

    expect(onSelect).toHaveBeenNthCalledWith(1, ["retouch"])
    expect(onSelect).toHaveBeenNthCalledWith(2, ["retouch", "skin-retouch"])
    expect(onSelect).toHaveBeenNthCalledWith(3, ["none"])
  })
})
