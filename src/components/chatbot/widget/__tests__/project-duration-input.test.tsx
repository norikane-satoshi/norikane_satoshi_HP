// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ProjectDurationInput } from "@/components/chatbot/widget/ProjectDurationInput"

afterEach(cleanup)

describe("project duration input", () => {
  it("starts unanswered and retains 30 seconds without rounding to a minute", () => {
    const change = vi.fn()
    render(<ProjectDurationInput onChange={change} />)
    expect(screen.getByLabelText("尺の時間")).toHaveValue(null)
    expect(screen.getByLabelText("尺の分")).toHaveValue(null)
    expect(screen.getByLabelText("尺の秒")).toHaveValue(null)
    fireEvent.change(screen.getByLabelText("尺の秒"), { target: { value: "30" } })
    expect(change).toHaveBeenLastCalledWith(0.5, false)
  })

  it("steps all fields independently and preserves seconds above an hour", () => {
    const change = vi.fn()
    render(<ProjectDurationInput initialSeconds={1110} onChange={change} />)
    fireEvent.click(screen.getByRole("button", { name: "時間を1増やす" }))
    expect(change).toHaveBeenLastCalledWith(78.5, false)
    fireEvent.click(screen.getByRole("button", { name: "分を1増やす" }))
    fireEvent.click(screen.getByRole("button", { name: "時間を1減らす" }))
    expect(change).toHaveBeenLastCalledWith(19.5, false)
    fireEvent.click(screen.getByRole("button", { name: "秒を1減らす" }))
    expect(change).toHaveBeenLastCalledWith(19 + 29 / 60, false)
  })

  it("records unknown without a numeric default and restores the explicit duration", () => {
    const change = vi.fn()
    render(<ProjectDurationInput initialSeconds={30} onChange={change} />)
    fireEvent.click(screen.getByLabelText("未定"))
    expect(screen.getByLabelText("尺の秒")).toBeDisabled()
    expect(change).toHaveBeenLastCalledWith(undefined, true)
    fireEvent.click(screen.getByLabelText("未定"))
    expect(change).toHaveBeenLastCalledWith(0.5, false)
  })

  it("uses the selected mobile wheel row as seconds without a bucket conversion", () => {
    const change = vi.fn()
    render(<ProjectDurationInput onChange={change} />)
    const wheel = screen.getByRole("listbox", { name: "秒を回して選択" })
    wheel.scrollTop = 31 * 40
    fireEvent.scroll(wheel)
    expect(change).toHaveBeenLastCalledWith(0.5, false)
    expect(screen.getByLabelText("尺の秒")).toHaveValue(30)
  })
})
