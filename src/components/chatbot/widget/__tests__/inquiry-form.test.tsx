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
    expect(screen.getByLabelText("メールアドレス")).toBeInTheDocument()
    expect(screen.getByLabelText("自由記述")).toBeInTheDocument()
    expect(screen.getByLabelText("自由記述")).toHaveClass("auto-resize-textarea")
    expect(screen.getByText("必須")).toBeInTheDocument()
    expect(screen.getAllByText("任意")).toHaveLength(5)
    expect(screen.getByText("T・Y案件 等イニシャルでも可")).toBeInTheDocument()
  })

  it("expands the free text field to its content", () => {
    render(<InquiryForm onSubmit={vi.fn()} />)

    const field = screen.getByLabelText("自由記述")
    Object.defineProperty(field, "scrollHeight", { configurable: true, value: 176 })

    fireEvent.change(field, { target: { value: "相談内容\n".repeat(10) } })

    expect(field).toHaveStyle({ height: "176px" })
  })

  it("submits normalized form input when email is present", () => {
    const onSubmit = vi.fn()
    render(<InquiryForm onSubmit={onSubmit} />)

    fireEvent.change(screen.getByLabelText("メールアドレス"), { target: { value: " client@example.com " } })
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

  it("does not submit an invalid email address", () => {
    const onSubmit = vi.fn()
    render(<InquiryForm onSubmit={onSubmit} />)

    fireEvent.change(screen.getByLabelText("メールアドレス"), { target: { value: "090-1234-5678" } })
    screen.getByRole("button", { name: "送信" }).click()

    expect(onSubmit).not.toHaveBeenCalled()
  })

  it("renders the consultation summary mode with a required email address", () => {
    render(
      <InquiryForm
        mode="consultation-summary"
        initialEmail="client@example.com"
        summaryText="live-60m / live / remote-grading / 搬入〜納品未定"
        openQuestions={["素材搬入〜納品時期未確認"]}
        onSubmit={vi.fn()}
      />,
    )

    expect(screen.getByRole("button", { name: "相談内容を送信" })).toBeInTheDocument()
    expect(screen.getByLabelText("相談サマリ")).toHaveTextContent("live-60m")
    expect(screen.getByLabelText("メールアドレス")).toHaveValue("client@example.com")
  })
})
