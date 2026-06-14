// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { WidgetShell } from "@/components/chatbot/widget/WidgetShell"
import { createDefaultWidgetLayout, type WidgetLayout } from "@/components/chatbot/widget/useWidgetState"
import { finalMediumChoices } from "@/lib/chatbot/domain"

vi.mock("next-auth/react", () => ({
  signIn: vi.fn(),
}))

function mockJsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
  }
}

const assistantMessage = {
  id: "assistant_msg_1",
  role: "assistant",
  content: "最終媒体を選んでください",
  createdAt: "2026-05-26T00:00:00.000Z",
}

const userMessage = {
  id: "user_msg_1",
  role: "user",
  content: "相談したいです",
  createdAt: "2026-05-25T23:59:00.000Z",
}

function submitMessage(text = "相談したいです") {
  fireEvent.change(screen.getByLabelText("相談内容"), { target: { value: text } })
  fireEvent.click(screen.getByRole("button", { name: "送信" }))
}

function renderWidgetShell(layout: WidgetLayout = createDefaultWidgetLayout()) {
  return render(
    <WidgetShell
      layout={layout}
      onMinimize={vi.fn()}
      onModeChange={vi.fn()}
      onFloatingGeometryChange={vi.fn()}
      onSidePeekWidthChange={vi.fn()}
    />,
  )
}

function installLocalStorage() {
  const values = new Map<string, string>()
  const storage: Storage = {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    removeItem: (key: string) => values.delete(key),
    setItem: (key: string, value: string) => values.set(key, String(value)),
  }
  Object.defineProperty(window, "localStorage", { configurable: true, value: storage })
}

describe("WidgetShell API wiring", () => {
  beforeEach(() => {
    installLocalStorage()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    window.localStorage.clear()
    vi.useRealTimers()
  })

  it("posts submitted chat text to /api/chatbot/message", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({
        conversationId: "conv_1",
        userMessage,
        assistantMessage,
        tier: "tier-3-ollama-deepseek",
        tierAttempts: [
          {
            tier: "tier-1-chrome-notion-ai",
            phase: "health-check",
            outcome: "healthy",
            latencyMs: 17,
          },
          {
            tier: "tier-1-chrome-notion-ai",
            phase: "generate",
            outcome: "error",
            latencyMs: 231,
            attempt: 1,
            errorCode: "invalid-output",
          },
          {
            tier: "tier-1-chrome-notion-ai",
            phase: "generate",
            outcome: "error",
            latencyMs: 184,
            attempt: 2,
            errorCode: "invalid-output",
          },
          {
            tier: "tier-2-hosted-chrome-notion-ai",
            phase: "health-check",
            outcome: "unhealthy",
            latencyMs: 8,
            errorCode: "auth",
          },
          {
            tier: "tier-3-ollama-deepseek",
            phase: "generate",
            outcome: "success",
            latencyMs: 310,
            attempt: 1,
          },
        ],
        ui: { kind: "none" },
      }),
    )
    vi.stubGlobal("fetch", fetchMock)

    renderWidgetShell()
    submitMessage()

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(
      await screen.findByText(
        "Local debug: Actual: Tier 3 local Ollama DeepSeek (tier-3-ollama-deepseek) | Tier1 health healthy; Tier1 generate invalid-output x2; Tier1 retry 1; Tier2 VPS health unhealthy; Tier3 Ollama generate success",
      ),
    ).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/chatbot/message",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: expect.any(String),
      }),
    )
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      message: "相談したいです",
      clientSessionId: expect.any(String),
    })
  })

  it("scrolls the message pane to the bottom on send and response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        mockJsonResponse({
          conversationId: "conv_1",
          userMessage,
          assistantMessage,
          tier: "tier-3-ollama-deepseek",
          ui: { kind: "none" },
        }),
      ),
    )

    renderWidgetShell()
    const pane = screen.getByTestId("chatbot-message-scroll")
    const scrollTo = vi.fn()
    Object.defineProperty(pane, "scrollHeight", { configurable: true, value: 480 })
    Object.defineProperty(pane, "clientHeight", { configurable: true, value: 180 })
    Object.defineProperty(pane, "scrollTo", { configurable: true, value: scrollTo })

    submitMessage()

    await waitFor(() => expect(scrollTo).toHaveBeenCalled())
    expect(scrollTo).toHaveBeenCalledWith({ top: 480, behavior: "auto" })
    expect(await screen.findByText("最終媒体を選んでください")).toBeInTheDocument()
  })

  it("shows a floating scroll-down button only when the message pane is not at the bottom", () => {
    renderWidgetShell()
    const pane = screen.getByTestId("chatbot-message-scroll")
    const scrollTo = vi.fn()
    Object.defineProperty(pane, "scrollHeight", { configurable: true, value: 640 })
    Object.defineProperty(pane, "clientHeight", { configurable: true, value: 240 })
    Object.defineProperty(pane, "scrollTop", { configurable: true, writable: true, value: 40 })
    Object.defineProperty(pane, "scrollTo", { configurable: true, value: scrollTo })

    fireEvent.scroll(pane)

    const button = screen.getByRole("button", { name: "最新メッセージへ移動" })
    fireEvent.click(button)

    expect(scrollTo).toHaveBeenCalledWith({ top: 640, behavior: "smooth" })
  })

  it("shows the thinking indicator while waiting for a chatbot response", async () => {
    let resolveFetch: (response: ReturnType<typeof mockJsonResponse>) => void = () => undefined
    const fetchMock = vi.fn(
      () =>
        new Promise<ReturnType<typeof mockJsonResponse>>((resolve) => {
          resolveFetch = resolve
        }),
    )
    vi.stubGlobal("fetch", fetchMock)

    renderWidgetShell()
    submitMessage()

    expect(await screen.findByText("考え中")).toBeInTheDocument()
    expect(screen.getByLabelText("相談内容")).toBeDisabled()
    expect(screen.queryByRole("button", { name: "送信" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "停止" })).toBeInTheDocument()

    resolveFetch(
      mockJsonResponse({
        conversationId: "conv_1",
        userMessage,
        assistantMessage,
        tier: "tier-3-ollama-deepseek",
        ui: { kind: "none" },
      }),
    )

    expect(await screen.findByText("最終媒体を選んでください")).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText("考え中")).not.toBeInTheDocument())
    expect(screen.getByLabelText("相談内容")).toBeEnabled()
  })

  it("keeps the canceled user message editable and regenerates from the edit", async () => {
    const abortError = new DOMException("Aborted", "AbortError")
    let resolveEditFetch: (response: ReturnType<typeof mockJsonResponse>) => void = () => undefined
    const fetchMock = vi.fn()
    fetchMock.mockImplementationOnce((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<ReturnType<typeof mockJsonResponse>>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(abortError), { once: true })
      }),
    )
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<ReturnType<typeof mockJsonResponse>>((resolve) => {
          resolveEditFetch = resolve
        }),
    )
    vi.stubGlobal("fetch", fetchMock)

    const { unmount } = renderWidgetShell()
    submitMessage("キャンセルします")

    expect(await screen.findByText("考え中")).toBeInTheDocument()
    const firstRequest = fetchMock.mock.calls[0]?.[1] as RequestInit
    const firstBody = JSON.parse(String(firstRequest.body))
    expect(firstBody.clientUserMessageId).toMatch(/^client_msg_/)
    expect(firstBody.clientSessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )

    fireEvent.click(screen.getByRole("button", { name: "停止" }))

    await waitFor(() => expect(screen.queryByText("考え中")).not.toBeInTheDocument())
    expect(screen.getByLabelText("相談内容")).toBeEnabled()
    expect(screen.getByRole("button", { name: "送信" })).toBeInTheDocument()
    expect(screen.queryByText("通信に失敗しました。少し時間をおいてもう一度お試しください。")).not.toBeInTheDocument()
    expect(screen.getByText("キャンセルします")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "メッセージを編集" }))
    fireEvent.change(screen.getByLabelText("編集内容"), { target: { value: "編集後です" } })
    fireEvent.click(screen.getByRole("button", { name: /保存/ }))
    fireEvent.click(screen.getByRole("button", { name: "OK" }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(screen.getByText("編集後です")).toBeInTheDocument()
    expect(screen.queryByText("キャンセルします")).not.toBeInTheDocument()
    expect(screen.getByText("考え中")).toBeInTheDocument()

    const editRequest = fetchMock.mock.calls[1]?.[1] as RequestInit
    expect(JSON.parse(String(editRequest.body))).toMatchObject({
      message: "編集後です",
      editTargetMessageId: firstBody.clientUserMessageId,
      clientSessionId: firstBody.clientSessionId,
    })
    resolveEditFetch(
      mockJsonResponse({
        conversationId: "conv_1",
        userMessage: {
          ...userMessage,
          id: "edited_user_msg_1",
          content: "編集後です",
        },
        assistantMessage: {
          ...assistantMessage,
          id: "edited_assistant_msg_1",
          content: "編集後の条件で整理します",
        },
        tier: "tier-3-ollama-deepseek",
        ui: { kind: "none" },
      }),
    )
    expect(await screen.findByText("編集後の条件で整理します")).toBeInTheDocument()
    expect(screen.getByText("編集後です")).toBeInTheDocument()
    expect(screen.queryAllByText("編集後です")).toHaveLength(1)
    await waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem("hp-chatbot-session-v1") ?? "{}")
      expect(stored.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "edited_user_msg_1", role: "user", content: "編集後です" }),
          expect.objectContaining({
            id: "edited_assistant_msg_1",
            role: "assistant",
            content: "編集後の条件で整理します",
          }),
        ]),
      )
    })

    unmount()
    renderWidgetShell()
    expect(screen.getByText("編集後です")).toBeInTheDocument()
    expect(screen.getByText("編集後の条件で整理します")).toBeInTheDocument()
    expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({ signal: expect.any(AbortSignal) }))
  })

  it("adds a delay notice after six seconds while the response is pending", async () => {
    vi.useFakeTimers()
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)))

    renderWidgetShell()

    act(() => {
      submitMessage()
    })

    expect(screen.getByText("考え中")).toBeInTheDocument()
    expect(screen.queryByText("少々お時間をいただいています…")).not.toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000)
    })

    expect(screen.getByText("少々お時間をいただいています…")).toBeInTheDocument()
  })

  it("renders ChoicePanel for choice-panel responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        mockJsonResponse({
          conversationId: "conv_1",
          userMessage,
          assistantMessage,
          tier: "tier-3-ollama-deepseek",
          ui: { kind: "choice-panel", choiceSet: finalMediumChoices },
        }),
      ),
    )

    renderWidgetShell()
    submitMessage()

    expect(await screen.findByText("最終媒体を教えてください")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "OTT 配信" })).toBeInTheDocument()
  })

  it("renders ChatbotBookingCard for booking-card responses", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date("2025-12-01T00:00:00+09:00"))
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        mockJsonResponse({
          conversationId: "conv_1",
          userMessage,
          assistantMessage: {
            ...assistantMessage,
            content: "候補日時から予約できます",
          },
          tier: "tier-3-ollama-deepseek",
          ui: {
            kind: "booking-card",
            suggestedSlots: [
              {
                start: "2026-06-10T01:00:00.000Z",
                end: "2026-06-10T02:00:00.000Z",
                label: "6月10日 午前",
              },
            ],
            jobContext: {
              finalMedium: "web",
              workSite: "remote-grading",
              documentaryAttachment: { kind: "none" },
              projectLengthMinutes: 150,
              additionalWork: ["retouch", "skin-retouch"],
              preferredStartDate: "2026-06-15",
              publicReleaseDate: "2026-06-30",
              workflowEstimate: { stages: [], totalMinDays: 2, totalMaxDays: 3, riskFlags: [] },
            },
            conversationState: {
              hasFinalMedium: true,
              hasJobKind: true,
              hasProjectLength: true,
              hasAdditionalWork: true,
              hasDocumentaryAttachments: true,
              hasWorkSite: true,
              hasReferenceUrls: true,
              hasContactEmail: true,
              hasDesiredSchedule: true,
              hasCustomerIdentity: true,
              customerName: "田中",
              companyName: "株式会社サンプル",
              turnCount: 3,
            },
            bookingPrefill: {
              projectTitle: "サンプルCM",
              contactName: "田中",
              companyName: "株式会社サンプル",
            },
          },
        }),
      ),
    )

    renderWidgetShell()
    submitMessage()

    expect(await screen.findByText("候補日時から予約する")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "2026-06-10 選択可" })).toBeInTheDocument()
    const memo = screen.getByLabelText("補足ノート（任意）") as HTMLTextAreaElement
    expect(memo.value).toContain("会社名: 株式会社サンプル")
    expect(memo.value).toContain("担当者氏名: 田中")
    expect(memo.value).toContain("最終媒体: Web")
    expect(memo.value).toContain("尺: 2.5h")
    expect(memo.value).toContain("追加作業: 消し物/レタッチ / 肌修正")
    expect(memo.value).toContain("作業場所: リモート")
    expect(memo.value).toContain("素材搬入/受け取り時期: 2026-06-15")
    expect(memo.value).toContain("納品希望日: 2026-06-30")
    expect(screen.getByLabelText("会社名（任意）")).toHaveValue("株式会社サンプル")
    expect(screen.getByLabelText("担当者氏名（必須）")).toHaveValue("田中")
    expect(screen.getByLabelText("案件名（必須）")).toHaveValue("サンプルCM")
  })

  it("renders booking-card responses without conversationState", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        mockJsonResponse({
          conversationId: "conv_1",
          userMessage,
          assistantMessage: {
            ...assistantMessage,
            content: "候補日時から予約できます",
          },
          tier: "tier-3-ollama-deepseek",
          ui: {
            kind: "booking-card",
            suggestedSlots: [
              {
                start: "2026-06-10T01:00:00.000Z",
                end: "2026-06-10T02:00:00.000Z",
                label: "6月10日 午前",
              },
            ],
            jobContext: {
              finalMedium: "web",
              workSite: "remote-grading",
              documentaryAttachment: { kind: "none" },
              workflowEstimate: { stages: [], totalMinDays: 2, totalMaxDays: 3, riskFlags: [] },
            },
          },
        }),
      ),
    )

    renderWidgetShell()
    submitMessage()

    expect(await screen.findByText("候補日時から予約する")).toBeInTheDocument()
    expect(screen.getByLabelText("担当者氏名（必須）")).toHaveValue("")
    expect(screen.getByLabelText("会社名（任意）")).toHaveValue("")
  })

  it("sanitizes restored booking-card UI without conversationState", () => {
    window.localStorage.setItem(
      "hp-chatbot-session-v1",
      JSON.stringify({
        messages: [{ role: "assistant", content: "候補日時から予約できます", createdAt: "2026-06-08T00:00:00.000Z" }],
        activeUi: {
          kind: "booking-card",
          suggestedSlots: [
            {
              start: "2026-06-10T01:00:00.000Z",
              end: "2026-06-10T02:00:00.000Z",
              label: "6月10日 午前",
            },
          ],
          jobContext: {
            finalMedium: "web",
            workSite: "remote-grading",
            documentaryAttachment: { kind: "none" },
          },
        },
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    )

    renderWidgetShell()

    expect(screen.queryByText("候補日時から予約する")).not.toBeInTheDocument()
  })

  it("drops malformed restored booking-card UI instead of crashing the widget", () => {
    window.localStorage.setItem(
      "hp-chatbot-session-v1",
      JSON.stringify({
        messages: [{ role: "assistant", content: "候補日時から予約できます", createdAt: "2026-06-08T00:00:00.000Z" }],
        activeUi: {
          kind: "booking-card",
          jobContext: {
            finalMedium: "web",
            workSite: "remote-grading",
            documentaryAttachment: { kind: "none" },
          },
          conversationState: { hasDesiredSchedule: true, turnCount: 8 },
        },
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    )

    expect(() => renderWidgetShell()).not.toThrow()
    expect(screen.queryByText("候補日時から予約する")).not.toBeInTheDocument()
    expect(screen.getByLabelText("相談内容")).toBeInTheDocument()
  })

  it("migrates legacy restored booking-card candidates to suggestedSlots", () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date("2026-06-12T12:00:00+09:00"))
    window.localStorage.setItem(
      "hp-chatbot-session-v1",
      JSON.stringify({
        messages: [{ role: "assistant", content: "候補日時から予約できます", createdAt: "2026-06-08T00:00:00.000Z" }],
        activeUi: {
          kind: "booking-card",
          candidates: [
            {
              start: "2026-06-13T01:00:00.000Z",
              end: "2026-06-13T02:00:00.000Z",
              label: "6月13日 午前",
            },
          ],
          jobContext: {
            finalMedium: "web",
            workSite: "remote-grading",
            documentaryAttachment: { kind: "none" },
          },
          conversationState: { hasDesiredSchedule: true, hasContactEmail: true, turnCount: 8 },
        },
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    )

    renderWidgetShell()

    expect(screen.getByText("候補日時から予約する")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "2026-06-13 選択可" })).toBeInTheDocument()
  })

  it("recovers workflow estimates for restored booking-card UI and refreshes live candidates", async () => {
    vi.setSystemTime(new Date("2026-06-12T12:00:00+09:00"))
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      if (String(input) === "/api/chatbot/booking-candidates") {
        return Promise.resolve(mockJsonResponse({
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
        }))
      }

      return Promise.resolve(mockJsonResponse({}))
    })
    vi.stubGlobal("fetch", fetchMock)
    window.localStorage.setItem(
      "hp-chatbot-session-v1",
      JSON.stringify({
        messages: [{ role: "assistant", content: "候補日時から予約できます", createdAt: "2026-06-12T00:00:00.000Z" }],
        activeUi: {
          kind: "booking-card",
          suggestedSlots: [
            {
              start: "2026-06-09T15:00:00.000Z",
              end: "2026-06-10T15:00:00.000Z",
              label: "6月10日 単日",
            },
          ],
          busyDateKeys: ["2026-06-12", "2026-06-13", "2026-06-15", "2026-06-16", "2026-06-19", "2026-06-24", "2026-06-26"],
          jobContext: {
            jobKind: "mv-5m",
            finalMedium: "web",
            workSite: "remote-grading",
            documentaryAttachment: { kind: "none" },
            preferredStartDate: "2026-06-12",
            projectLengthMinutes: 5,
          },
          conversationState: {
            hasDesiredSchedule: true,
            hasFinalMedium: true,
            hasJobKind: true,
            hasProjectLength: true,
            hasMaterialHandoff: true,
            hasContactEmail: true,
            turnCount: 8,
          },
        },
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    )

    renderWidgetShell()

    const june14 = await screen.findByRole("button", { name: "2026-06-14 選択可" })
    const june17 = await screen.findByRole("button", { name: "2026-06-17 選択可" })
    const june18 = await screen.findByRole("button", { name: "2026-06-18 選択可" })
    fireEvent.click(june14)
    fireEvent.click(june17)

    expect(june14).toHaveAttribute("data-calendar-state", "startable")
    expect(june17).toHaveAttribute("data-calendar-state", "startable")
    expect(june18).toHaveAttribute("data-calendar-state", "startable")
    expect(screen.getByRole("button", { name: "2026-06-12 埋まり" })).toHaveAttribute("data-calendar-state", "busy")
    expect(screen.getByRole("button", { name: "2026-06-11 過去日" })).toHaveAttribute("data-calendar-state", "past")
    expect(june14).toHaveAttribute("aria-pressed", "true")
    expect(june17).toHaveAttribute("aria-pressed", "true")

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/chatbot/booking-candidates",
        expect.objectContaining({
          body: expect.stringContaining("\"workflowEstimate\""),
        }),
      )
    })
  })

  it("does not pass provided sentinels into booking-card default fields", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        mockJsonResponse({
          conversationId: "conv_1",
          userMessage,
          assistantMessage: {
            ...assistantMessage,
            content: "候補日時から予約できます",
          },
          tier: "tier-3-ollama-deepseek",
          ui: {
            kind: "booking-card",
            suggestedSlots: [
              {
                start: "2026-06-10T01:00:00.000Z",
                end: "2026-06-10T02:00:00.000Z",
                label: "6月10日 午前",
              },
            ],
            jobContext: {
              finalMedium: "web",
              workSite: "remote-grading",
              documentaryAttachment: { kind: "none" },
            },
            conversationState: {
              hasFinalMedium: true,
              hasJobKind: true,
              hasProjectLength: true,
              hasAdditionalWork: true,
              hasDocumentaryAttachments: true,
              hasWorkSite: true,
              hasReferenceUrls: true,
              hasContactEmail: true,
              hasDesiredSchedule: true,
              hasCustomerIdentity: true,
              customerName: "provided",
              companyName: "provided",
              turnCount: 3,
            },
          },
        }),
      ),
    )

    renderWidgetShell()
    submitMessage()

    expect(await screen.findByText("候補日時から予約する")).toBeInTheDocument()
    expect(screen.getByLabelText("担当者氏名（必須）")).toHaveValue("")
    expect(screen.getByLabelText("会社名（任意）")).toHaveValue("")
  })

  it("prefills booking form fields and notes from the current conversation only", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((input: RequestInfo | URL) => {
        if (String(input) === "/api/chatbot/booking-candidates") {
          return Promise.resolve(mockJsonResponse({ candidates: [], busyDateKeys: [] }))
        }

        return Promise.resolve(
          mockJsonResponse({
            conversationId: "conv_1",
            userMessage,
            assistantMessage: {
              ...assistantMessage,
              content: "候補日時から予約できます",
            },
            tier: "tier-3-ollama-deepseek",
            ui: {
              kind: "booking-card",
              suggestedSlots: [
                {
                  start: "2026-06-14T15:00:00.000Z",
                  end: "2026-06-15T15:00:00.000Z",
                  label: "6月15日 単日",
                },
              ],
              jobContext: {
                jobKind: "live-60m",
                finalMedium: "live",
                workSite: "remote-grading",
                documentaryAttachment: { kind: "none" },
                projectLengthMinutes: 150,
                preferredStartDate: "2026-06-15",
                preferredStartDateApproximate: true,
                publicReleaseDate: "2026-07-31",
                workflowEstimate: { stages: [], totalMinDays: 7, totalMaxDays: 8, riskFlags: [] },
              },
              conversationState: {
                hasCustomerIdentity: true,
                hasFinalMedium: true,
                hasJobKind: true,
                hasProjectLength: true,
                hasMaterialHandoff: true,
                hasWorkSite: true,
                hasContactEmail: true,
                hasDesiredSchedule: true,
                companyName: "テスト株式会社",
                customerName: "テストユーザー",
                contactEmail: "test@example.com",
                turnCount: 8,
              },
              bookingPrefill: {
                projectTitle: "テストライブ",
                companyName: "テスト株式会社",
                contactName: "テストユーザー",
                contactEmail: "test@example.com",
                dueDate: "2026-07-31",
              },
            },
          }),
        )
      }),
    )

    renderWidgetShell()
    submitMessage()

    expect(await screen.findByText("候補日時から予約する")).toBeInTheDocument()
    expect(screen.getByLabelText("会社名（任意）")).toHaveValue("テスト株式会社")
    expect(screen.getByLabelText("担当者氏名（必須）")).toHaveValue("テストユーザー")
    expect(screen.getByLabelText("案件名（必須）")).toHaveValue("テストライブ")
    expect(screen.getByLabelText("メールアドレス（必須）")).toHaveValue("test@example.com")
    expect(screen.getByLabelText("納期（任意）")).toHaveValue("2026-07-31")
    const memo = screen.getByLabelText("補足ノート（任意）") as HTMLTextAreaElement
    expect(memo.value).not.toContain("連絡先メール: test@example.com")
    expect(memo.value).toContain("案件種類: ライブ")
    expect(memo.value).toContain("素材搬入/受け取り時期: 2026-06-15 目安")
  })

  it("does not pass job-kind or company-like values into booking-card contact defaults", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        mockJsonResponse({
          conversationId: "conv_1",
          userMessage,
          assistantMessage: {
            ...assistantMessage,
            content: "候補日時から予約できます",
          },
          tier: "tier-3-ollama-deepseek",
          ui: {
            kind: "booking-card",
            suggestedSlots: [
              {
                start: "2026-06-10T01:00:00.000Z",
                end: "2026-06-10T02:00:00.000Z",
                label: "6月10日 午前",
              },
            ],
            jobContext: {
              finalMedium: "web",
              workSite: "remote-grading",
              documentaryAttachment: { kind: "none" },
            },
            conversationState: {
              hasFinalMedium: true,
              hasJobKind: true,
              hasProjectLength: true,
              hasAdditionalWork: true,
              hasDocumentaryAttachments: true,
              hasWorkSite: true,
              hasReferenceUrls: true,
              hasContactEmail: true,
              hasDesiredSchedule: true,
              hasCustomerIdentity: true,
              customerName: "株式会社サンプル",
              companyName: "ライブ",
              turnCount: 3,
            },
          },
        }),
      ),
    )

    renderWidgetShell()
    submitMessage()

    expect(await screen.findByText("候補日時から予約する")).toBeInTheDocument()
    expect(screen.getByLabelText("担当者氏名（必須）")).toHaveValue("")
    expect(screen.getByLabelText("会社名（任意）")).toHaveValue("")
  })

  it("renders InquiryForm for tier4 responses and posts submit-inquiry", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockJsonResponse({
          conversationId: "conv_1",
          userMessage: { ...userMessage, content: "フォームで送ります" },
          assistantMessage: {
            ...assistantMessage,
            content: "フォームに切り替えます",
          },
          tier: "tier-4-form-fallback",
          ui: { kind: "tier4-inquiry-form" },
        }),
      )
      .mockResolvedValueOnce(mockJsonResponse({ ok: true }))
    vi.stubGlobal("fetch", fetchMock)

    renderWidgetShell()
    submitMessage("フォームで送ります")

    expect(await screen.findByLabelText("問い合わせフォーム")).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText("氏名"), { target: { value: "田中" } })
    fireEvent.change(screen.getByLabelText("メールアドレス"), { target: { value: "client@example.com" } })
    fireEvent.click(within(screen.getByLabelText("問い合わせフォーム")).getByRole("button", { name: "送信" }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(fetchMock.mock.calls[1][0]).toBe("/api/chatbot/submit-inquiry")
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
      name: "田中",
      email: "client@example.com",
      conversationId: "conv_1",
    })
    expect(await screen.findByText("送信しました。のりかね本人が確認して返信します。")).toBeInTheDocument()
    expect(await screen.findByText(/送信内容/)).toHaveTextContent("メール: client@example.com")
    expect(screen.getByText(/送信内容/)).toHaveTextContent("氏名: 田中")
  })

  it("renders the normal consultation summary form and posts submit-inquiry", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockJsonResponse({
          conversationId: "conv_1",
          userMessage: { ...userMessage, content: "相談を送ります" },
          assistantMessage: {
            ...assistantMessage,
            content: "相談内容を整理しました。",
          },
          tier: "tier-3-ollama-deepseek",
          ui: {
            kind: "consultation-summary-form",
            summary: {
              subject: "チャットボット相談",
              customerEmail: "client@example.com",
              jobContext: { finalMedium: "live", workSite: "remote-grading" },
              summaryText: "live-60m / live / remote-grading / 搬入〜納品未定",
              openQuestions: ["素材搬入〜納品時期未確認"],
            },
          },
        }),
      )
      .mockResolvedValueOnce(mockJsonResponse({ ok: true }))
    vi.stubGlobal("fetch", fetchMock)

    renderWidgetShell()
    submitMessage("相談を送ります")

    expect(await screen.findByLabelText("相談サマリ")).toHaveTextContent("live-60m")
    expect(screen.getByLabelText("メールアドレス")).toHaveValue("client@example.com")
    fireEvent.click(within(screen.getByLabelText("問い合わせフォーム")).getByRole("button", { name: "送信" }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(fetchMock.mock.calls[1][0]).toBe("/api/chatbot/submit-inquiry")
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
      email: "client@example.com",
      conversationId: "conv_1",
      freeText: expect.stringContaining("live-60m"),
    })
  })

  it("shows a short system message on network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")))

    renderWidgetShell()
    submitMessage()

    expect(await screen.findByText("通信に失敗しました。少し時間をおいてもう一度お試しください。")).toBeInTheDocument()
  })

  it("shows a visible pending animation while waiting for the assistant response", async () => {
    let resolveFetch: (value: ReturnType<typeof mockJsonResponse>) => void = () => undefined
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise((resolve) => {
        resolveFetch = resolve
      })),
    )

    renderWidgetShell()
    submitMessage("待機表示を確認します")

    expect(await screen.findByText("考え中")).toBeInTheDocument()
    resolveFetch(mockJsonResponse({
      conversationId: "conv_1",
      userMessage: { ...userMessage, content: "待機表示を確認します" },
      assistantMessage,
      tier: "tier-3-ollama-deepseek",
      ui: { kind: "none" },
    }))
    await waitFor(() => expect(screen.queryByText("考え中")).not.toBeInTheDocument())
  })

  it("restores messages and conversation id after the shell remounts", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({
        conversationId: "conv_restore",
        userMessage: { ...userMessage, content: "Web CM の相談です" },
        assistantMessage,
        tier: "tier-3-ollama-deepseek",
        ui: { kind: "none" },
      }),
    )
    vi.stubGlobal("fetch", fetchMock)

    const rendered = renderWidgetShell()
    submitMessage("Web CM の相談です")
    await screen.findByText("最終媒体を選んでください")
    rendered.unmount()

    renderWidgetShell()
    expect(screen.getByText("Web CM の相談です")).toBeInTheDocument()
    submitMessage("続きです")

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
      message: "続きです",
      conversationId: "conv_restore",
    })
  })

  it("renders a review summary before direct contact send and waits for the send button", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockJsonResponse({
          conversationId: "conv_1",
          userMessage: { ...userMessage, content: "料金確認です" },
          assistantMessage: {
            ...assistantMessage,
            content: "のりかね本人が確認します。",
          },
          tier: "tier-3-ollama-deepseek",
          ui: {
            kind: "direct-contact-card",
            reason: "pricing",
            suggestedMessage: "のりかね本人が内容を確認します。",
          },
        }),
      )
      .mockResolvedValueOnce(mockJsonResponse({ ok: true }))
    vi.stubGlobal("fetch", fetchMock)

    renderWidgetShell()
    submitMessage("料金確認です")

    expect(await screen.findByLabelText("送信前の整理内容")).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    fireEvent.change(screen.getByLabelText("メールアドレス"), { target: { value: "client@example.test" } })
    fireEvent.click(screen.getByRole("button", { name: "この内容で送信" }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
      name: "",
      email: "client@example.test",
      conversationId: "conv_1",
    })
    expect(await screen.findByText(/送信内容/)).toHaveTextContent("メール: client@example.test")
    expect(screen.getByText(/送信内容/)).not.toHaveTextContent("氏名:")
  })

  it("edits a persisted user message, truncates following UI locally, and resends with editTargetMessageId", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockJsonResponse({
          conversationId: "conv_1",
          userMessage,
          assistantMessage,
          tier: "tier-3-ollama-deepseek",
          ui: { kind: "choice-panel", choiceSet: finalMediumChoices },
        }),
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          conversationId: "conv_1",
          userMessage: {
            ...userMessage,
            id: "user_msg_2",
            content: "編集後の相談です",
            createdAt: "2026-05-26T00:02:00.000Z",
          },
          assistantMessage: {
            ...assistantMessage,
            id: "assistant_msg_2",
            content: "編集後の条件で整理します",
            createdAt: "2026-05-26T00:03:00.000Z",
          },
          tier: "tier-3-ollama-deepseek",
          ui: { kind: "none" },
        }),
      )
    vi.stubGlobal("fetch", fetchMock)

    renderWidgetShell()
    submitMessage()
    expect(await screen.findByText("最終媒体を選んでください")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "メッセージを編集" }))
    fireEvent.change(screen.getByLabelText("編集内容"), { target: { value: "編集後の相談です" } })
    fireEvent.click(screen.getByRole("button", { name: /保存/ }))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(screen.getByText("保存すると、これより後のやり取りは削除されます。")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "OK" }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
      message: "編集後の相談です",
      conversationId: "conv_1",
      editTargetMessageId: "user_msg_1",
    })
    expect(await screen.findByText("編集後の条件で整理します")).toBeInTheDocument()
    expect(screen.getByText("編集後の相談です")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "OTT 配信" })).not.toBeInTheDocument()
  })
})
