// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { WidgetShell } from "@/components/chatbot/widget/WidgetShell"
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

describe("WidgetShell API wiring", () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it("posts submitted chat text to /api/chatbot/message", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({
        conversationId: "conv_1",
        assistantMessage,
        tier: "tier-3-ollama-deepseek",
        ui: { kind: "none" },
      }),
    )
    vi.stubGlobal("fetch", fetchMock)

    render(<WidgetShell onMinimize={vi.fn()} />)
    submitMessage()

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(await screen.findByText("Local debug: Tier 3 Ollama DeepSeek (tier-3-ollama-deepseek)")).toBeInTheDocument()
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

  it("shows the thinking indicator while waiting for a chatbot response", async () => {
    let resolveFetch: (response: ReturnType<typeof mockJsonResponse>) => void = () => undefined
    const fetchMock = vi.fn(
      () =>
        new Promise<ReturnType<typeof mockJsonResponse>>((resolve) => {
          resolveFetch = resolve
        }),
    )
    vi.stubGlobal("fetch", fetchMock)

    render(<WidgetShell onMinimize={vi.fn()} />)
    submitMessage()

    expect(await screen.findByText("考え中")).toBeInTheDocument()
    expect(screen.getByLabelText("相談内容")).toBeDisabled()
    expect(screen.getByRole("button", { name: "送信" })).toBeDisabled()

    resolveFetch(
      mockJsonResponse({
        conversationId: "conv_1",
        assistantMessage,
        tier: "tier-3-ollama-deepseek",
        ui: { kind: "none" },
      }),
    )

    expect(await screen.findByText("最終媒体を選んでください")).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText("考え中")).not.toBeInTheDocument())
    expect(screen.getByLabelText("相談内容")).toBeEnabled()
  })

  it("adds a delay notice after six seconds while the response is pending", async () => {
    vi.useFakeTimers()
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)))

    render(<WidgetShell onMinimize={vi.fn()} />)

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
          assistantMessage,
          tier: "tier-3-ollama-deepseek",
          ui: { kind: "choice-panel", choiceSet: finalMediumChoices },
        }),
      ),
    )

    render(<WidgetShell onMinimize={vi.fn()} />)
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

    render(<WidgetShell onMinimize={vi.fn()} />)
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

    render(<WidgetShell onMinimize={vi.fn()} />)
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
    expect(await screen.findByText("送信しました。担当者からの返信をお待ちください。")).toBeInTheDocument()
  })

  it("shows a short system message on network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")))

    render(<WidgetShell onMinimize={vi.fn()} />)
    submitMessage()

    expect(await screen.findByText("通信に失敗しました。少し時間をおいてもう一度お試しください。")).toBeInTheDocument()
  })
})
