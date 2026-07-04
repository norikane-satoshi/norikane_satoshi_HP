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

  it("calls onSelect with the selected id and label", () => {
    const onSelect = vi.fn()
    render(<ChoicePanel choiceSet={finalMediumChoices} onSelect={onSelect} />)

    fireEvent.click(screen.getByRole("button", { name: "劇場公開" }))

    expect(onSelect).toHaveBeenCalledWith({
      selectedIds: ["cinema"],
      selectedLabels: ["劇場公開"],
    })
  })

  it("marks multiple selected choices without rendering a selected summary row", () => {
    render(<ChoicePanel choiceSet={additionalWorkChoices} onSelect={vi.fn()} allowMultiple />)

    fireEvent.click(screen.getByRole("button", { name: "消し物" }))
    fireEvent.click(screen.getByRole("button", { name: "肌修正" }))

    expect(screen.getByRole("button", { name: "消し物" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("button", { name: "肌修正" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.queryByText(/選択中/)).not.toBeInTheDocument()
    expect(screen.queryByText(/件:/)).not.toBeInTheDocument()
  })

  it("keeps none exclusive in multiple selection mode", () => {
    const onSelect = vi.fn()
    render(<ChoicePanel choiceSet={additionalWorkChoices} onSelect={onSelect} allowMultiple />)

    fireEvent.click(screen.getByRole("button", { name: "消し物" }))
    fireEvent.click(screen.getByRole("button", { name: "肌修正" }))
    fireEvent.click(screen.getByRole("button", { name: "なし" }))

    expect(screen.getByRole("button", { name: "消し物" })).toHaveAttribute("aria-pressed", "false")
    expect(screen.getByRole("button", { name: "肌修正" })).toHaveAttribute("aria-pressed", "false")
    expect(screen.getByRole("button", { name: "なし" })).toHaveAttribute("aria-pressed", "true")

    fireEvent.click(screen.getByRole("button", { name: "選択を送信" }))

    expect(onSelect).toHaveBeenCalledWith({
      selectedIds: ["none"],
      selectedLabels: ["なし"],
    })
  })

  it("waits for confirmation before submitting multiple selections", () => {
    const onSelect = vi.fn()
    render(<ChoicePanel choiceSet={additionalWorkChoices} onSelect={onSelect} allowMultiple />)

    fireEvent.click(screen.getByRole("button", { name: "消し物" }))
    fireEvent.click(screen.getByRole("button", { name: "肌修正" }))

    expect(onSelect).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("button", { name: "選択を送信" }))

    expect(onSelect).toHaveBeenCalledWith({
      selectedIds: ["retouch", "skin-retouch"],
      selectedLabels: ["消し物", "肌修正"],
    })
  })

  it("shows an optional other comment field and submits it with the selection", () => {
    const onSelect = vi.fn()
    render(<ChoicePanel choiceSet={additionalWorkChoices} onSelect={onSelect} allowMultiple />)

    fireEvent.click(screen.getByRole("button", { name: "その他" }))

    expect(screen.getByLabelText("その他の内容")).toBeInTheDocument()
    expect(screen.getByLabelText("その他の内容")).toHaveClass("auto-resize-textarea")
    fireEvent.change(screen.getByLabelText("その他の内容"), { target: { value: "MA も相談したい" } })
    fireEvent.click(screen.getByRole("button", { name: "選択を送信" }))

    expect(onSelect).toHaveBeenCalledWith({
      selectedIds: ["other"],
      selectedLabels: ["その他"],
      otherComment: "MA も相談したい",
    })
  })
})
