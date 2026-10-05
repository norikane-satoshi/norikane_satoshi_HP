// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { DeadlineInput } from "../DeadlineInput"

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
