// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ChatbotBookingCard } from "@/components/chatbot/widget/ChatbotBookingCard"
import type { CandidateWindow, WorkflowEstimate } from "@/lib/chatbot/domain/workflow-estimate"

vi.mock("next-auth/react", () => ({
  signIn: vi.fn(),
}))

const estimate: WorkflowEstimate = {
  stages: [],
  totalMinDays: 1,
  totalMaxDays: 1,
  riskFlags: [],
}

const candidates: CandidateWindow[] = [
  { start: "2026-12-01T00:00:00.000+09:00", end: "2026-12-02T00:00:00.000+09:00", label: "12月1日 単日" },
  { start: "2026-12-04T00:00:00.000+09:00", end: "2026-12-05T00:00:00.000+09:00", label: "12月4日 単日" },
]

afterEach(cleanup)

function renderCard(props: Partial<React.ComponentProps<typeof ChatbotBookingCard>> = {}) {
  return render(
    <ChatbotBookingCard
      candidates={candidates}
      estimate={estimate}
      busyDateKeys={[]}
      tentativeDateKeys={["2026-12-01"]}
      {...props}
    />,
  )
}

describe("ChatbotBookingCard 仮キープ表示", () => {
  it("marks a 仮キープ day as tentative while keeping it selectable", () => {
    renderCard()

    const cell = screen.getByLabelText("2026-12-01 選択可・仮キープあり")
    expect(cell).toBeEnabled()
    expect(cell).toHaveAttribute("data-calendar-state", "tentative")
    expect(cell).toHaveTextContent("仮")
  })

  it("leaves days without a 仮キープ as ordinary selectable days", () => {
    renderCard()

    const cell = screen.getByLabelText("2026-12-04 選択可")
    expect(cell).toHaveAttribute("data-calendar-state", "startable")
    expect(cell).not.toHaveTextContent("仮")
  })

  it("does not mark anything when no 仮キープ is present", () => {
    renderCard({ tentativeDateKeys: [] })

    expect(screen.queryByLabelText("2026-12-01 選択可・仮キープあり")).toBeNull()
    expect(screen.getByLabelText("2026-12-01 選択可")).toHaveAttribute("data-calendar-state", "startable")
  })

  it("does not offer attendance dates after a calendar deadline", () => {
    renderCard({ defaultDueDate: "2026-11-30" })
    fireEvent.click(screen.getByRole("button", { name: "翌月を表示" }))

    const cell = screen.getByLabelText("2026-12-01 納期後・選択不可")
    expect(cell).toBeDisabled()
    expect(cell).toHaveAttribute("data-calendar-state", "after-deadline")
  })

  it("keeps approximate deadlines as notes rather than calendar limits", () => {
    renderCard({ defaultDueDate: "11月末ごろ" })

    expect(screen.getByLabelText("2026-12-01 選択可・仮キープあり")).toBeEnabled()
  })

  it("drops a selected day when the customer moves the deadline before it", () => {
    renderCard({ defaultDueDate: "2026-12-31" })
    fireEvent.click(screen.getByLabelText("2026-12-01 選択可・仮キープあり"))
    fireEvent.click(screen.getByRole("button", { name: "この日程で次へ" }))
    fireEvent.change(screen.getByLabelText("納期をカレンダーで選ぶ"), { target: { value: "2026-11-30" } })
    fireEvent.click(screen.getByRole("button", { name: "日程を選び直す" }))

    expect(screen.getByLabelText("2026-12-01 納期後・選択不可")).toBeDisabled()
    expect(screen.getByText("希望日未選択")).toBeInTheDocument()
  })
})
