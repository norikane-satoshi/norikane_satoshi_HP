// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { hydrateRoot } from "react-dom/client"
import { renderToString } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { WidgetShell } from "@/components/chatbot/widget/WidgetShell"
import { additionalWorkChoices, finalMediumChoices } from "@/lib/chatbot/domain"

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
  id: "assistant_1",
  role: "assistant",
  content: "最終媒体を選んでください",
  createdAt: "2026-05-26T00:00:00.000Z",
}
const chatbotSessionStorageKey = "hp-chatbot-session-v1"

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

function removeStoredWidgetSession() {
  try {
    window.localStorage.removeItem(chatbotSessionStorageKey)
  } catch {
    // Some tests intentionally simulate unavailable storage.
  }
}

function writeStoredWidgetSession(session: {
  messages: Array<{ id?: string; role: string; content: string; createdAt: string }>
  clientSessionId?: string
  conversationId?: string
  activeUi?: unknown
  lastResponseTier?: string
}) {
  window.localStorage.setItem(
    chatbotSessionStorageKey,
    JSON.stringify({
      messages: session.messages,
      clientSessionId: session.clientSessionId,
      conversationId: session.conversationId,
      activeUi: session.activeUi ?? { kind: "none" },
      lastResponseTier: session.lastResponseTier,
      expiresAt: "2999-01-01T00:00:00.000Z",
    }),
  )
}

function submitMessage(text = "相談したいです") {
  fireEvent.change(screen.getByLabelText("相談内容"), { target: { value: text } })
  fireEvent.click(screen.getByRole("button", { name: "送信" }))
}

function setConversationScrollGeometry(input: { scrollTop: number; clientHeight: number; scrollHeight: number }) {
  const container = screen.getByLabelText("チャット本文")
  Object.defineProperty(container, "clientHeight", { configurable: true, value: input.clientHeight })
  Object.defineProperty(container, "scrollHeight", { configurable: true, value: input.scrollHeight })
  container.scrollTop = input.scrollTop
  return container
}

describe("WidgetShell API wiring", () => {
  beforeEach(() => {
    installLocalStorage()
    removeStoredWidgetSession()
  })

  afterEach(() => {
    cleanup()
    removeStoredWidgetSession()
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
    expect(screen.getByRole("button", { name: "停止" })).toBeInTheDocument()

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

  it("auto-scrolls to the latest assistant response when the conversation is already at bottom", async () => {
    let resolveFetch: (response: ReturnType<typeof mockJsonResponse>) => void = () => undefined
    const fetchMock = vi.fn(
      () =>
        new Promise<ReturnType<typeof mockJsonResponse>>((resolve) => {
          resolveFetch = resolve
        }),
    )
    vi.stubGlobal("fetch", fetchMock)

    render(<WidgetShell onMinimize={vi.fn()} />)
    const container = setConversationScrollGeometry({ scrollTop: 300, clientHeight: 300, scrollHeight: 600 })
    submitMessage("最新回答まで追従したいです")

    setConversationScrollGeometry({ scrollTop: container.scrollTop, clientHeight: 300, scrollHeight: 900 })
    resolveFetch(
      mockJsonResponse({
        conversationId: "conv_1",
        assistantMessage,
        tier: "tier-3-ollama-deepseek",
        ui: { kind: "none" },
      }),
    )

    expect(await screen.findByText("最終媒体を選んでください")).toBeInTheDocument()
    await waitFor(() => expect(container.scrollTop).toBe(900))
    expect(screen.queryByRole("button", { name: "一番下へ移動" })).not.toBeInTheDocument()
  })

  it("keeps the reader position and exposes a jump button when new messages arrive away from bottom", async () => {
    let resolveFetch: (response: ReturnType<typeof mockJsonResponse>) => void = () => undefined
    const fetchMock = vi.fn(
      () =>
        new Promise<ReturnType<typeof mockJsonResponse>>((resolve) => {
          resolveFetch = resolve
        }),
    )
    vi.stubGlobal("fetch", fetchMock)

    render(<WidgetShell onMinimize={vi.fn()} />)
    const container = setConversationScrollGeometry({ scrollTop: 0, clientHeight: 300, scrollHeight: 900 })
    fireEvent.scroll(container)
    submitMessage("過去ログを読みながら相談します")

    setConversationScrollGeometry({ scrollTop: 0, clientHeight: 300, scrollHeight: 1200 })
    resolveFetch(
      mockJsonResponse({
        conversationId: "conv_1",
        assistantMessage,
        tier: "tier-3-ollama-deepseek",
        ui: { kind: "none" },
      }),
    )

    expect(await screen.findByText("最終媒体を選んでください")).toBeInTheDocument()
    expect(container.scrollTop).toBe(0)

    fireEvent.click(screen.getByRole("button", { name: "一番下へ移動" }))
    expect(container.scrollTop).toBe(1200)
    expect(screen.queryByRole("button", { name: "一番下へ移動" })).not.toBeInTheDocument()
  })

  it("stops an in-flight chatbot response without showing a network error", async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      const signal = init?.signal
      return new Promise<ReturnType<typeof mockJsonResponse>>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")))
      })
    })
    vi.stubGlobal("fetch", fetchMock)

    render(<WidgetShell onMinimize={vi.fn()} />)
    submitMessage("停止したい相談です")

    expect(await screen.findByText("考え中")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "停止" }))

    await waitFor(() => expect(screen.queryByText("考え中")).not.toBeInTheDocument())
    expect(screen.queryByText(/通信に失敗しました/u)).not.toBeInTheDocument()
    expect(screen.getByText("停止したい相談です")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "メッセージを編集" })).toBeInTheDocument()
    const fetchInit = fetchMock.mock.calls[0]?.[1]
    expect(fetchInit).toBeDefined()
    expect(JSON.parse(String(fetchInit?.body))).toMatchObject({
      message: "停止したい相談です",
      clientSessionId: expect.any(String),
      clientUserMessageId: expect.stringMatching(/^client_msg_/),
    })
    expect(fetchInit?.signal).toBeInstanceOf(AbortSignal)
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

  it("does not submit multiple choice panels until the selection is confirmed", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockJsonResponse({
          conversationId: "conv_1",
          assistantMessage,
          tier: "tier-3-ollama-deepseek",
          ui: { kind: "choice-panel", choiceSet: additionalWorkChoices },
        }),
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          conversationId: "conv_1",
          assistantMessage: {
            ...assistantMessage,
            content: "次の質問です",
          },
          tier: "tier-3-ollama-deepseek",
          ui: { kind: "none" },
        }),
      )
    vi.stubGlobal("fetch", fetchMock)

    render(<WidgetShell onMinimize={vi.fn()} />)
    submitMessage()

    expect(await screen.findByText("カラグレ以外の追加作業はありますか")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "消し物" }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole("button", { name: "肌修正" }))
    fireEvent.click(screen.getByRole("button", { name: "選択を送信" }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
      message: "選択: 消し物、肌修正",
      conversationId: "conv_1",
    })
  })

  it("treats confirmed ChoicePanel submissions as new conversation content for bottom follow-up", async () => {
    let resolveChoiceResponse: (response: ReturnType<typeof mockJsonResponse>) => void = () => undefined
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockJsonResponse({
          conversationId: "conv_1",
          assistantMessage,
          tier: "tier-3-ollama-deepseek",
          ui: { kind: "choice-panel", choiceSet: additionalWorkChoices },
        }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<ReturnType<typeof mockJsonResponse>>((resolve) => {
            resolveChoiceResponse = resolve
          }),
      )
    vi.stubGlobal("fetch", fetchMock)

    render(<WidgetShell onMinimize={vi.fn()} />)
    const container = setConversationScrollGeometry({ scrollTop: 300, clientHeight: 300, scrollHeight: 600 })
    submitMessage()

    expect(await screen.findByText("カラグレ以外の追加作業はありますか")).toBeInTheDocument()
    setConversationScrollGeometry({ scrollTop: 0, clientHeight: 300, scrollHeight: 900 })
    fireEvent.scroll(container)
    fireEvent.click(screen.getByRole("button", { name: "消し物" }))
    fireEvent.click(screen.getByRole("button", { name: "肌修正" }))
    fireEvent.click(screen.getByRole("button", { name: "選択を送信" }))

    setConversationScrollGeometry({ scrollTop: 0, clientHeight: 300, scrollHeight: 1200 })
    resolveChoiceResponse(
      mockJsonResponse({
        conversationId: "conv_1",
        assistantMessage: {
          ...assistantMessage,
          content: "次の質問です",
        },
        tier: "tier-3-ollama-deepseek",
        ui: { kind: "none" },
      }),
    )

    expect(await screen.findByText("次の質問です")).toBeInTheDocument()
    expect(container.scrollTop).toBe(0)
    expect(screen.getByRole("button", { name: "一番下へ移動" })).toBeInTheDocument()
  })

  it("sends other comments with the selected choice labels", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockJsonResponse({
          conversationId: "conv_1",
          assistantMessage,
          tier: "tier-3-ollama-deepseek",
          ui: { kind: "choice-panel", choiceSet: additionalWorkChoices },
        }),
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          conversationId: "conv_1",
          assistantMessage: {
            ...assistantMessage,
            content: "次の質問です",
          },
          tier: "tier-3-ollama-deepseek",
          ui: { kind: "none" },
        }),
      )
    vi.stubGlobal("fetch", fetchMock)

    render(<WidgetShell onMinimize={vi.fn()} />)
    submitMessage()

    expect(await screen.findByText("カラグレ以外の追加作業はありますか")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "その他" }))
    fireEvent.change(screen.getByLabelText("その他の内容"), { target: { value: "MA も相談したい" } })
    fireEvent.click(screen.getByRole("button", { name: "選択を送信" }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
      message: "選択: その他\nその他コメント: MA も相談したい",
      conversationId: "conv_1",
    })
  })

  it("restores messages, active UI, and conversation id after the shell remounts", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockJsonResponse({
          conversationId: "conv_1",
          assistantMessage,
          tier: "tier-3-ollama-deepseek",
          ui: { kind: "choice-panel", choiceSet: finalMediumChoices },
        }),
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          conversationId: "conv_1",
          assistantMessage: {
            ...assistantMessage,
            content: "次の質問です",
          },
          tier: "tier-3-ollama-deepseek",
          ui: { kind: "none" },
        }),
      )
    vi.stubGlobal("fetch", fetchMock)

    const firstRender = render(<WidgetShell onMinimize={vi.fn()} />)
    submitMessage("初回相談です")

    expect(await screen.findByText("初回相談です")).toBeInTheDocument()
    expect(await screen.findByText("最終媒体を選んでください")).toBeInTheDocument()
    expect(await screen.findByText("最終媒体を教えてください")).toBeInTheDocument()

    firstRender.unmount()
    render(<WidgetShell onMinimize={vi.fn()} />)

    expect(screen.getByText("初回相談です")).toBeInTheDocument()
    expect(screen.getByText("最終媒体を選んでください")).toBeInTheDocument()
    expect(screen.getByText("最終媒体を教えてください")).toBeInTheDocument()

    submitMessage("続きです")

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
      message: "続きです",
      conversationId: "conv_1",
    })
  })

  it("restores messages, active UI, and conversation id after browser reload hydration", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({
        conversationId: "conv_reload",
        assistantMessage: {
          ...assistantMessage,
          content: "続きの回答です",
        },
        tier: "tier-3-ollama-deepseek",
        ui: { kind: "none" },
      }),
    )
    vi.stubGlobal("fetch", fetchMock)

    const serverHtml = renderToString(<WidgetShell onMinimize={vi.fn()} />)
    const container = document.createElement("div")
    container.innerHTML = serverHtml
    document.body.appendChild(container)

    writeStoredWidgetSession({
      messages: [
        { id: "user_reload", role: "user", content: "リロード前の相談です", createdAt: "2026-05-26T00:00:00.000Z" },
        { id: "assistant_reload", role: "assistant", content: "保存済みの回答です", createdAt: "2026-05-26T00:00:01.000Z" },
      ],
      clientSessionId: "11111111-1111-4111-8111-111111111111",
      conversationId: "conv_reload",
      activeUi: { kind: "choice-panel", choiceSet: finalMediumChoices },
      lastResponseTier: "tier-3-ollama-deepseek",
    })

    const onRecoverableError = vi.fn()
    const root = hydrateRoot(container, <WidgetShell onMinimize={vi.fn()} />, { onRecoverableError })

    expect(await screen.findByText("リロード前の相談です")).toBeInTheDocument()
    expect(screen.getByText("保存済みの回答です")).toBeInTheDocument()
    expect(screen.getByText("最終媒体を教えてください")).toBeInTheDocument()
    expect(onRecoverableError).not.toHaveBeenCalled()

    submitMessage("リロード後の続きです")

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      message: "リロード後の続きです",
      conversationId: "conv_reload",
      clientSessionId: "11111111-1111-4111-8111-111111111111",
    })

    root.unmount()
  })

  it("starts a fresh session when stored session data is expired or malformed", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({
        conversationId: "conv_new",
        assistantMessage,
        tier: "tier-3-ollama-deepseek",
        ui: { kind: "none" },
      }),
    )
    vi.stubGlobal("fetch", fetchMock)

    window.localStorage.setItem(
      chatbotSessionStorageKey,
      JSON.stringify({
        messages: [{ role: "user", content: "期限切れ相談", createdAt: "2026-05-26T00:00:00.000Z" }],
        conversationId: "conv_expired",
        activeUi: { kind: "choice-panel", choiceSet: finalMediumChoices },
        expiresAt: "2000-01-01T00:00:00.000Z",
      }),
    )

    const expiredRender = render(<WidgetShell onMinimize={vi.fn()} />)
    expect(screen.queryByText("期限切れ相談")).not.toBeInTheDocument()
    submitMessage("新規相談です")

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      message: "新規相談です",
    })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty("conversationId")

    expiredRender.unmount()
    fetchMock.mockClear()
    window.localStorage.setItem(chatbotSessionStorageKey, "{")
    render(<WidgetShell onMinimize={vi.fn()} />)
    expect(screen.queryByText("期限切れ相談")).not.toBeInTheDocument()
    submitMessage("壊れた保存後の相談です")

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      message: "壊れた保存後の相談です",
    })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty("conversationId")
  })

  it("continues with the initial session when localStorage is unavailable", async () => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: () => {
          throw new Error("storage unavailable")
        },
        removeItem: () => {
          throw new Error("storage unavailable")
        },
        setItem: () => {
          throw new Error("storage unavailable")
        },
      },
    })
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
    expect(screen.getByText("ご相談や案件依頼はこちらです。最終媒体、公開時期、作業時期などを会話で整理します。")).toBeInTheDocument()
    submitMessage("保存できない環境です")

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(await screen.findByText("最終媒体を選んでください")).toBeInTheDocument()
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
    fireEvent.change(screen.getByLabelText("メールアドレス"), { target: { value: "client@example.com" } })
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

  it("renders consultation summary form and sends the summary with contact email", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockJsonResponse({
          conversationId: "conv_summary",
          assistantMessage: {
            ...assistantMessage,
            content: "相談内容を送れます",
          },
          tier: "tier-3-ollama-deepseek",
          ui: {
            kind: "consultation-summary-form",
            summary: {
              subject: "チャットボット相談",
              customerEmail: "client@example.com",
              jobContext: {
                finalMedium: "live",
                workSite: "remote-grading",
                documentaryAttachment: { kind: "none" },
              },
              summaryText: "live-60m / live / remote-grading / 搬入〜納品未定",
              openQuestions: ["素材搬入〜納品時期未確認"],
            },
          },
        }),
      )
      .mockResolvedValueOnce(mockJsonResponse({ ok: true }))
    vi.stubGlobal("fetch", fetchMock)

    render(<WidgetShell onMinimize={vi.fn()} />)
    submitMessage("まだ日程が固まりません")

    expect(await screen.findByRole("button", { name: "相談内容を送信" })).toBeInTheDocument()
    expect(screen.getByLabelText("相談サマリ")).toHaveTextContent("live-60m")
    expect(screen.getByLabelText("メールアドレス")).toHaveValue("client@example.com")
    fireEvent.click(within(screen.getByLabelText("問い合わせフォーム")).getByRole("button", { name: "相談内容を送信" }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(fetchMock.mock.calls[1][0]).toBe("/api/chatbot/submit-inquiry")
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
      email: "client@example.com",
      freeText: expect.stringContaining("live-60m / live / remote-grading / 搬入〜納品未定"),
      conversationId: "conv_summary",
    })
  })

  it("retries a transient message failure before showing the response", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(
        mockJsonResponse({
          conversationId: "conv_1",
          assistantMessage,
          tier: "tier-3-ollama-deepseek",
          ui: { kind: "none" },
        }),
      )
    vi.stubGlobal("fetch", fetchMock)

    render(<WidgetShell onMinimize={vi.fn()} />)
    submitMessage("一時失敗から復旧する相談です")

    expect(await screen.findByText("最終媒体を選んでください")).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(screen.queryByText(/通信に失敗しました/u)).not.toBeInTheDocument()
  })

  it("falls back to the inquiry form when message retries are exhausted", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        mockJsonResponse(
          {
            error: "chatbot_operation_failed",
            failure: {
              stage: "server-handler",
              retryable: true,
              fallback: "tier4-inquiry-form",
            },
          },
          500,
        ),
      )
    vi.stubGlobal("fetch", fetchMock)

    render(<WidgetShell onMinimize={vi.fn()} />)
    submitMessage()

    expect(await screen.findByText(/通信に失敗しました/u)).toBeInTheDocument()
    expect(screen.getByLabelText("問い合わせフォーム")).toBeInTheDocument()
    expect(screen.getByText("相談したいです")).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("edits a sent user message, truncates later local UI, and persists the edited conversation", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockJsonResponse({
          conversationId: "conv_1",
          userMessage: {
            id: "user_original",
            role: "user",
            content: "初回相談です",
            createdAt: "2026-05-26T00:00:00.000Z",
          },
          assistantMessage,
          tier: "tier-3-ollama-deepseek",
          ui: { kind: "choice-panel", choiceSet: finalMediumChoices },
        }),
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          conversationId: "conv_1",
          userMessage: {
            id: "user_edited",
            role: "user",
            content: "編集後の相談です",
            createdAt: "2026-05-26T00:00:02.000Z",
          },
          assistantMessage: {
            ...assistantMessage,
            id: "assistant_edited",
            content: "編集後の回答です",
            createdAt: "2026-05-26T00:00:03.000Z",
          },
          tier: "tier-3-ollama-deepseek",
          ui: { kind: "none" },
        }),
      )
    vi.stubGlobal("fetch", fetchMock)

    render(<WidgetShell onMinimize={vi.fn()} />)
    submitMessage("初回相談です")

    expect(await screen.findByText("最終媒体を選んでください")).toBeInTheDocument()
    expect(screen.getByText("最終媒体を教えてください")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "メッセージを編集" }))
    fireEvent.change(screen.getByLabelText("編集内容"), { target: { value: "編集後の相談です" } })
    fireEvent.click(screen.getByRole("button", { name: "保存" }))
    expect(screen.getByText("保存すると、これより後のやり取りは削除されます。")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "OK" }))

    expect(await screen.findByText("編集後の回答です")).toBeInTheDocument()
    expect(screen.getByText("編集後の相談です")).toBeInTheDocument()
    expect(screen.queryByText("最終媒体を選んでください")).not.toBeInTheDocument()
    expect(screen.queryByText("最終媒体を教えてください")).not.toBeInTheDocument()
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
      message: "編集後の相談です",
      conversationId: "conv_1",
      editTargetMessageId: "user_original",
      clientSessionId: expect.any(String),
    })

    const stored = JSON.parse(window.localStorage.getItem(chatbotSessionStorageKey) ?? "{}")
    expect(stored.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "user_edited", role: "user", content: "編集後の相談です" }),
        expect.objectContaining({ id: "assistant_edited", role: "assistant", content: "編集後の回答です" }),
      ]),
    )
    expect(JSON.stringify(stored)).not.toContain("最終媒体を選んでください")
  })
})
