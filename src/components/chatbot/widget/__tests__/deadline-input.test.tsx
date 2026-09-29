// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { DeadlineInput, DeadlinePanel } from "../DeadlineInput"

afterEach(() => { cleanup(); vi.useRealTimers() })
it("uses the JST date minimum, rejects past selection, and preserves free text", () => {
  vi.useFakeTimers().setSystemTime(new Date("2026-09-29T15:10:00Z"))
  const onChange = vi.fn()
  render(<DeadlineInput value="相談したい" onChange={onChange} />)
  expect(screen.getByPlaceholderText("例：11月20日 / 10月末ごろ / 年内 / 未定")).toBeInTheDocument()
  const date = screen.getByLabelText("納期をカレンダーで選ぶ")
  expect(date).toHaveAttribute("min", "2026-09-30")
  fireEvent.change(date, { target: { value: "2026-09-29" } })
  expect(onChange).not.toHaveBeenCalled()
  fireEvent.change(date, { target: { value: "2026-10-10" } })
  expect(onChange).toHaveBeenCalledWith("2026-10-10")
  fireEvent.change(screen.getByLabelText("納期", { exact: true }), { target: { value: "10月末ごろ" } })
  expect(onChange).toHaveBeenCalledWith("10月末ごろ")
})
it("submits a date and keeps the undecided escape", () => {
  vi.useFakeTimers().setSystemTime(new Date("2026-09-29T00:00:00Z"))
  const submit = vi.fn()
  render(<DeadlinePanel onSubmit={submit} />)
  fireEvent.change(screen.getByLabelText("納期をカレンダーで選ぶ"), { target: { value: "2026-10-10" } })
  fireEvent.click(screen.getByRole("button", { name: "納期を送信" }))
  expect(submit).toHaveBeenCalledWith("納期: 2026-10-10")
  fireEvent.click(screen.getByRole("button", { name: "未定" }))
  expect(submit).toHaveBeenCalledWith("納期: 未定")
})
