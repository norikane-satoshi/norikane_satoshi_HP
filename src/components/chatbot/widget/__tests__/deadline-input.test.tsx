// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { DateAnswerPanel, DeadlineInput, DeadlinePanel } from "../DeadlineInput"

afterEach(() => { cleanup(); vi.useRealTimers() })
it("offers a future date or undecided, with no vague free-text deadline", () => {
  vi.useFakeTimers().setSystemTime(new Date("2026-09-29T15:10:00Z"))
  const change = vi.fn()
  render(<DeadlineInput value="" onChange={change} />)
  const date = screen.getByLabelText("納期をカレンダーで選ぶ")
  expect(date).toHaveAttribute("min", "2026-09-30")
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument()
  expect(screen.queryByText("相談したい")).not.toBeInTheDocument()
  fireEvent.change(date, { target: { value: "2026-09-29" } })
  expect(change).not.toHaveBeenCalled()
  fireEvent.change(date, { target: { value: "2026-10-10" } })
  expect(change).toHaveBeenCalledWith("2026-10-10")
  fireEvent.click(screen.getByLabelText("納期は未定"))
  expect(change).toHaveBeenCalledWith("未定")
})
it("records the exact deadline and its optional fixed-date reason as customer answers", () => {
  vi.useFakeTimers().setSystemTime(new Date("2026-09-29T00:00:00Z"))
  const submit = vi.fn()
  render(<DeadlinePanel onSubmit={submit} />)
  expect(screen.getByRole("button", { name: "納期を回答する" })).toBeDisabled()
  fireEvent.change(screen.getByLabelText("納期をカレンダーで選ぶ"), { target: { value: "2026-10-25" } })
  fireEvent.change(screen.getByLabelText("納品希望日の理由"), { target: { value: "11/1映画祭応募" } })
  fireEvent.click(screen.getByRole("button", { name: "納期を回答する" }))
  expect(submit).toHaveBeenCalledWith("納期: 2026-10-25\n納品希望日の理由: 11/1映画祭応募")
  fireEvent.click(screen.getByLabelText("納期は未定"))
  expect(screen.queryByLabelText("納品希望日の理由")).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "納期を回答する" }))
  expect(submit).toHaveBeenLastCalledWith("納期: 未定")
})
it("records material readiness independently of the delivery deadline", () => {
  const submit = vi.fn()
  render(<DateAnswerPanel label="素材が揃う日" onSubmit={submit} />)
  fireEvent.click(screen.getByLabelText("素材が揃う日は未定"))
  fireEvent.click(screen.getByRole("button", { name: "素材が揃う日を回答する" }))
  expect(submit).toHaveBeenCalledWith("素材が揃う日: 未定")
})
