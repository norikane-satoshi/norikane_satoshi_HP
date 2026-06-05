// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { DirectContactCard } from "@/components/chatbot/widget/DirectContactCard"

describe("DirectContactCard", () => {
  afterEach(() => cleanup())

  it("renders the reason and suggested message", () => {
    render(
      <DirectContactCard
        reason="tech-question"
        suggestedMessage="のりかね本人に直接確認します。"
        onSubmitEmail={vi.fn()}
      />,
    )

    expect(screen.getByText("技術相談")).toBeInTheDocument()
    expect(screen.getByText("のりかね本人に直接確認します。")).toBeInTheDocument()
    expect(screen.getByText("必須")).toBeInTheDocument()
    expect(screen.getAllByText("任意")).toHaveLength(2)
  })

  it("submits contact values when email is present", () => {
    const onSubmitEmail = vi.fn()
    render(
      <DirectContactCard
        reason="complex"
        suggestedMessage="確認します。"
        onSubmitEmail={onSubmitEmail}
      />,
    )

    fireEvent.change(screen.getByLabelText("メールアドレス"), { target: { value: " client@example.com " } })
    fireEvent.change(screen.getByLabelText("会社名"), { target: { value: " Example Studio " } })
    fireEvent.change(screen.getByLabelText("お名前"), { target: { value: " 田中 " } })
    screen.getByRole("button", { name: "この内容で送信" }).click()

    expect(onSubmitEmail).toHaveBeenCalledWith("client@example.com", "Example Studio", "田中")
  })

  it("does not submit without email", () => {
    const onSubmitEmail = vi.fn()
    render(
      <DirectContactCard
        reason="tight-deadline"
        suggestedMessage="確認します。"
        onSubmitEmail={onSubmitEmail}
      />,
    )

    screen.getByRole("button", { name: "この内容で送信" }).click()

    expect(onSubmitEmail).not.toHaveBeenCalled()
  })
})
