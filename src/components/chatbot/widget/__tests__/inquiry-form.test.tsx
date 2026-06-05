// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { InquiryForm } from "@/components/chatbot/widget/InquiryForm"

describe("InquiryForm", () => {
  afterEach(() => cleanup())

  it("renders required and optional form fields", () => {
    render(<InquiryForm onSubmit={vi.fn()} />)

    expect(screen.getByText("問い合わせフォーム")).toBeInTheDocument()
    expect(screen.getByLabelText("氏名")).toBeInTheDocument()
    expect(screen.getByLabelText("メール")).toBeInTheDocument()
    expect(screen.getByLabelText("自由記述")).toBeInTheDocument()
    expect(screen.getByText("必須")).toBeInTheDocument()
    expect(screen.getAllByText("任意")).toHaveLength(5)
    expect(screen.getByText("T・Y案件 等イニシャルでも可")).toBeInTheDocument()
  })

  it("submits normalized form input when email is present", () => {
    const onSubmit = vi.fn()
    render(<InquiryForm onSubmit={onSubmit} />)

    fireEvent.change(screen.getByLabelText("メール"), { target: { value: " client@example.com " } })
    fireEvent.change(screen.getByLabelText("案件種別"), { target: { value: " CM " } })
    fireEvent.change(screen.getByLabelText("自由記述"), { target: { value: " 急ぎではありません " } })
    screen.getByRole("button", { name: "送信" }).click()

    expect(onSubmit).toHaveBeenCalledWith({
      name: "",
      email: "client@example.com",
      jobType: "CM",
      duration: "",
      desiredDeadline: "",
      freeText: "急ぎではありません",
    })
  })

  it("does not submit without email", () => {
    const onSubmit = vi.fn()
    render(<InquiryForm onSubmit={onSubmit} />)

    fireEvent.change(screen.getByLabelText("氏名"), { target: { value: "田中" } })
    screen.getByRole("button", { name: "送信" }).click()

    expect(onSubmit).not.toHaveBeenCalled()
  })
})
