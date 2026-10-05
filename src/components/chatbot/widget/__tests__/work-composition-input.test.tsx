// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { WorkCompositionInput } from "../WorkCompositionInput"
import { ProjectConditionCard } from "../ProjectConditionInput"
import { getProjectConditionDefinition } from "@/lib/booking/domain/project-conditions"

afterEach(cleanup)

describe("work composition input", () => {
  it("starts with one unnamed piece and preserves a 30 second customer answer", () => {
    const submit = vi.fn()
    render(<ProjectConditionCard definition={getProjectConditionDefinition("project-length")!} onSubmit={submit} />)
    expect(screen.getByLabelText("作品1の本数")).toHaveValue(1)
    expect(screen.getByLabelText("作品1の名称")).toHaveValue("")
    fireEvent.change(screen.getByLabelText("尺の秒"), { target: { value: "30" } })
    fireEvent.click(screen.getByRole("button", { name: "作品構成を回答する" }))
    expect(submit).toHaveBeenCalledWith("作品構成: 作品1 1本 × 30秒", { conditionId: "project-length", answer: { status: "answered", composition: [{ count: 1, durationSeconds: 30 }] } })
  })

  it("retains different lengths and counts, and deletion keeps the surviving row's picker", () => {
    const change = vi.fn()
    render(<WorkCompositionInput onChange={change} />)
    fireEvent.change(screen.getByLabelText("作品1の名称"), { target: { value: "ライブ本編" } })
    fireEvent.change(screen.getByLabelText("尺の時間"), { target: { value: "2" } })
    fireEvent.click(screen.getByRole("button", { name: "作品を追加" }))
    const making = within(screen.getByRole("group", { name: "作品2" }))
    fireEvent.change(making.getByLabelText("作品2の名称"), { target: { value: "メイキング" } })
    fireEvent.change(making.getByLabelText("尺の分"), { target: { value: "20" } })
    fireEvent.change(making.getByLabelText("作品2の本数"), { target: { value: "2" } })
    expect(change).toHaveBeenLastCalledWith([{ name: "ライブ本編", count: 1, durationSeconds: 7200 }, { name: "メイキング", count: 2, durationSeconds: 1200 }])
    fireEvent.click(screen.getByRole("button", { name: "作品1を削除" }))
    expect(screen.getByLabelText("尺の分")).toHaveValue(20)
    expect(screen.getByLabelText("作品1の名称")).toHaveValue("メイキング")
  })

  it("marks a duration unknown without supplying an assumed number", () => {
    const submit = vi.fn()
    render(<ProjectConditionCard definition={getProjectConditionDefinition("project-length")!} onSubmit={submit} />)
    fireEvent.click(screen.getByLabelText("未定"))
    fireEvent.click(screen.getByRole("button", { name: "作品構成を回答する" }))
    expect(submit.mock.calls[0][1].answer.composition).toEqual([{ count: 1, durationSeconds: undefined }])
    expect(submit.mock.calls[0][0]).toContain("尺未確認")
  })
})
