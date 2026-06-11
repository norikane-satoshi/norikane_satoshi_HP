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

const jobContext = {
  jobKind: "cm-30s",
  finalMedium: "web",
  workSite: "remote-grading",
  documentaryAttachment: { kind: "none" },
  workflowEstimate: estimate,
} satisfies ComponentProps<typeof ChatbotBookingCard>["jobContext"]

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
      defaultCompanyName="株式会社サンプル"
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
    expect(screen.getByLabelText("仮キープ候補のカレンダー選択")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "2026-06-10 選択可" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "2026-06-11 選択可" })).toBeInTheDocument()
    expect(screen.getByLabelText("会社名（任意）")).toHaveValue("株式会社サンプル")
    expect(screen.getByLabelText("担当者氏名（必須）")).toHaveValue("田中")
    expect(screen.getByPlaceholderText("作品名または案件名（イニシャル表記も可）")).toBeInTheDocument()
    expect(screen.getByText("利用規約と予約内容に同意します（必須）。")).toBeInTheDocument()
  })

  it("renders free but unstartable calendar days separately from busy cells", () => {
    renderCard()

    const unavailableCells = screen.getAllByRole("button", { name: /空き・開始不可/ })
    expect(unavailableCells.length).toBeGreaterThan(0)
    expect(unavailableCells[0]).toHaveAttribute("aria-disabled", "true")
    expect(unavailableCells[0]).toHaveAttribute("data-calendar-state", "free-unstartable")

    fireEvent.click(unavailableCells[0])
    expect(screen.getByText("この日は搬入前・リードタイム内・営業外のため選択できません")).toBeInTheDocument()
  })

  it("renders timed work busy days as non-startable busy cells without exposing private details", () => {
    renderCard({ busyDateKeys: ["2026-06-12"] })

    const busyCell = screen.getByRole("button", { name: "2026-06-12 埋まり" })
    expect(busyCell).toBeDisabled()
    expect(busyCell).toHaveAttribute("data-calendar-state", "busy")
    expect(screen.getByLabelText("仮キープ候補カレンダーの凡例")).toHaveTextContent("埋まり")
    expect(document.body).not.toHaveTextContent("Secret")
    expect(document.body).not.toHaveTextContent("Customer")
  })

  it("aligns month dates to the weekday header instead of starting every month at Monday", () => {
    renderCard({
      candidates: [
        {
          start: "2026-08-03T01:00:00.000Z",
          end: "2026-08-03T02:00:00.000Z",
          label: "8月3日 午前",
        },
      ],
    })

    const grid = screen.getByTestId("chatbot-booking-month-grid")
    expect(screen.getByText("2026年8月")).toBeInTheDocument()
    expect(grid.children[5]).toHaveAttribute("aria-label", "2026-08-01 空き・開始不可")
    expect(grid.children[7]).toHaveAttribute("aria-label", "2026-08-03 選択可")
  })

  it("shows the month header and limits navigation to one month before or after the initial month", () => {
    renderCard()

    const previous = screen.getByRole("button", { name: "前月を表示" })
    const next = screen.getByRole("button", { name: "翌月を表示" })
    expect(screen.getByText("2026年6月")).toBeInTheDocument()
    expect(previous).toBeEnabled()
    expect(next).toBeEnabled()

    fireEvent.click(previous)
    expect(screen.getByText("2026年5月")).toBeInTheDocument()
    expect(previous).toBeDisabled()

    fireEvent.click(next)
    fireEvent.click(next)
    expect(screen.getByText("2026年7月")).toBeInTheDocument()
    expect(next).toBeDisabled()
  })

  it("loads candidates for the displayed month when navigating forward", async () => {
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      if (String(input) === "/api/chatbot/booking-candidates") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            candidates: [
              {
                start: "2026-07-03T01:00:00.000Z",
                end: "2026-07-03T02:00:00.000Z",
                label: "7月3日 午前",
              },
            ],
            busyDateKeys: ["2026-07-08"],
          }),
        })
      }

      return Promise.resolve({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ bookingGroupId: "group_1", bookingIds: ["slot_1"] }),
      })
    })
    vi.stubGlobal("fetch", fetchMock)

    renderCard({ jobContext })
    fireEvent.click(screen.getByRole("button", { name: "翌月を表示" }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/chatbot/booking-candidates",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: expect.any(String),
        }),
      )
    })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ month: "2026-07" })
    expect(await screen.findByRole("button", { name: "2026-07-03 選択可" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "2026-07-08 埋まり" })).toHaveAttribute("data-calendar-state", "busy")
  })

  it("allows disjoint selected days around a busy day", () => {
    renderCard({
      candidates: [
        {
          start: "2026-06-10T01:00:00.000Z",
          end: "2026-06-11T01:00:00.000Z",
          label: "6月10日 単日",
        },
        {
          start: "2026-06-12T01:00:00.000Z",
          end: "2026-06-13T01:00:00.000Z",
          label: "6月12日 単日",
        },
      ],
      busyDateKeys: ["2026-06-11"],
    })

    fireEvent.click(screen.getByRole("button", { name: "2026-06-10 選択可" }))
    fireEvent.click(screen.getByRole("button", { name: "2026-06-12 選択可" }))

    expect(screen.getByRole("button", { name: "2026-06-10 選択可" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("button", { name: "2026-06-12 選択可" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByText(/2／2日選択中/)).toBeInTheDocument()
  })

  it("keeps disjoint selected days visible when navigating across months", () => {
    renderCard({
      candidates: [
        {
          start: "2026-06-30T01:00:00.000Z",
          end: "2026-07-01T01:00:00.000Z",
          label: "6月30日 単日",
        },
        {
          start: "2026-07-01T01:00:00.000Z",
          end: "2026-07-02T01:00:00.000Z",
          label: "7月1日 単日",
        },
      ],
    })

    fireEvent.click(screen.getByRole("button", { name: "2026-06-30 選択可" }))
    fireEvent.click(screen.getByRole("button", { name: "翌月を表示" }))
    fireEvent.click(screen.getByRole("button", { name: "2026-07-01 選択可" }))

    expect(screen.getByText(/2／2日選択中/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "2026-07-01 選択可" })).toHaveAttribute("data-selected", "true")
  })

  it("rejects selecting more than the required day count", () => {
    renderCard({
      candidates: [
        ...candidates,
        {
          start: "2026-06-12T01:00:00.000Z",
          end: "2026-06-13T01:00:00.000Z",
          label: "6月12日 単日",
        },
      ],
    })

    fireEvent.click(screen.getByRole("button", { name: "2026-06-10 選択可" }))
    fireEvent.click(screen.getByRole("button", { name: "2026-06-11 選択可" }))
    fireEvent.click(screen.getByRole("button", { name: "2026-06-12 選択可" }))

    expect(screen.getByText("必要日数 2日はすでに選択済みです")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "2026-06-12 選択可" })).toHaveAttribute("aria-pressed", "false")
  })

  it("does not render internal candidate notes or booking names in the calendar UI", () => {
    renderCard({
      candidates: [
        {
          start: "2026-06-14T01:00:00.000Z",
          end: "2026-06-15T01:00:00.000Z",
          label: "6月14日 単日",
          note: "Existing booking: Secret Client Project",
        },
      ],
    })

    expect(screen.getByRole("button", { name: "2026-06-14 選択可" })).toBeInTheDocument()
    expect(screen.queryByText(/Secret Client Project/)).not.toBeInTheDocument()
  })

  it("prefills supplemental notes without mixing them into identity fields", () => {
    renderCard({
      defaultProjectTitle: "",
      defaultContactName: "田中",
      defaultCompanyName: "株式会社サンプル",
      defaultMemo: "ライブ2.5h\nプロンプター消し物・顔アップ肌修正",
    })

    expect(screen.getByLabelText("補足ノート（任意）")).toHaveValue("ライブ2.5h\nプロンプター消し物・顔アップ肌修正")
    expect(screen.getByLabelText("会社名（任意）")).toHaveValue("株式会社サンプル")
    expect(screen.getByLabelText("担当者氏名（必須）")).toHaveValue("田中")
    expect(screen.getByLabelText("案件名（必須）")).toHaveValue("")
  })

  it("uses a wrapping auto-growing textarea for the project title", () => {
    const longTitle = "ライブ収録素材のカラーグレーディングと納品確認を含む長い案件名"
    renderCard({ defaultProjectTitle: longTitle })

    const field = screen.getByLabelText("案件名（必須）")
    expect(field.tagName).toBe("TEXTAREA")
    expect(field).toHaveValue(longTitle)
    expect(field).toHaveClass("resize-none")
    expect(field).toHaveClass("overflow-hidden")
  })

  it("posts the selected candidate and required fields to the chatbot booking API", async () => {
    const fetchMock = mockFetch(200, { bookingGroupId: "group_1", bookingIds: ["slot_1"] })
    renderCard()

    fireEvent.click(screen.getByRole("button", { name: "2026-06-10 選択可" }))
    fireEvent.click(screen.getByRole("button", { name: "2026-06-11 選択可" }))
    fireEvent.click(screen.getByLabelText("利用規約と予約内容に同意します（必須）。"))
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
      selectedSlots: [
        {
          start: "2026-06-10T01:00:00.000Z",
          end: "2026-06-10T02:00:00.000Z",
        },
        {
          start: "2026-06-11T05:00:00.000Z",
          end: "2026-06-11T06:00:00.000Z",
        },
      ],
    })
  })

  it("does not fetch without agreement or a selected candidate", () => {
    const fetchMock = mockFetch(200, { bookingGroupId: "group_1" })

    renderCard({ candidates: [{ ...candidates[0], start: "2026-06-12T01:00:00.000Z" }, candidates[1]] })
    fireEvent.click(screen.getByRole("button", { name: "予約内容を送信" }))
    expect(fetchMock).not.toHaveBeenCalled()

    cleanup()
    renderCard({ candidates: [] })
    fireEvent.click(screen.getByLabelText("利用規約と予約内容に同意します（必須）。"))
    fireEvent.click(screen.getByRole("button", { name: "予約内容を送信" }))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("shows login guidance and calls onRequireLogin on 401", async () => {
    mockFetch(401, { error: "unauthorized" })
    const onRequireLogin = vi.fn()
    renderCard({ onRequireLogin })

    fireEvent.click(screen.getByRole("button", { name: "2026-06-10 選択可" }))
    fireEvent.click(screen.getByRole("button", { name: "2026-06-11 選択可" }))
    fireEvent.click(screen.getByLabelText("利用規約と予約内容に同意します（必須）。"))
    fireEvent.click(screen.getByRole("button", { name: "予約内容を送信" }))

    expect(await screen.findByText("ログインして予約に進んでください")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "ログインリンクを送信" })).toBeInTheDocument()
    expect(onRequireLogin).toHaveBeenCalledTimes(1)
  })

  it("shows completion and calls onBooked on success", async () => {
    mockFetch(200, { bookingGroupId: "group_1", bookingIds: ["slot_1"] })
    const onBooked = vi.fn()
    renderCard({ onBooked })

    fireEvent.click(screen.getByRole("button", { name: "2026-06-10 選択可" }))
    fireEvent.click(screen.getByRole("button", { name: "2026-06-11 選択可" }))
    fireEvent.click(screen.getByLabelText("利用規約と予約内容に同意します（必須）。"))
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
