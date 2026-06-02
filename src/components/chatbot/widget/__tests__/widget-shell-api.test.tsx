// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
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
  role: "assistant",
  content: "最終媒体を選んでください",
  createdAt: "2026-05-26T00:00:00.000Z",
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
  })

  it("posts submitted chat text to /api/chatbot/message", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({
        conversationId: "conv_1",
        assistantMessage,
        tier: "tier-2-ollama-deepseek",
        ui: { kind: "none" },
      }),
    )
    vi.stubGlobal("fetch", fetchMock)

    renderWidgetShell()
    submitMessage()

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(await screen.findByText("Local debug: Tier 2 Ollama DeepSeek (tier-2-ollama-deepseek)")).toBeInTheDocument()
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
    })
  })

  it("renders ChoicePanel for choice-panel responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        mockJsonResponse({
          conversationId: "conv_1",
          assistantMessage,
          tier: "tier-2-ollama-deepseek",
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
          assistantMessage: {
            ...assistantMessage,
            content: "候補日時から予約できます",
          },
          tier: "tier-2-ollama-deepseek",
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
    fireEvent.change(screen.getByLabelText("メール"), { target: { value: "client@example.com" } })
    fireEvent.click(within(screen.getByLabelText("問い合わせフォーム")).getByRole("button", { name: "送信" }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(fetchMock.mock.calls[1][0]).toBe("/api/chatbot/submit-inquiry")
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
      name: "田中",
      email: "client@example.com",
      conversationId: "conv_1",
    })
    expect(await screen.findByText("送信しました。のりかね本人が確認して返信します。")).toBeInTheDocument()
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

    expect(await screen.findByRole("status", { name: "応答を作成中" })).toBeInTheDocument()
    resolveFetch(mockJsonResponse({
      conversationId: "conv_1",
      assistantMessage,
      tier: "tier-2-ollama-deepseek",
      ui: { kind: "none" },
    }))
    await waitFor(() => expect(screen.queryByRole("status", { name: "応答を作成中" })).not.toBeInTheDocument())
  })

  it("restores messages and conversation id after the shell remounts", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({
        conversationId: "conv_restore",
        assistantMessage,
        tier: "tier-2-ollama-deepseek",
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
          assistantMessage: {
            ...assistantMessage,
            content: "のりかね本人が確認します。",
          },
          tier: "tier-2-ollama-deepseek",
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
  })
})
