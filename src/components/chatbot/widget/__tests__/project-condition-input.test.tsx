// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { getProjectConditionDefinition } from "@/lib/booking/domain/project-conditions"
import { ProjectConditionCard } from "../ProjectConditionInput"

afterEach(cleanup)

it.each(["delivery-format", "dcp-creator"])("records %s text and explicit unknown using its stable ID", (id) => {
  const definition = getProjectConditionDefinition(id)!
  const submit = vi.fn()
  render(<ProjectConditionCard definition={definition} onSubmit={submit} />)
  const button = screen.getByRole("button", { name: `${definition.label}を回答する` })
  expect(button).toBeDisabled()
  fireEvent.change(screen.getByLabelText(definition.label), { target: { value: "ProRes 422 HQ、Rec.709" } })
  fireEvent.click(button)
  expect(submit).toHaveBeenLastCalledWith(`${definition.label}: ProRes 422 HQ、Rec.709`, { conditionId: id, answer: { status: "answered", text: "ProRes 422 HQ、Rec.709" } })
  fireEvent.click(screen.getByLabelText("未定"))
  fireEvent.click(button)
  expect(submit).toHaveBeenLastCalledWith(`${definition.label}: 未定`, { conditionId: id, answer: { status: "unknown" } })
})

it("uses definition date input even when its question contains no date keywords", () => {
  const definition = { ...getProjectConditionDefinition("desired-delivery-date")!, label: "公開に必要な日", question: "回答してください" }
  const submit = vi.fn()
  render(<ProjectConditionCard definition={definition} onSubmit={submit} />)
  fireEvent.click(screen.getByLabelText("公開に必要な日は未定"))
  fireEvent.click(screen.getByRole("button", { name: "公開に必要な日を回答する" }))
  expect(submit).toHaveBeenCalledWith("公開に必要な日: 未定", { conditionId: "desired-delivery-date", answer: { status: "unknown" } })
})

it("records explicit cut counts including zero and rejects fractional counts", () => {
  const submit = vi.fn()
  render(<ProjectConditionCard definition={getProjectConditionDefinition("retouch-cut-count")!} onSubmit={submit} />)
  fireEvent.change(screen.getByLabelText("修正カット数"), { target: { value: "1.5" } })
  expect(screen.getByRole("button", { name: "修正カット数を回答する" })).toBeDisabled()
  fireEvent.change(screen.getByLabelText("修正カット数"), { target: { value: "0" } })
  fireEvent.click(screen.getByRole("button", { name: "修正カット数を回答する" }))
  expect(submit).toHaveBeenCalledWith("修正カット数: 0", { conditionId: "retouch-cut-count", answer: { status: "answered", number: 0 } })
})
