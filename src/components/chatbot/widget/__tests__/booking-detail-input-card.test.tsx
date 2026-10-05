// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { BookingDetailInputCard } from "../BookingDetailInputCard"
afterEach(cleanup)
it("sends the codec and color space exactly, or an explicit undecided answer", () => {
  const submit = vi.fn()
  render(<BookingDetailInputCard label="納品形式" onSubmit={submit} />)
  expect(screen.getByRole("button", { name: "納品形式を回答する" })).toBeDisabled()
  fireEvent.change(screen.getByLabelText("納品形式"), { target: { value: "ProRes 422 HQ、Rec.709" } })
  fireEvent.click(screen.getByRole("button", { name: "納品形式を回答する" }))
  expect(submit).toHaveBeenCalledWith("納品形式: ProRes 422 HQ、Rec.709")
  fireEvent.click(screen.getByLabelText("未定"))
  fireEvent.click(screen.getByRole("button", { name: "納品形式を回答する" }))
  expect(submit).toHaveBeenLastCalledWith("納品形式: 未定")
})
it("records the planned DCP creator without repeating the assistant explanation", () => {
  const submit = vi.fn()
  render(<BookingDetailInputCard label="DCP作成担当" onSubmit={submit} />)
  expect(screen.queryByText(/則兼はDCPを作成しません/)).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText("DCP作成担当"), { target: { value: "依頼先ポスプロ" } })
  fireEvent.click(screen.getByRole("button", { name: "DCP作成担当を回答する" }))
  expect(submit).toHaveBeenCalledWith("DCP作成担当: 依頼先ポスプロ")
})
