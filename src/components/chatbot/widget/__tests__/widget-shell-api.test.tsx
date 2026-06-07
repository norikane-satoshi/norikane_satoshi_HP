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
    expect(screen.getByRole("button", { name: "6月10日 午前" })).toBeInTheDocument()
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
              summaryText: "live-60m / live / remote-grading / 日程未定",
              openQuestions: ["作業・立ち会い日程未確認"],
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
