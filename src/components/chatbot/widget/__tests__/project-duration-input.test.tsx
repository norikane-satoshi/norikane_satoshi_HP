// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { DurationInputCard, ProjectDurationInput } from "@/components/chatbot/widget/ProjectDurationInput"

afterEach(cleanup)

describe("project duration input", () => {
  it("starts unanswered, replaces buckets with hours/minutes, and submits the exact customer answer", () => {
    const submit = vi.fn()
    render(<DurationInputCard question="作品の尺を教えてください" onSubmit={submit} />)
    expect(screen.queryByText("作品の尺を教えてください")).not.toBeInTheDocument()
    expect(screen.getByText("尺", { exact: true })).toBeInTheDocument()
    expect(screen.queryByText("60分未満")).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/秒/)).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "この尺で回答する" })).toBeDisabled()
    fireEvent.change(screen.getByLabelText("尺の時間"), { target: { value: "0" } })
    fireEvent.change(screen.getByLabelText("尺の分"), { target: { value: "18" } })
    expect(screen.getByText("尺: 18分")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "この尺で回答する" }))
    expect(submit).toHaveBeenCalledWith("尺: 0時間18分")
  })

  it("steps both fields by one and preserves minutes above an hour", () => {
    render(<DurationInputCard question="尺" onSubmit={vi.fn()} />)
    fireEvent.change(screen.getByLabelText("尺の分"), { target: { value: "18" } })
    fireEvent.click(screen.getByRole("button", { name: "時間を1増やす" }))
    expect(screen.getByText("尺: 1時間18分")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "分を1増やす" }))
    fireEvent.click(screen.getByRole("button", { name: "時間を1減らす" }))
    expect(screen.getByText("尺: 19分")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "分を1減らす" }))
    expect(screen.getByText("尺: 18分")).toBeInTheDocument()
  })

  it("records unknown without a numeric default", () => {
    const submit = vi.fn()
    render(<DurationInputCard question="尺" onSubmit={submit} />)
    fireEvent.click(screen.getByLabelText("未定"))
    expect(screen.getByLabelText("尺の分")).toBeDisabled()
    expect(screen.getByText("尺: 未確認")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "この尺で回答する" }))
    expect(submit).toHaveBeenCalledWith("尺: 未定")
  })

  it("uses the selected mobile wheel row as minutes, without a bucket conversion", () => {
    const change = vi.fn()
    render(<ProjectDurationInput onChange={change} />)
    const wheel = screen.getByRole("listbox", { name: "分を回して選択" })
    wheel.scrollTop = 19 * 40
    fireEvent.scroll(wheel)
    expect(change).toHaveBeenLastCalledWith(18, false)
    expect(screen.getByLabelText("尺の分")).toHaveValue(18)
  })
})
