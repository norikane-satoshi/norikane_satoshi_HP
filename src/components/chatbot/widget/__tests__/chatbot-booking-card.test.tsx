// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ComponentProps } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ChatbotBookingCard } from "@/components/chatbot/widget/ChatbotBookingCard"
import type { CandidateWindow, WorkflowEstimate } from "@/lib/chatbot/domain/workflow-estimate"

vi.mock("next-auth/react", () => ({
  signIn: vi.fn(),
}))

const candidates: CandidateWindow[] = [
  {
    start: "2026-06-10T01:00:00.000Z",
    end: "2026-06-10T02:00:00.000Z",
    label: "6月10日 午前",
    note: "午前枠",
  },
  {
    start: "2026-06-11T05:00:00.000Z",
    end: "2026-06-11T06:00:00.000Z",
    label: "6月11日 午後",
  },
]

const estimate: WorkflowEstimate = {
  stages: [],
  totalMinDays: 2,
  totalMaxDays: 3,
  riskFlags: [],
}

function mockFetch(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
  })
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

function renderCard(props: Partial<ComponentProps<typeof ChatbotBookingCard>> = {}) {
  return render(
    <ChatbotBookingCard
      candidates={candidates}
      estimate={estimate}
      defaultProjectTitle="CM grading"
      defaultContactName="田中"
      conversationId="conv_1"
      {...props}
    />,
  )
}

describe("ChatbotBookingCard", () => {
  beforeEach(() => {
    mockFetch(200, { bookingGroupId: "group_1", bookingIds: ["slot_1"] })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it("renders the top candidate windows", () => {
    renderCard()

    expect(screen.getByText("候補日時から予約する")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /6月10日 午前/ })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "6月11日 午後" })).toBeInTheDocument()
  })

  it("posts the selected candidate and required fields to the chatbot booking API", async () => {
    const fetchMock = mockFetch(200, { bookingGroupId: "group_1", bookingIds: ["slot_1"] })
    renderCard()

    fireEvent.click(screen.getByRole("button", { name: /6月10日 午前/ }))
    fireEvent.click(screen.getByLabelText("利用規約と予約内容に同意します。"))
    fireEvent.click(screen.getByRole("button", { name: "予約内容を送信" }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/chatbot/create-booking-from-chat",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: expect.any(String),
      }),
    )
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      conversationId: "conv_1",
      projectTitle: "CM grading",
      contactName: "田中",
      selectedSlot: {
        start: "2026-06-10T01:00:00.000Z",
        end: "2026-06-10T02:00:00.000Z",
      },
    })
  })

  it("does not fetch without agreement or a selected candidate", () => {
    const fetchMock = mockFetch(200, { bookingGroupId: "group_1" })

    renderCard({ candidates: [{ ...candidates[0], start: "2026-06-12T01:00:00.000Z" }, candidates[1]] })
    fireEvent.click(screen.getByRole("button", { name: "予約内容を送信" }))
    expect(fetchMock).not.toHaveBeenCalled()

    cleanup()
    renderCard({ candidates: [] })
    fireEvent.click(screen.getByLabelText("利用規約と予約内容に同意します。"))
    fireEvent.click(screen.getByRole("button", { name: "予約内容を送信" }))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("shows login guidance and calls onRequireLogin on 401", async () => {
    mockFetch(401, { error: "unauthorized" })
    const onRequireLogin = vi.fn()
    renderCard({ onRequireLogin })

    fireEvent.click(screen.getByRole("button", { name: /6月10日 午前/ }))
    fireEvent.click(screen.getByLabelText("利用規約と予約内容に同意します。"))
    fireEvent.click(screen.getByRole("button", { name: "予約内容を送信" }))

    expect(await screen.findByText("ログインして予約に進んでください")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "ログインリンクを送信" })).toBeInTheDocument()
    expect(onRequireLogin).toHaveBeenCalledTimes(1)
  })

  it("shows completion and calls onBooked on success", async () => {
    mockFetch(200, { bookingGroupId: "group_1", bookingIds: ["slot_1"] })
    const onBooked = vi.fn()
    renderCard({ onBooked })

    fireEvent.click(screen.getByRole("button", { name: /6月10日 午前/ }))
    fireEvent.click(screen.getByLabelText("利用規約と予約内容に同意します。"))
    fireEvent.click(screen.getByRole("button", { name: "予約内容を送信" }))

    expect(await screen.findByText("予約を受け付けました")).toBeInTheDocument()
    expect(screen.getByText("予約番号: group_1")).toBeInTheDocument()
    expect(screen.queryByText(/bookingGroupId:/)).not.toBeInTheDocument()
    expect(onBooked).toHaveBeenCalledWith({
      bookingGroupId: "group_1",
      bookingIds: ["slot_1"],
    })
  })
})
