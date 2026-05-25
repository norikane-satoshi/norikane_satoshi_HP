// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ScheduleCard } from "@/components/chatbot/widget/ScheduleCard"
import type { CandidateWindow, WorkflowEstimate } from "@/lib/chatbot/domain/workflow-estimate"

const estimate: WorkflowEstimate = {
  stages: [
    { stage: "conform", minDays: 1, maxDays: 2, note: "素材確認" },
    { stage: "delivery", minDays: 1, maxDays: 1, note: "納品" },
  ],
  totalMinDays: 2,
  totalMaxDays: 3,
  riskFlags: [],
}

const candidates: CandidateWindow[] = [
  { start: "2026-06-01T10:00:00+09:00", end: "2026-06-01T12:00:00+09:00", label: "6月1日 午前" },
  { start: "2026-06-02T14:00:00+09:00", end: "2026-06-02T16:00:00+09:00", label: "6月2日 午後" },
]

describe("ScheduleCard", () => {
  afterEach(() => cleanup())

  it("renders workflow stages and candidate windows", () => {
    render(<ScheduleCard estimate={estimate} candidates={candidates} onSelectCandidate={vi.fn()} />)

    expect(screen.getByText("工程別スケジュール")).toBeInTheDocument()
    expect(screen.getByText("コンフォーム")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "6月1日 午前" })).toBeInTheDocument()
  })

  it("calls onSelectCandidate with the candidate index", () => {
    const onSelectCandidate = vi.fn()
    render(<ScheduleCard estimate={estimate} candidates={candidates} onSelectCandidate={onSelectCandidate} />)

    screen.getByRole("button", { name: "6月2日 午後" }).click()

    expect(onSelectCandidate).toHaveBeenCalledWith(1)
  })
})
