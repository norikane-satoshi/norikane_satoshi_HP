// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"
import { readFileSync } from "node:fs"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import type { ComponentProps } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ChatbotBookingCard } from "@/components/chatbot/widget/ChatbotBookingCard"
import { CHATBOT_CONVERSATION_CONTENT_CLASS_NAME } from "@/components/chatbot/widget/conversationTypography"
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
  totalMaxDays: 2,
  riskFlags: [],
}

const conversationContentClasses = CHATBOT_CONVERSATION_CONTENT_CLASS_NAME.split(" ")

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
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => String(input) === "/api/chatbot/booking-candidates"
    ? Promise.resolve({ ok: true, status: 200, json: async () => ({ candidates, busyDateKeys: [] }) })
    : fetchMock(input, init))
  return fetchMock
}

function renderCard(props: Partial<ComponentProps<typeof ChatbotBookingCard>> = {}) {
  return render(
    <ChatbotBookingCard
      candidates={candidates}
      estimate={estimate}
      defaultDueDate="未定"
      defaultProjectTitle="CM grading"
      defaultContactName="田中"
      defaultCompanyName="株式会社サンプル"
      conversationId="conv_1"
      confirmationItems={[
        { label: "案件種別", value: "CM" }, { label: "尺", value: "18分" },
        { label: "最終媒体", value: "Web公開" }, { label: "作業場所/立ち会い", value: "お任せ" },
      ]}
      {...props}
    />,
  )
}

describe("ChatbotBookingCard", () => {
  it("groups related summary fields and puts the deadline immediately before its reason", () => {
    mockFetch(200, {})
    renderCard({ defaultDueDate: "2026-10-25", confirmationItems: [
      { label: "納品希望日の理由", value: "映画祭応募" },
      { label: "DCP作成担当", value: "他社" },
      { label: "素材が揃う日", value: "2026-10-18" },
      { label: "納品形式", value: "ProRes 422 HQ、Rec.709" },
      { label: "DCP必要性", value: "必要" },
      { label: "最終媒体", value: "劇場" },
    ] })
    fireEvent.change(screen.getByLabelText("都合の悪い日（任意）"), { target: { value: "10月20日" } })
    fireEvent.click(screen.getByRole("button", { name: "日程はまだ決まっていない" }))
    const summary = screen.getByLabelText("送信する内容")
    expect(Array.from(summary.querySelectorAll("dt"), (element) => element.textContent)).toEqual([
      "希望日", "都合の悪い日", "案件種別", "尺", "最終媒体", "納品形式", "DCP必要性", "DCP作成担当",
      "納品希望日", "納品希望日の理由", "素材が揃う日", "作業場所/立ち会い", "追加作業", "付随素材", "字幕・テロップ等", "参考URL",
    ])
    expect(within(summary).getByText("2026-10-25")).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText("納期をカレンダーで選ぶ"), { target: { value: "2026-10-26" } })
    expect(within(summary).getByText("2026-10-26")).toBeInTheDocument()
    expect(within(summary).getByText("映画祭応募")).toBeInTheDocument()
  })

  it("holds only explicitly selected dates even when the internal estimate spans multiple days", async () => {
    const fetchMock = mockFetch(200, { bookingGroupId: "group_1", bookingIds: [] })
    renderCard({ estimate: { ...estimate, totalMinDays: 8, totalMaxDays: 10 }, defaultContactEmail: "client@example.jp", candidates: [{ ...candidates[0], end: "2026-06-20T01:00:00.000Z" }] })
    expect(screen.queryByText(/工程目安|立ち会い日数|作業日数/u)).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText("都合の悪い日（任意）"), { target: { value: "6月12日は不可" } })
    fireEvent.click(screen.getByRole("button", { name: "2026-06-10 選択可" }))
    fireEvent.click(screen.getByRole("button", { name: "この日程で次へ" }))
    fireEvent.click(screen.getByLabelText(/予約内容に同意します/))
    fireEvent.click(screen.getByRole("button", { name: "予約内容を送信" }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.selectedSlots).toEqual([{ start: "2026-06-10", end: "2026-06-11" }])
    expect(body.memo).toContain("都合の悪い日: 6月12日は不可")
    expect(body).not.toHaveProperty("workflowEstimate")
    expect(body).not.toHaveProperty("attendanceDates")
    expect(body).not.toHaveProperty("jobContext")
  })

  it("requires a deadline date or explicit undecided choice and lets the customer edit all new details", async () => {
    const fetchMock = mockFetch(200, { bookingGroupId: "group_1", bookingIds: [] })
    renderCard({ defaultDueDate: "相談したい", defaultContactEmail: "client@example.jp", confirmationItems: [{ label: "最終媒体", value: "劇場" }, { label: "DCP必要性", value: "必要" }] })
    fireEvent.click(screen.getByRole("button", { name: "日程はまだ決まっていない" }))
    fireEvent.click(screen.getByLabelText(/予約内容に同意します/))
    expect(screen.getByRole("button", { name: "予約内容を送信" })).toBeDisabled()
    fireEvent.change(screen.getByLabelText("納期をカレンダーで選ぶ"), { target: { value: "2026-10-25" } })
    fireEvent.change(screen.getByLabelText("納品希望日の理由"), { target: { value: "11月1日の映画祭応募" } })
    fireEvent.change(screen.getByLabelText("納品形式"), { target: { value: "ProRes 422 HQ、Rec.709" } })
    fireEvent.click(screen.getByLabelText("素材が揃う日は未定"))
    fireEvent.change(screen.getByLabelText("素材が揃う日をカレンダーで選ぶ"), { target: { value: "2026-10-18" } })
    fireEvent.change(screen.getByLabelText("DCP作成担当"), { target: { value: "他社ポスプロ" } })
    expect(screen.queryByRole("option", { name: /則兼|グレーディングルーム/u })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/受け渡し方法|受け渡し素材/u)).not.toBeInTheDocument()
    fireEvent.click(screen.getByLabelText(/予約内容に同意します/))
    fireEvent.click(screen.getByRole("button", { name: "予約内容を送信" }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.dueDate).toBe("2026-10-25")
    expect(body.confirmedDetails).toEqual(expect.arrayContaining([
      { label: "納品形式", value: "ProRes 422 HQ、Rec.709" }, { label: "素材が揃う日", value: "2026-10-18" },
      { label: "納品希望日の理由", value: "11月1日の映画祭応募" }, { label: "DCP作成担当", value: "他社ポスプロ" },
    ]))
  })

  it("clears DCP answers after the customer changes away from theatrical release", async () => {
    const fetchMock = mockFetch(200, { bookingGroupId: "group_1", bookingIds: [] })
    renderCard({ defaultContactEmail: "client@example.jp", confirmationItems: [{ label: "最終媒体", value: "劇場" }, { label: "DCP必要性", value: "必要" }, { label: "DCP作成担当", value: "ポスプロ" }] })
    fireEvent.click(screen.getByRole("button", { name: "日程はまだ決まっていない" }))
    fireEvent.change(screen.getByLabelText("最終媒体"), { target: { value: "Web" } })
    expect(screen.queryByLabelText("DCP必要性")).not.toBeInTheDocument()
    expect(screen.queryByLabelText("DCP作成担当")).not.toBeInTheDocument()
    fireEvent.click(screen.getByLabelText(/予約内容に同意します/))
    fireEvent.click(screen.getByRole("button", { name: "予約内容を送信" }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).confirmedDetails).toEqual(expect.arrayContaining([
      { label: "DCP必要性", value: "未確認" }, { label: "DCP作成担当", value: "未確認" },
    ]))
  })

  it("does not display or submit an estimate whose core facts are unconfirmed", async () => {
    const fetchMock = mockFetch(200, { bookingGroupId: "group_1", bookingIds: [] })
    renderCard({ confirmationItems: [], defaultContactEmail: "client@example.jp" })
    expect(screen.queryByText("工程目安 2日")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "日程はまだ決まっていない" }))
    expect(screen.getByLabelText("尺の分")).toHaveValue(null)
    fireEvent.click(screen.getByLabelText(/予約内容に同意します/))
    fireEvent.click(screen.getByRole("button", { name: "予約内容を送信" }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.workflowEstimate).toBeUndefined()
    expect(body.confirmedDetails).toContainEqual({ label: "尺", value: "未確認" })
  })
  it("lets the customer correct core facts before sending and requires renewed agreement after editing", async () => {
    const fetchMock = mockFetch(200, { bookingGroupId: "group_1", bookingIds: [] })
    renderCard({ defaultContactEmail: "client@example.jp", confirmationItems: [{ label: "尺", value: "60分未満" }] })
    fireEvent.click(screen.getByRole("button", { name: "日程はまだ決まっていない" }))
    expect(screen.getByLabelText("案件種別")).toHaveValue("")
    expect(screen.getByLabelText("最終媒体")).toHaveValue("")
    expect(screen.getByLabelText("尺の分")).toHaveValue(null)
    fireEvent.click(screen.getByLabelText(/予約内容に同意します/))
    fireEvent.change(screen.getByLabelText("尺の分"), { target: { value: "18" } })
    expect(screen.getByRole("button", { name: "予約内容を送信" })).toBeDisabled()
    fireEvent.change(screen.getByLabelText("案件種別"), { target: { value: "短編ドキュメンタリー" } })
    fireEvent.change(screen.getByLabelText("最終媒体"), { target: { value: "映画祭応募" } })
    fireEvent.change(screen.getByLabelText("納品形式"), { target: { value: "ProRes 422 HQ（Rec.709）、DCP不要" } })
    fireEvent.click(screen.getByLabelText(/予約内容に同意します/))
    fireEvent.click(screen.getByRole("button", { name: "予約内容を送信" }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.confirmedDetails).toEqual(expect.arrayContaining([
      { label: "尺", value: "18分" }, { label: "案件種別", value: "短編ドキュメンタリー" },
      { label: "最終媒体", value: "映画祭応募" }, { label: "作業場所/立ち会い", value: "未確認" },
    ]))
    expect(body.workflowEstimate).toBeUndefined()
  })
  it("submits the exact hours and minutes corrected in the final review", async () => {
    const fetchMock = mockFetch(200, { bookingGroupId: "group_1", bookingIds: [] })
    renderCard({ defaultContactEmail: "client@example.jp" })
    fireEvent.click(screen.getByRole("button", { name: "日程はまだ決まっていない" }))
    expect(screen.getByLabelText("尺の分")).toHaveValue(18)
    fireEvent.click(screen.getByLabelText(/予約内容に同意します/))
    fireEvent.change(screen.getByLabelText("尺の時間"), { target: { value: "1" } })
    expect(screen.getByRole("button", { name: "予約内容を送信" })).toBeDisabled()
    fireEvent.click(screen.getByLabelText(/予約内容に同意します/))
    fireEvent.click(screen.getByRole("button", { name: "予約内容を送信" }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.confirmedDetails).toContainEqual({ label: "尺", value: "1時間18分" })
    expect(body.workflowEstimate).toBeUndefined()
  })

  it("replaces a previously answered duration with unconfirmed when the customer selects undecided", async () => {
    const fetchMock = mockFetch(200, { bookingGroupId: "group_1", bookingIds: [] })
    renderCard({ defaultContactEmail: "client@example.jp" })
    fireEvent.click(screen.getByRole("button", { name: "日程はまだ決まっていない" }))
    fireEvent.click(within(screen.getByRole("group", { name: "尺" })).getByLabelText("未定"))
    expect(screen.getByLabelText("尺の分")).toBeDisabled()
    fireEvent.click(screen.getByLabelText(/予約内容に同意します/))
    fireEvent.click(screen.getByRole("button", { name: "予約内容を送信" }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.confirmedDetails).toContainEqual({ label: "尺", value: "未確認" })
    expect(body.workflowEstimate).toBeUndefined()
  })

  it("acknowledges the committed Booking Order and every rendered prefill field without values", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void init
      if (String(input) === "/api/chatbot/audit-event") {
        return new Response(JSON.stringify({ accepted: true }), { status: 202 })
      }
      return new Response(JSON.stringify({ candidates: [], busyDateKeys: [], tentativeDateKeys: [] }), { status: 200 })
    })
    vi.stubGlobal("fetch", fetchMock)

    renderCard({
      jobContext,
      auditContext: {
        correlationId: "11111111-1111-4111-8111-111111111111",
        tier: "tier-1-hosted-chrome-notion-ai",
        responseReceivedAt: performance.now(),
      },
      defaultContactEmail: "client@example.jp",
      defaultDueDate: "2026-07-31",
      defaultMemo: "受け渡し素材: ProRes\n素材受け渡し時期: 7月\n素材受け渡し方法: アップローダー",
    })

    await waitFor(() => {
      const auditCalls = fetchMock.mock.calls.filter(([url]) => String(url) === "/api/chatbot/audit-event")
      expect(auditCalls).toHaveLength(2)
    })
    const auditBodies = fetchMock.mock.calls
      .filter(([url]) => String(url) === "/api/chatbot/audit-event")
      .map(([, init]) => JSON.parse(String(init?.body)))
    expect(auditBodies.map((body) => body.eventName).sort()).toEqual([
      "booking_card_rendered",
      "booking_prefill_rendered",
    ])
    const prefill = auditBodies.find((body) => body.eventName === "booking_prefill_rendered")
    expect(prefill.prefillFields).toHaveLength(9)
    expect(prefill.memoCoverage).toEqual({
      finalMedia: true,
      materialContents: true,
      materialTiming: true,
      materialMethod: true,
    })
    expect(JSON.stringify(prefill)).not.toContain("client@example.jp")
    expect(JSON.stringify(prefill)).not.toContain("ProRes")
  })

  it("lets the customer go on without dates, listing what the chat decided before sending", () => {
    render(
      <ChatbotBookingCard
        candidates={[]}
        jobContext={{
          finalMedium: "web",
          workSite: "remote-grading",
          documentaryAttachment: { kind: "none" },
        }}
      />,
    )

    expect(screen.getByText(/希望日や都合の悪い日があれば/u)).toBeInTheDocument()
    expect(screen.getByText(/日程は未定のままでも次へ進めます/u)).toBeInTheDocument()
    expect(screen.queryByLabelText("メール")).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "日程はまだ決まっていない" }))

    expect(screen.getByText("チャットで決まった内容です。これで送信してよいか確認してください。")).toBeInTheDocument()
    expect(screen.getByText("未定（日程は則兼と相談）")).toBeInTheDocument()
    expect(screen.getByLabelText("メール")).toBeInTheDocument()
  })

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date("2025-12-01T00:00:00+09:00"))
    mockFetch(200, { bookingGroupId: "group_1", bookingIds: ["slot_1"] })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it("renders the top candidate windows", () => {
    renderCard()

    expect(screen.getByText("Booking Order")).toBeInTheDocument()
    expect(screen.getByLabelText("仮キープ候補のカレンダー選択")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "2026-06-10 選択可" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "2026-06-11 選択可" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "日程はまだ決まっていない" }))
    expect(screen.getByLabelText("会社名")).toHaveValue("株式会社サンプル")
    expect(screen.getByLabelText("氏名")).toHaveValue("田中")
    expect(screen.getByLabelText("メール")).toHaveValue("")
    expect(screen.getByPlaceholderText("作品名または案件名（イニシャル表記も可）")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "利用規約" })).toHaveAttribute("href", "/terms")
    expect(screen.getByRole("link", { name: "プライバシーポリシー" })).toHaveAttribute("href", "/privacy")
  })

  it("does not preselect a suggested date before the customer confirms it", () => {
    renderCard({
      candidates: [candidates[0]],
      estimate: {
        stages: [],
        totalMinDays: 1,
        totalMaxDays: 1,
        riskFlags: [],
      },
    })

    const suggestedDate = screen.getByRole("button", { name: "2026-06-10 選択可" })
    expect(suggestedDate).toHaveAttribute("aria-pressed", "false")
    expect(suggestedDate).not.toHaveAttribute("data-selected", "true")
    expect(screen.getByText("希望日未選択")).toBeInTheDocument()
  })

  it("marks contact fields as required and leaves desired dates optional", () => {
    renderCard()

    const bookingOrder = screen.getByLabelText("チャット内予約")
    expect(within(bookingOrder).getByText("希望日（任意）")).toBeInTheDocument()
    expect(within(bookingOrder).getByText("希望日（任意）").parentElement).not.toHaveTextContent("必須")
    fireEvent.click(screen.getByRole("button", { name: "日程はまだ決まっていない" }))
    expect(bookingOrder).not.toHaveTextContent("（必須）")

    const requiredMarks = within(bookingOrder).getAllByText("必須")
    expect(requiredMarks).toHaveLength(4)
    requiredMarks.forEach((mark) => {
      expect(mark).toHaveClass("text-red-500")
    })
    expect(screen.getByLabelText("案件名")).toBeRequired()
    expect(screen.getByLabelText("氏名")).toBeRequired()
    expect(screen.getByLabelText("メール")).toBeRequired()
  })

  it("keeps booking order typography scoped to chatbot sans-serif", () => {
    const css = readFileSync("src/app/globals.css", "utf8")
    const shellRule = css.match(/\.chatbot-widget-shell\s*\{[\s\S]*?\n  \}/)?.[0] ?? ""
    const descendantRule =
      css.match(/\.chatbot-widget-shell :is\(h1, h2, h3, h4, h5, h6, p, label, legend, button, input, textarea, select, dt, dd, span, a\)\s*\{[\s\S]*?\n  \}/)?.[0] ?? ""

    expect(shellRule).toContain('font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;')
    expect(descendantRule).toContain("font-family: inherit;")
    expect(descendantRule).toContain("letter-spacing: 0;")
  })

  it("renders calendar date cells with numeric day text only", () => {
    renderCard()

    const dateCell = screen.getByRole("button", { name: "2026-06-10 選択可" })
    expect(dateCell).toHaveTextContent(/^10$/)
    expect(dateCell).not.toHaveTextContent("日")
  })

  it("marks selectable cells with a stronger hover target surface", () => {
    renderCard()

    const dateCell = screen.getByRole("button", { name: "2026-06-10 選択可" })
    expect(dateCell).toHaveClass("hover:bg-white/85")
    expect(dateCell).toHaveClass("hover:scale-[1.02]")
    expect(dateCell).toHaveClass("active:scale-[0.97]")
    expect(dateCell).toHaveClass("hover:ring-2")
    expect(dateCell).not.toHaveClass("bg-[var(--hp-color-accent)]")
  })

  it("keeps past date cells inert even when stale candidate data includes them", () => {
    vi.setSystemTime(new Date("2026-06-12T00:30:00+09:00"))
    renderCard({
      candidates: [
        {
          start: "2026-06-11T01:00:00.000Z",
          end: "2026-06-12T01:00:00.000Z",
          label: "6月11日 単日",
        },
        {
          start: "2026-06-12T01:00:00.000Z",
          end: "2026-06-13T01:00:00.000Z",
          label: "6月12日 単日",
        },
      ],
    })

    const pastCell = screen.getByRole("button", { name: "2026-06-11 空き・開始不可" })
    const todayCell = screen.getByRole("button", { name: "2026-06-12 選択可" })
    expect(pastCell).toBeDisabled()
    expect(pastCell).toHaveAttribute("data-calendar-state", "past")
    expect(pastCell).toHaveClass("cursor-default")
    expect(pastCell).not.toHaveClass("hover:bg-white/85")
    expect(pastCell).not.toHaveClass("hover:ring-2")

    pastCell.focus()
    expect(document.activeElement).not.toBe(pastCell)
    fireEvent.click(pastCell)
    expect(pastCell).not.toHaveAttribute("data-selected", "true")

    fireEvent.click(todayCell)
    expect(todayCell).toHaveAttribute("aria-pressed", "true")
  })

  it("renders free but unstartable calendar days separately from busy cells", () => {
    renderCard()

    const unavailableCells = screen.getAllByRole("button", { name: /空き・開始不可/ })
    expect(unavailableCells.length).toBeGreaterThan(0)
    expect(unavailableCells[0]).toBeDisabled()
    expect(unavailableCells[0]).toHaveAttribute("data-calendar-state", "free-unstartable")

    fireEvent.click(unavailableCells[0])
    expect(document.body).not.toHaveTextContent("不可")
  })

  it("renders timed work busy days as non-startable busy cells without exposing private details", () => {
    renderCard({ busyDateKeys: ["2026-06-12"] })

    const busyCell = screen.getByRole("button", { name: "2026-06-12 埋まり" })
    expect(busyCell).toBeDisabled()
    expect(busyCell).toHaveAttribute("data-calendar-state", "busy")
    expect(busyCell).toHaveTextContent(/^12$/)
    expect(screen.queryByLabelText("仮キープ候補カレンダーの凡例")).not.toBeInTheDocument()
    expect(document.body).not.toHaveTextContent("選択可")
    expect(document.body).not.toHaveTextContent("開始不可")
    expect(document.body).not.toHaveTextContent("埋まり")
    expect(document.body).not.toHaveTextContent("不可")
    expect(document.body).not.toHaveTextContent("Secret")
    expect(document.body).not.toHaveTextContent("Customer")
  })

  it("keeps chat copy in the conversation typography without changing booking controls", () => {
    renderCard()

    expect(screen.getByText("希望日や都合の悪い日があれば教えてください。希望日を選ぶと、その日だけ仮キープします。日程は未定のままでも次へ進めます。")).toHaveClass(
      ...conversationContentClasses,
    )
    expect(screen.queryByText("工程目安 2日")).not.toBeInTheDocument()
    expect(screen.getByText("Booking Order")).not.toHaveClass(...conversationContentClasses)
    fireEvent.click(screen.getByRole("button", { name: "日程はまだ決まっていない" }))
    expect(screen.getByLabelText("案件名")).not.toHaveClass(...conversationContentClasses)
  })

  it("renders the calendar with a Sunday-start weekday header", () => {
    renderCard()

    const header = screen.getByTestId("chatbot-booking-weekday-header")
    expect(Array.from(header.children).map((child) => child.textContent)).toEqual(["日", "月", "火", "水", "木", "金", "土"])
  })

  it.each([
    ["2026-02", "2026-02-01", 0],
    ["2026-06", "2026-06-01", 1],
    ["2026-09", "2026-09-01", 2],
    ["2026-04", "2026-04-01", 3],
    ["2026-01", "2026-01-01", 4],
    ["2026-05", "2026-05-01", 5],
    ["2026-08", "2026-08-01", 6],
  ])("aligns %s month dates to the Sunday-start weekday header", (_month, firstDay, expectedIndex) => {
    renderCard({
      candidates: [
        {
          start: `${firstDay}T01:00:00.000Z`,
          end: `${firstDay}T02:00:00.000Z`,
          label: `${firstDay} 午前`,
        },
      ],
    })

    const grid = screen.getByTestId("chatbot-booking-month-grid")
    expect(grid.children[expectedIndex]).toHaveAttribute("aria-label", `${firstDay} 選択可`)
  })

  it("aligns month dates to the Sunday-start weekday header instead of starting every month at Monday", () => {
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
    expect(grid.children[6]).toHaveAttribute("aria-label", "2026-08-01 空き・開始不可")
    expect(grid.children[8]).toHaveAttribute("aria-label", "2026-08-03 選択可")
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

    let julyCall: (typeof fetchMock.mock.calls)[number] | undefined
    await waitFor(() => {
      julyCall = fetchMock.mock.calls.find((call) => {
        const [, init] = call
        if (!init || typeof init !== "object" || !("body" in init)) return false
        return JSON.parse(String(init.body)).month === "2026-07"
      })
      expect(julyCall).toBeTruthy()
    })
    expect(julyCall).toBeTruthy()
    expect(await screen.findByRole("button", { name: "2026-07-03 選択可" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "2026-07-08 埋まり" })).toHaveAttribute("data-calendar-state", "busy")
  })

  it("refreshes the initial month and allows Saturday and Sunday cells from the month API", async () => {
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      if (String(input) === "/api/chatbot/booking-candidates") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            candidates: [
              {
                start: "2026-06-13T01:00:00.000Z",
                end: "2026-06-14T01:00:00.000Z",
                label: "6月13日 単日",
              },
              {
                start: "2026-06-14T01:00:00.000Z",
                end: "2026-06-15T01:00:00.000Z",
                label: "6月14日 単日",
              },
            ],
            busyDateKeys: [],
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

    renderCard({
      candidates: [
        {
          start: "2026-06-12T01:00:00.000Z",
          end: "2026-06-13T01:00:00.000Z",
          label: "6月12日 単日",
        },
      ],
      jobContext,
    })

    const saturday = await screen.findByRole("button", { name: "2026-06-13 選択可" })
    const sunday = await screen.findByRole("button", { name: "2026-06-14 選択可" })
    fireEvent.click(saturday)
    fireEvent.click(sunday)

    expect(saturday).toHaveAttribute("aria-pressed", "true")
    expect(sunday).toHaveAttribute("aria-pressed", "true")
    expect(screen.getAllByText("選択した希望日")).toHaveLength(1)
    expect(document.body).not.toHaveTextContent("不可")
  })

  it("loads single-day availability without exposing workflow estimates", async () => {
    vi.setSystemTime(new Date("2026-06-12T12:00:00+09:00"))
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      if (String(input) === "/api/chatbot/booking-candidates") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue({
            candidates: [
              {
                start: "2026-06-13T15:00:00.000Z",
                end: "2026-06-14T15:00:00.000Z",
                label: "6月14日 単日",
              },
              {
                start: "2026-06-16T15:00:00.000Z",
                end: "2026-06-17T15:00:00.000Z",
                label: "6月17日 単日",
              },
              {
                start: "2026-06-17T15:00:00.000Z",
                end: "2026-06-18T15:00:00.000Z",
                label: "6月18日 単日",
              },
            ],
            busyDateKeys: ["2026-06-12", "2026-06-13", "2026-06-15", "2026-06-16", "2026-06-19", "2026-06-24", "2026-06-26"],
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

    renderCard({
      candidates: [],
      estimate: undefined,
      jobContext,
    })

    const june14 = await screen.findByRole("button", { name: "2026-06-14 選択可" })
    const june17 = await screen.findByRole("button", { name: "2026-06-17 選択可" })
    const june18 = await screen.findByRole("button", { name: "2026-06-18 選択可" })
    const june12 = screen.getByRole("button", { name: "2026-06-12 埋まり" })
    const june10 = screen.getByRole("button", { name: "2026-06-10 空き・開始不可" })

    expect(june14).toHaveAttribute("data-calendar-state", "startable")
    expect(june14).toHaveClass("hover:bg-white/85")
    expect(june17).toHaveAttribute("data-calendar-state", "startable")
    expect(june18).toHaveAttribute("data-calendar-state", "startable")
    expect(june12).toBeDisabled()
    expect(june12).toHaveAttribute("data-calendar-state", "busy")
    expect(june10).toBeDisabled()
    expect(june10).toHaveAttribute("data-calendar-state", "past")
    expect(june10).not.toHaveClass("hover:bg-white/85")

    fireEvent.click(june14)
    fireEvent.click(june17)
    expect(june14).toHaveAttribute("aria-pressed", "true")
    expect(june17).toHaveAttribute("aria-pressed", "true")
    expect(screen.getAllByText("選択した希望日")).toHaveLength(1)

    const monthCall = fetchMock.mock.calls.find((call) => String(call[0]) === "/api/chatbot/booking-candidates")
    expect(monthCall).toBeTruthy()
    expect(JSON.parse(String(monthCall?.[1]?.body))).toMatchObject({
      month: "2026-06",
    })
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
    expect(screen.getAllByText("選択した希望日")).toHaveLength(1)
  })

  it("allows Saturday and Sunday selections and counts them toward the required days", () => {
    renderCard({
      candidates: [
        {
          start: "2026-06-13T01:00:00.000Z",
          end: "2026-06-14T01:00:00.000Z",
          label: "6月13日 単日",
        },
        {
          start: "2026-06-14T01:00:00.000Z",
          end: "2026-06-15T01:00:00.000Z",
          label: "6月14日 単日",
        },
      ],
    })

    fireEvent.click(screen.getByRole("button", { name: "2026-06-13 選択可" }))
    fireEvent.click(screen.getByRole("button", { name: "2026-06-14 選択可" }))

    expect(screen.getByRole("button", { name: "2026-06-13 選択可" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("button", { name: "2026-06-14 選択可" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getAllByText("選択した希望日")).toHaveLength(1)
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

    expect(screen.getAllByText("選択した希望日")).toHaveLength(1)
    expect(screen.getByRole("button", { name: "2026-07-01 選択可" })).toHaveAttribute("data-selected", "true")
  })



  it("uses the selected cell surface instead of circle or check markers", () => {
    renderCard()

    const firstDate = screen.getByRole("button", { name: "2026-06-10 選択可" })
    fireEvent.click(firstDate)

    expect(firstDate).toHaveAttribute("aria-pressed", "true")
    expect(firstDate).toHaveClass("bg-[var(--hp-color-accent)]")
    expect(firstDate).toHaveClass("font-bold")
    expect(firstDate.querySelector("svg")).toBeNull()
    expect(firstDate.querySelector(".rounded-full")).toBeNull()
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

    fireEvent.click(screen.getByRole("button", { name: "日程はまだ決まっていない" }))
    const memoField = screen.getByLabelText("補足")
    expect(memoField).toHaveValue("ライブ2.5h\nプロンプター消し物・顔アップ肌修正")
    expect(memoField).toHaveClass("auto-resize-textarea")
    expect(screen.getByLabelText("会社名")).toHaveValue("株式会社サンプル")
    expect(screen.getByLabelText("氏名")).toHaveValue("田中")
    expect(screen.getByLabelText("案件名")).toHaveValue("")
  })

  it("prefills the heard contact email and posts it with the booking payload", async () => {
    const fetchMock = mockFetch(200, { bookingGroupId: "group_1", bookingIds: ["slot_1"] })
    renderCard({ defaultContactEmail: "client@example.jp" })

    fireEvent.click(screen.getByRole("button", { name: "2026-06-10 選択可" }))
    fireEvent.click(screen.getByRole("button", { name: "2026-06-11 選択可" }))
    fireEvent.click(screen.getByRole("button", { name: "この日程で次へ" }))
    expect(screen.getByLabelText("メール")).toHaveValue("client@example.jp")
    fireEvent.click(screen.getByLabelText(/予約内容に同意します/))
    fireEvent.click(screen.getByRole("button", { name: "予約内容を送信" }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      contactEmail: "client@example.jp",
    })
  })

  it("does not submit an invalid visible contact email", () => {
    const fetchMock = mockFetch(200, { bookingGroupId: "group_1" })
    renderCard({ defaultContactEmail: "invalid-email" })

    fireEvent.click(screen.getByRole("button", { name: "2026-06-10 選択可" }))
    fireEvent.click(screen.getByRole("button", { name: "2026-06-11 選択可" }))
    fireEvent.click(screen.getByRole("button", { name: "この日程で次へ" }))
    fireEvent.click(screen.getByLabelText(/予約内容に同意します/))
    fireEvent.click(screen.getByRole("button", { name: "予約内容を送信" }))

    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.getByText("メールの形式を確認してください")).toBeInTheDocument()
  })

  it("does not submit without a required contact email", () => {
    const fetchMock = mockFetch(200, { bookingGroupId: "group_1" })
    renderCard()

    fireEvent.click(screen.getByRole("button", { name: "2026-06-10 選択可" }))
    fireEvent.click(screen.getByRole("button", { name: "2026-06-11 選択可" }))
    fireEvent.click(screen.getByRole("button", { name: "この日程で次へ" }))
    fireEvent.click(screen.getByLabelText(/予約内容に同意します/))
    fireEvent.click(screen.getByRole("button", { name: "予約内容を送信" }))

    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.getByRole("button", { name: "予約内容を送信" })).toBeDisabled()
  })

  it("uses a safely inferred deadline month as the center of the visible month window", () => {
    renderCard({
      defaultDueDate: "2026-07-31",
      candidates: [
        {
          start: "2026-06-22T01:00:00.000Z",
          end: "2026-06-23T01:00:00.000Z",
          label: "6月22日 単日",
        },
      ],
    })

    expect(screen.getByText("2026年7月")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "前月を表示" }))
    expect(screen.getByText("2026年6月")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "翌月を表示" }))
    fireEvent.click(screen.getByRole("button", { name: "翌月を表示" }))
    expect(screen.getByText("2026年8月")).toBeInTheDocument()
  })

  it("uses a wrapping auto-growing textarea for the project title", () => {
    const longTitle = "ライブ収録素材のカラーグレーディングと納品確認を含む長い案件名"
    renderCard({ defaultProjectTitle: longTitle })

    fireEvent.click(screen.getByRole("button", { name: "日程はまだ決まっていない" }))
    const field = screen.getByLabelText("案件名")
    expect(field.tagName).toBe("TEXTAREA")
    expect(field).toHaveValue(longTitle)
    expect(field).toHaveClass("auto-resize-textarea")
    expect(field).not.toHaveClass("overflow-y-auto")
    expect(field).toHaveStyle({ overflowY: "hidden" })
  })

  it("caps supplemental notes so wheel scrolling remains available after autogrow stops", () => {
    renderCard({ defaultMemo: "補足メモ\n".repeat(30) })

    fireEvent.click(screen.getByRole("button", { name: "日程はまだ決まっていない" }))
    const field = screen.getByLabelText("補足")
    Object.defineProperty(field, "scrollHeight", { configurable: true, value: 520 })
    fireEvent.change(field, { target: { value: "補足メモ\n".repeat(31) } })

    expect(field).toHaveClass("auto-resize-textarea")
    expect(field).toHaveStyle({ overflowY: "auto" })
  })

  it("posts the selected candidate and required fields to the chatbot booking API", async () => {
    const fetchMock = mockFetch(200, { bookingGroupId: "group_1", bookingIds: ["slot_1"] })
    renderCard()

    fireEvent.click(screen.getByRole("button", { name: "2026-06-10 選択可" }))
    fireEvent.click(screen.getByRole("button", { name: "2026-06-11 選択可" }))
    fireEvent.click(screen.getByRole("button", { name: "この日程で次へ" }))
    fireEvent.change(screen.getByLabelText("メール"), { target: { value: "client@example.jp" } })
    fireEvent.click(screen.getByLabelText(/予約内容に同意します/))
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
      contactEmail: "client@example.jp",
      selectedSlots: [
        {
          start: "2026-06-10",
          end: "2026-06-11",
        },
        {
          start: "2026-06-11",
          end: "2026-06-12",
        },
      ],
    })
  })

  it("submits when one of multiple displayed candidate days is selected", async () => {
    const fetchMock = mockFetch(200, { bookingGroupId: "group_1", bookingIds: ["slot_1"] })
    renderCard()

    fireEvent.click(screen.getByRole("button", { name: "2026-06-10 選択可" }))
    fireEvent.click(screen.getByRole("button", { name: "この日程で次へ" }))
    fireEvent.change(screen.getByLabelText("メール"), { target: { value: "client@example.jp" } })
    fireEvent.click(screen.getByLabelText(/予約内容に同意します/))
    fireEvent.click(screen.getByRole("button", { name: "予約内容を送信" }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      selectedSlots: [
        {
          start: "2026-06-10",
          end: "2026-06-11",
        },
      ],
    })
  })

  it("submits without selected candidate dates when required fields and agreement are complete", async () => {
    const fetchMock = mockFetch(200, {
      bookingGroupId: "group_1",
      bookingIds: [],
      bookingStatus: "NEEDS_SCHEDULE",
      scheduleStatus: "unscheduled",
    })
    renderCard()

    fireEvent.click(screen.getByRole("button", { name: "日程はまだ決まっていない" }))
    fireEvent.change(screen.getByLabelText("メール"), { target: { value: "client@example.jp" } })
    fireEvent.click(screen.getByLabelText(/予約内容に同意します/))
    fireEvent.click(screen.getByRole("button", { name: "予約内容を送信" }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      selectedSlots: [],
    })
    const completion = await screen.findByLabelText("予約送信完了")
    expect(within(completion).getByText("未定（日程は則兼と相談）")).toBeInTheDocument()
    expect(within(completion).getByText("予約番号: group_1")).toBeInTheDocument()
    expect(within(completion).getByText("CM grading")).toBeInTheDocument()
    expect(within(completion).getByText("田中")).toBeInTheDocument()
    expect(within(completion).getByText("client@example.jp")).toBeInTheDocument()
    expect(within(completion).getByText("株式会社サンプル")).toBeInTheDocument()
    expect(within(completion).getByText("希望日は未定として受け付けています。日程が決まったら予約カレンダーから候補日を選べます。")).toBeInTheDocument()
    expect(within(completion).getByRole("link", { name: "日程を選ぶ" })).toHaveAttribute("href", "/booking")
    expect(within(completion).getByRole("link", { name: "予約履歴を確認" })).toHaveAttribute("href", "/booking/history")
    expect(within(completion).getByText("ありがとうございます。則兼が内容を確認してご連絡します。")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "予約内容を送信" })).not.toBeInTheDocument()
  })

  it("does not fetch without agreement", () => {
    const fetchMock = mockFetch(200, { bookingGroupId: "group_1" })

    renderCard({ candidates: [{ ...candidates[0], start: "2026-06-12T01:00:00.000Z" }, candidates[1]] })
    fireEvent.click(screen.getByRole("button", { name: "日程はまだ決まっていない" }))
    fireEvent.click(screen.getByRole("button", { name: "予約内容を送信" }))
    expect(fetchMock).not.toHaveBeenCalled()

    cleanup()
    renderCard({ candidates: [] })
    fireEvent.click(screen.getByRole("button", { name: "日程はまだ決まっていない" }))
    fireEvent.click(screen.getByRole("button", { name: "予約内容を送信" }))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("does not convert 401 responses into login guidance", async () => {
    mockFetch(401, { error: "unauthorized" })
    const onRequireLogin = vi.fn()
    renderCard({ onRequireLogin })

    fireEvent.click(screen.getByRole("button", { name: "2026-06-10 選択可" }))
    fireEvent.click(screen.getByRole("button", { name: "2026-06-11 選択可" }))
    fireEvent.click(screen.getByRole("button", { name: "この日程で次へ" }))
    fireEvent.change(screen.getByLabelText("メール"), { target: { value: "client@example.jp" } })
    fireEvent.click(screen.getByLabelText(/予約内容に同意します/))
    fireEvent.click(screen.getByRole("button", { name: "予約内容を送信" }))

    expect(await screen.findByText("予約申込で予期せぬエラーが発生しました")).toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "ログインして予約に進む" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "ログインリンクを送信" })).not.toBeInTheDocument()
    expect(onRequireLogin).not.toHaveBeenCalled()
  })

  it("retries transient booking API failures before showing completion", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: vi.fn().mockResolvedValue({
          error: "chatbot_operation_failed",
          failure: { retryable: true, fallback: "tier3-inquiry-form" },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ bookingGroupId: "group_1", bookingIds: ["slot_1"] }),
      })
    vi.stubGlobal("fetch", fetchMock)
    renderCard()

    fireEvent.click(screen.getByRole("button", { name: "2026-06-10 選択可" }))
    fireEvent.click(screen.getByRole("button", { name: "2026-06-11 選択可" }))
    fireEvent.click(screen.getByRole("button", { name: "この日程で次へ" }))
    fireEvent.change(screen.getByLabelText("メール"), { target: { value: "client@example.jp" } })
    fireEvent.click(screen.getByLabelText(/予約内容に同意します/))
    fireEvent.click(screen.getByRole("button", { name: "予約内容を送信" }))

    expect(await screen.findByText("仮キープ相談を受け付けました")).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("shows completion and calls onBooked on success", async () => {
    mockFetch(200, { bookingGroupId: "group_1", bookingIds: ["slot_1"] })
    const onBooked = vi.fn()
    renderCard({ onBooked })

    fireEvent.click(screen.getByRole("button", { name: "2026-06-10 選択可" }))
    fireEvent.click(screen.getByRole("button", { name: "2026-06-11 選択可" }))
    fireEvent.click(screen.getByRole("button", { name: "この日程で次へ" }))
    fireEvent.change(screen.getByLabelText("メール"), { target: { value: "client@example.jp" } })
    fireEvent.click(screen.getByLabelText(/予約内容に同意します/))
    fireEvent.click(screen.getByRole("button", { name: "予約内容を送信" }))

    expect(await screen.findByText("仮キープ相談を受け付けました")).toBeInTheDocument()
    expect(screen.getByText("予約番号: group_1")).toBeInTheDocument()
    expect(screen.getByText("CM grading")).toBeInTheDocument()
    expect(screen.getByText("田中")).toBeInTheDocument()
    expect(screen.getByText("client@example.jp")).toBeInTheDocument()
    expect(screen.getByText("株式会社サンプル")).toBeInTheDocument()
    expect(screen.getByText("6/10(水)、6/11(木)")).toBeInTheDocument()
    expect(screen.getByText("ありがとうございます。則兼が内容を確認してご連絡します。")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "予約内容を送信" })).not.toBeInTheDocument()
    expect(screen.queryByText(/bookingGroupId:/)).not.toBeInTheDocument()
    expect(onBooked).toHaveBeenCalledWith(expect.objectContaining({
      bookingGroupId: "group_1",
      bookingIds: ["slot_1"],
      projectTitle: "CM grading",
      contactName: "田中",
      contactEmail: "client@example.jp",
      companyName: "株式会社サンプル",
    }))
  })

  it("restores the completion screen from a completed booking payload", () => {
    renderCard({
      completedBooking: {
        bookingGroupId: "group_restored",
        scheduleLabel: "候補日未選択",
        projectTitle: "復元案件",
        contactName: "佐藤",
        contactEmail: "restore@example.jp",
        companyName: "株式会社復元",
        memo: "復元メモ",
      },
    })

    expect(screen.getByLabelText("予約送信完了")).toBeInTheDocument()
    expect(screen.getByText("予約番号: group_restored")).toBeInTheDocument()
    expect(screen.getByText("復元案件")).toBeInTheDocument()
    expect(screen.getByText("佐藤")).toBeInTheDocument()
    expect(screen.getByText("restore@example.jp")).toBeInTheDocument()
    expect(screen.getByText("株式会社復元")).toBeInTheDocument()
    expect(screen.getByText("復元メモ")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "予約内容を送信" })).not.toBeInTheDocument()
  })

  describe("two steps: the calendar, then what will be sent", () => {
    const confirmationItems = [
      { label: "案件種別", value: "CM" },
      { label: "尺", value: "18分" },
      { label: "最終媒体", value: "Web" },
      { label: "作業場所/立ち会い", value: "オンライン" },
    ]

    it("moves on with the chosen dates only once a date is picked", () => {
      renderCard({ confirmationItems })

      const next = screen.getByRole("button", { name: "この日程で次へ" })
      expect(next).toBeDisabled()
      fireEvent.click(screen.getByRole("button", { name: "2026-06-10 選択可" }))
      expect(next).toBeEnabled()
      fireEvent.click(next)

      const summary = screen.getByLabelText("送信する内容")
      expect(within(summary).getByText("希望日")).toBeInTheDocument()
      expect(within(summary).getByText(/6\/10/u)).toBeInTheDocument()
      expect(within(summary).getByText("最終媒体")).toBeInTheDocument()
      expect(within(summary).getByText("オンライン")).toBeInTheDocument()
      expect(screen.queryByRole("button", { name: "2026-06-10 選択可" })).not.toBeInTheDocument()
    })



    it("goes back to the calendar with the dates still chosen", () => {
      renderCard({ confirmationItems })

      fireEvent.click(screen.getByRole("button", { name: "2026-06-10 選択可" }))
      fireEvent.click(screen.getByRole("button", { name: "この日程で次へ" }))
      fireEvent.click(screen.getByRole("button", { name: "日程を選び直す" }))

      expect(screen.getByRole("button", { name: "2026-06-10 選択可" })).toHaveAttribute("aria-pressed", "true")
    })

    it("sends the customer's note together with what the chat decided", async () => {
      const fetchMock = mockFetch(200, { bookingGroupId: "group_1", bookingIds: ["slot_1"] })
      renderCard({ confirmationItems, defaultContactEmail: "client@example.jp" })

      fireEvent.click(screen.getByRole("button", { name: "日程はまだ決まっていない" }))
      fireEvent.change(screen.getByLabelText("補足"), { target: { value: "HDR 版も相談したい" } })
      fireEvent.click(screen.getByLabelText(/予約内容に同意します/))
      fireEvent.click(screen.getByRole("button", { name: "予約内容を送信" }))

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
      const body = JSON.parse(fetchMock.mock.calls[0][1].body)
      expect(body.memo).toBe("HDR 版も相談したい")
      expect(body.confirmedDetails).toEqual(expect.arrayContaining(confirmationItems))
      expect(body.detailsConfirmed).toBe(true)
      expect(body).not.toHaveProperty("selectedSlots.0")
    })
  })
})
