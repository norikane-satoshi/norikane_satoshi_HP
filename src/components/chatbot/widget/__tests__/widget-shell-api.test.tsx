// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"
import { readFileSync } from "node:fs"
import { act, cleanup, createEvent, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
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

function touchPoint(identifier: number, clientX: number, clientY: number) {
  return { identifier, clientX, clientY, target: window } as unknown as Touch
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
  customerDisplayName?: string
  lastResponseTier?: string
  pendingRequest?: unknown
  recoverableRequest?: unknown
}) {
  window.localStorage.setItem(
    chatbotSessionStorageKey,
    JSON.stringify({
      messages: session.messages,
      clientSessionId: session.clientSessionId,
      conversationId: session.conversationId,
      activeUi: session.activeUi ?? { kind: "none" },
      customerDisplayName: session.customerDisplayName,
      lastResponseTier: session.lastResponseTier,
      pendingRequest: session.pendingRequest,
      recoverableRequest: session.recoverableRequest,
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

async function flushScrollIndicatorFrame() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(20)
  })
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
    delete process.env.NEXT_PUBLIC_ENABLE_BOOKING
  })

  it("does not render tier or model debug text on production-like locations", async () => {
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
    expect(await screen.findByText("最終媒体を選んでください")).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent(/Local debug|Notion AI|DeepSeek|Ollama|local deterministic|Tier|\bmodel\b/i)
  })

  it("keeps panel wheel, touch, and pointer operations inside the chatbot shell", () => {
    const onPointerDown = vi.fn()
    const onPointerMove = vi.fn()
    const onTouchMove = vi.fn()
    const onWheel = vi.fn()

    render(
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onTouchMove={onTouchMove}
        onWheel={onWheel}
      >
        <WidgetShell onMinimize={vi.fn()} />
      </div>,
    )

    const shell = screen.getByLabelText("AI 相談窓口")
    const conversation = screen.getByLabelText("チャット本文")

    fireEvent.pointerDown(shell, { pointerId: 1, pointerType: "mouse", button: 0 })
    fireEvent.pointerMove(shell, { pointerId: 1, pointerType: "mouse", clientX: 20, clientY: 20 })
    Object.defineProperty(conversation, "clientHeight", { configurable: true, value: 300 })
    Object.defineProperty(conversation, "scrollHeight", { configurable: true, value: 900 })
    conversation.scrollTop = 600

    fireEvent.touchStart(conversation, {
      touches: [touchPoint(1, 120, 180)],
      changedTouches: [touchPoint(1, 120, 180)],
    })
    const boundaryTouchMove = createEvent.touchMove(conversation, {
      touches: [touchPoint(1, 120, 160)],
      changedTouches: [touchPoint(1, 120, 160)],
    })
    const preventBoundaryTouchDefault = vi.spyOn(boundaryTouchMove, "preventDefault")
    fireEvent(conversation, boundaryTouchMove)
    expect(preventBoundaryTouchDefault).toHaveBeenCalled()

    const boundaryWheel = createEvent.wheel(conversation, { deltaY: 120, cancelable: true })
    const preventBoundaryWheelDefault = vi.spyOn(boundaryWheel, "preventDefault")
    fireEvent(conversation, boundaryWheel)
    expect(preventBoundaryWheelDefault).toHaveBeenCalled()

    expect(onPointerDown).not.toHaveBeenCalled()
    expect(onPointerMove).not.toHaveBeenCalled()
    expect(onTouchMove).not.toHaveBeenCalled()
    expect(onWheel).not.toHaveBeenCalled()
  })

  it("keeps chatbot conversation native scroll available inside the shell", () => {
    render(<WidgetShell onMinimize={vi.fn()} />)

    const conversation = screen.getByLabelText("チャット本文")
    Object.defineProperty(conversation, "clientHeight", { configurable: true, value: 300 })
    Object.defineProperty(conversation, "scrollHeight", { configurable: true, value: 900 })
    conversation.scrollTop = 100

    fireEvent.touchStart(conversation, {
      touches: [touchPoint(1, 120, 180)],
      changedTouches: [touchPoint(1, 120, 180)],
    })
    const innerTouchMove = createEvent.touchMove(conversation, {
      touches: [touchPoint(1, 120, 120)],
      changedTouches: [touchPoint(1, 120, 120)],
    })
    const preventInnerTouchDefault = vi.spyOn(innerTouchMove, "preventDefault")
    fireEvent(conversation, innerTouchMove)
    expect(preventInnerTouchDefault).not.toHaveBeenCalled()
    expect(conversation.scrollTop).toBe(100)

    const innerWheel = createEvent.wheel(conversation, { deltaY: 120, cancelable: true })
    const preventInnerWheelDefault = vi.spyOn(innerWheel, "preventDefault")
    fireEvent(conversation, innerWheel)
    expect(preventInnerWheelDefault).not.toHaveBeenCalled()
    expect(conversation.scrollTop).toBe(100)
  })

  it("does not trap wheel events on a scrollable booking supplemental textarea", () => {
    writeStoredWidgetSession({
      conversationId: "conv_booking",
      messages: [{ id: "assistant_booking", role: "assistant", content: "候補日時から予約できます", createdAt: "2026-05-26T00:00:00.000Z" }],
      activeUi: {
        kind: "booking-card",
        suggestedSlots: [
          {
            start: "2026-07-10T01:00:00.000Z",
            end: "2026-07-10T02:00:00.000Z",
            label: "7月10日 午前",
          },
        ],
        jobContext: {
          finalMedium: "web",
          workSite: "remote-grading",
          documentaryAttachment: { kind: "none" },
          workflowEstimate: { stages: [], totalMinDays: 2, totalMaxDays: 3, riskFlags: [] },
        },
        bookingPrefill: {
          projectTitle: "ライブ案件",
          contactEmail: "client@example.jp",
          memo: "補足メモ\n".repeat(30),
        },
      },
    })
    render(<WidgetShell onMinimize={vi.fn()} />)

    const conversation = setConversationScrollGeometry({ scrollTop: 900, clientHeight: 300, scrollHeight: 1200 })
    const memo = screen.getByLabelText("補足")
    Object.defineProperty(memo, "clientHeight", { configurable: true, value: 120 })
    Object.defineProperty(memo, "scrollHeight", { configurable: true, value: 520 })
    memo.scrollTop = 20
    memo.style.overflowY = "auto"

    const innerWheel = createEvent.wheel(memo, { deltaY: 120, cancelable: true })
    const preventInnerWheelDefault = vi.spyOn(innerWheel, "preventDefault")
    fireEvent(memo, innerWheel)

    expect(preventInnerWheelDefault).not.toHaveBeenCalled()
    expect(conversation.scrollTop).toBe(900)
  })

  it("marks chatbot conversation scrolling for mobile momentum", () => {
    render(<WidgetShell onMinimize={vi.fn()} />)

    const conversation = screen.getByLabelText("チャット本文")
    expect(conversation).toHaveClass("chatbot-conversation-scroll")
    expect(conversation).toHaveStyle({
      overscrollBehaviorY: "contain",
      touchAction: "pan-y",
    })
  })

  it("hides the native conversation scrollbar while keeping native scrolling", () => {
    const css = readFileSync("src/app/globals.css", "utf8")
    render(<WidgetShell onMinimize={vi.fn()} />)

    const conversation = screen.getByLabelText("チャット本文")
    expect(conversation).toHaveClass("chatbot-conversation-scroll")
    expect(conversation).toHaveClass("overflow-y-auto")
    expect(css).toMatch(/\.chatbot-conversation-scroll\s*{[\s\S]*?scrollbar-width:\s*none;/)
    expect(css).toMatch(/\.chatbot-conversation-scroll::-webkit-scrollbar\s*{[\s\S]*?display:\s*none;/)
    expect(css).toMatch(/\.chatbot-scroll-indicator__thumb\s*{[\s\S]*?touch-action:\s*none;/)
  })

  it("shows a right-side scroll indicator while the mobile conversation scrolls", async () => {
    vi.useFakeTimers()
    render(<WidgetShell onMinimize={vi.fn()} />)

    const conversation = setConversationScrollGeometry({ scrollTop: 100, clientHeight: 400, scrollHeight: 1200 })
    fireEvent.scroll(conversation)
    await flushScrollIndicatorFrame()

    const indicator = screen.getByTestId("chatbot-scroll-indicator")
    const thumb = screen.getByTestId("chatbot-scroll-indicator-thumb")
    expect(indicator).toHaveAttribute("data-scrolling", "true")
    expect(indicator).toHaveStyle({
      pointerEvents: "auto",
      top: "12px",
      height: "376px",
      width: "16px",
    })
    expect(thumb).toHaveStyle({ height: "125px" })

    const initialThumbTop = Number.parseFloat(thumb.style.top)
    conversation.scrollTop = 600
    fireEvent.scroll(conversation)
    await flushScrollIndicatorFrame()
    expect(Number.parseFloat(thumb.style.top)).toBeGreaterThan(initialThumbTop)

    Object.defineProperty(conversation, "scrollHeight", { configurable: true, value: 2000 })
    fireEvent.scroll(conversation)
    await flushScrollIndicatorFrame()
    expect(Number.parseFloat(thumb.style.height)).toBeLessThan(125)
  })

  it("drags the custom conversation scrollbar thumb with mouse input and stops after release", async () => {
    vi.useFakeTimers()
    render(<WidgetShell onMinimize={vi.fn()} />)

    const conversation = setConversationScrollGeometry({ scrollTop: 0, clientHeight: 400, scrollHeight: 1200 })
    fireEvent.scroll(conversation)
    await flushScrollIndicatorFrame()

    const indicator = screen.getByTestId("chatbot-scroll-indicator")
    const thumb = screen.getByTestId("chatbot-scroll-indicator-thumb")
    expect(indicator).toHaveStyle({ pointerEvents: "auto" })

    fireEvent.pointerDown(thumb, { pointerId: 41, pointerType: "mouse", button: 0, clientX: 10, clientY: 20 })
    fireEvent.pointerMove(window, { pointerId: 41, pointerType: "mouse", clientX: 10, clientY: 114 })
    await flushScrollIndicatorFrame()
    expect(conversation.scrollTop).toBeGreaterThan(250)
    expect(indicator).toHaveAttribute("data-dragging", "true")

    fireEvent.pointerUp(window, { pointerId: 41, pointerType: "mouse", clientX: 10, clientY: 114 })
    const releasedScrollTop = conversation.scrollTop
    fireEvent.pointerMove(window, { pointerId: 41, pointerType: "mouse", clientX: 10, clientY: 260 })
    await flushScrollIndicatorFrame()
    expect(conversation.scrollTop).toBe(releasedScrollTop)
    expect(indicator).toHaveAttribute("data-dragging", "false")
  })

  it("starts custom conversation scrollbar dragging from the expanded track hit target", async () => {
    vi.useFakeTimers()
    render(<WidgetShell onMinimize={vi.fn()} />)

    const conversation = setConversationScrollGeometry({ scrollTop: 0, clientHeight: 400, scrollHeight: 1200 })
    fireEvent.scroll(conversation)
    await flushScrollIndicatorFrame()

    const indicator = screen.getByTestId("chatbot-scroll-indicator")
    fireEvent.pointerDown(indicator, { pointerId: 44, pointerType: "mouse", button: 0, clientX: 2, clientY: 20 })
    fireEvent.pointerMove(window, { pointerId: 44, pointerType: "mouse", clientX: 2, clientY: 114 })
    await flushScrollIndicatorFrame()
    expect(conversation.scrollTop).toBeGreaterThan(250)

    fireEvent.pointerUp(window, { pointerId: 44, pointerType: "mouse", clientX: 2, clientY: 114 })
    const releasedScrollTop = conversation.scrollTop
    fireEvent.pointerMove(window, { pointerId: 44, pointerType: "mouse", clientX: 2, clientY: 260 })
    await flushScrollIndicatorFrame()
    expect(conversation.scrollTop).toBe(releasedScrollTop)
  })

  it("drags the custom conversation scrollbar thumb with touch pointer input and cleans up on cancel and blur", async () => {
    vi.useFakeTimers()
    render(<WidgetShell onMinimize={vi.fn()} />)

    const conversation = setConversationScrollGeometry({ scrollTop: 120, clientHeight: 400, scrollHeight: 1200 })
    fireEvent.scroll(conversation)
    await flushScrollIndicatorFrame()

    const thumb = screen.getByTestId("chatbot-scroll-indicator-thumb")
    fireEvent.pointerDown(thumb, { pointerId: 42, pointerType: "touch", button: 0, clientX: 10, clientY: 80 })
    fireEvent.pointerMove(window, { pointerId: 42, pointerType: "touch", clientX: 10, clientY: 150 })
    await flushScrollIndicatorFrame()
    expect(conversation.scrollTop).toBeGreaterThan(120)

    fireEvent.pointerCancel(window, { pointerId: 42, pointerType: "touch", clientX: 10, clientY: 150 })
    const canceledScrollTop = conversation.scrollTop
    fireEvent.pointerMove(window, { pointerId: 42, pointerType: "touch", clientX: 10, clientY: 260 })
    await flushScrollIndicatorFrame()
    expect(conversation.scrollTop).toBe(canceledScrollTop)

    fireEvent.pointerDown(thumb, { pointerId: 43, pointerType: "touch", button: 0, clientX: 10, clientY: 90 })
    window.dispatchEvent(new Event("blur"))
    const blurredScrollTop = conversation.scrollTop
    fireEvent.pointerMove(window, { pointerId: 43, pointerType: "touch", clientX: 10, clientY: 240 })
    await flushScrollIndicatorFrame()
    expect(conversation.scrollTop).toBe(blurredScrollTop)
  })

  it("fades the mobile scroll indicator after scrolling stops", async () => {
    vi.useFakeTimers()
    render(<WidgetShell onMinimize={vi.fn()} />)

    const conversation = setConversationScrollGeometry({ scrollTop: 120, clientHeight: 400, scrollHeight: 1200 })
    fireEvent.scroll(conversation)
    await flushScrollIndicatorFrame()
    expect(screen.getByTestId("chatbot-scroll-indicator")).toHaveAttribute("data-scrolling", "true")

    await act(async () => {
      await vi.advanceTimersByTimeAsync(700)
    })
    await flushScrollIndicatorFrame()
    expect(screen.getByTestId("chatbot-scroll-indicator")).toHaveAttribute("data-scrolling", "false")
  })

  it("keeps the desktop scroll indicator visible for twice the mobile fade delay", async () => {
    vi.useFakeTimers()
    render(<WidgetShell onMinimize={vi.fn()} isDesktopLayout />)

    const conversation = setConversationScrollGeometry({ scrollTop: 120, clientHeight: 400, scrollHeight: 1200 })
    fireEvent.scroll(conversation)
    await flushScrollIndicatorFrame()
    const indicator = screen.getByTestId("chatbot-scroll-indicator")
    expect(indicator).toHaveAttribute("data-scrolling", "true")

    await act(async () => {
      await vi.advanceTimersByTimeAsync(700)
    })
    await flushScrollIndicatorFrame()
    expect(indicator).toHaveAttribute("data-scrolling", "true")

    await act(async () => {
      await vi.advanceTimersByTimeAsync(520)
    })
    await flushScrollIndicatorFrame()
    expect(indicator).toHaveAttribute("data-scrolling", "false")
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
    expect(await screen.findByText("最終媒体を選んでください")).toBeInTheDocument()
    expect(screen.queryByText(/Local debug/)).not.toBeInTheDocument()
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

  it("does not show the default customer label for user messages", async () => {
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
    submitMessage("劇場公開作品です。")

    expect(await screen.findByText("劇場公開作品です。")).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent("お客さま")
    expect(document.body).not.toHaveTextContent("お客様")
  })

  it("uses and persists a known booking contact name for user message labels", async () => {
    const slot = {
      start: "2026-07-10T01:00:00.000Z",
      end: "2026-07-10T02:00:00.000Z",
      label: "7月10日 午前",
    }
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          mockJsonResponse({
            conversationId: "conv_1",
            assistantMessage,
            tier: "tier-3-ollama-deepseek",
            ui: {
              kind: "booking-card",
              suggestedSlots: [slot],
              jobContext: {
                finalMedium: "web",
                workSite: "remote-grading",
                documentaryAttachment: { kind: "none" },
                workflowEstimate: { stages: [], totalMinDays: 2, totalMaxDays: 3, riskFlags: [] },
              },
              bookingPrefill: {
                projectTitle: "ライブ案件",
                contactName: "田中",
                contactEmail: "client@example.jp",
              },
            },
          }),
        )
        .mockResolvedValue(mockJsonResponse({ candidates: [slot], busyDateKeys: [] })),
    )

    render(<WidgetShell onMinimize={vi.fn()} />)
    submitMessage("予約したいです")

    expect(await screen.findByText("田中")).toBeInTheDocument()
    await waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem(chatbotSessionStorageKey) ?? "{}")
      expect(stored.customerDisplayName).toBe("田中")
    })
  })

  it("switches the assistant display name only after a nearby user name question", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({
        conversationId: "conv_1",
        assistantMessage: {
          ...assistantMessage,
          content: "私はのーちゃんです。",
        },
        tier: "tier-2-hosted-chrome-notion-ai",
        ui: { kind: "none" },
      }),
    )
    vi.stubGlobal("fetch", fetchMock)

    render(<WidgetShell onMinimize={vi.fn()} />)
    expect(screen.getAllByText("AI アシスタント").length).toBeGreaterThan(0)
    submitMessage("あなたの名前は？")

    expect(await screen.findByText("私はのーちゃんです。")).toBeInTheDocument()
    expect(screen.getAllByText("のーちゃん").length).toBeGreaterThan(0)
  })

  it("keeps the assistant display name unchanged for unrelated mentions and restores valid name switches", async () => {
    writeStoredWidgetSession({
      messages: [
        {
          id: "user_1",
          role: "user",
          content: "雑談です",
          createdAt: "2026-05-26T00:00:00.000Z",
        },
        {
          id: "assistant_1",
          role: "assistant",
          content: "のーちゃんという呼び方があります。",
          createdAt: "2026-05-26T00:00:01.000Z",
        },
      ],
    })
    const firstRender = render(<WidgetShell onMinimize={vi.fn()} />)
    expect(screen.getAllByText("AI アシスタント").length).toBeGreaterThan(0)
    expect(screen.queryByText("のーちゃん")).not.toBeInTheDocument()

    firstRender.unmount()
    writeStoredWidgetSession({
      messages: [
        {
          id: "user_2",
          role: "user",
          content: "なんて呼べばいい？",
          createdAt: "2026-05-26T00:00:00.000Z",
        },
        {
          id: "assistant_2",
          role: "assistant",
          content: "のーちゃんと呼んでください。",
          createdAt: "2026-05-26T00:00:01.000Z",
        },
      ],
    })
    render(<WidgetShell onMinimize={vi.fn()} />)
    expect(screen.getAllByText("のーちゃん").length).toBeGreaterThan(0)
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

  it("resends a pending mobile request after the widget remounts mid-response", async () => {
    let firstSignal: AbortSignal | undefined
    let resolveRecoveredFetch: (response: ReturnType<typeof mockJsonResponse>) => void = () => undefined
    const fetchMock = vi
      .fn()
      .mockImplementationOnce((_input: RequestInfo | URL, init?: RequestInit) => {
        firstSignal = init?.signal ?? undefined
        return new Promise<ReturnType<typeof mockJsonResponse>>(() => undefined)
      })
      .mockImplementationOnce(
        () =>
          new Promise<ReturnType<typeof mockJsonResponse>>((resolve) => {
            resolveRecoveredFetch = resolve
          }),
      )
    vi.stubGlobal("fetch", fetchMock)

    const firstRender = render(<WidgetShell onMinimize={vi.fn()} displayMode="full-screen" />)
    submitMessage("モバイル復元の相談です")

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const storedBeforeRemount = JSON.parse(window.localStorage.getItem(chatbotSessionStorageKey) ?? "{}")
    expect(storedBeforeRemount.pendingRequest).toMatchObject({
      kind: "message",
      message: "モバイル復元の相談です",
      clientUserMessageId: expect.stringMatching(/^client_msg_/),
    })

    firstRender.unmount()
    expect(firstSignal?.aborted).toBe(true)

    render(<WidgetShell onMinimize={vi.fn()} displayMode="full-screen" />)

    expect(await screen.findByText("考え中")).toBeInTheDocument()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const recoveredBody = JSON.parse(fetchMock.mock.calls[1][1].body)
    expect(recoveredBody).toMatchObject({
      message: "モバイル復元の相談です",
      clientSessionId: expect.any(String),
      recoverClientUserMessageId: storedBeforeRemount.pendingRequest.clientUserMessageId,
      pendingRequestKind: "message",
    })
    expect(recoveredBody.clientUserMessageId).toMatch(/^client_msg_/)
    expect(recoveredBody.clientUserMessageId).not.toBe(storedBeforeRemount.pendingRequest.clientUserMessageId)
    resolveRecoveredFetch(
      mockJsonResponse({
        conversationId: "conv_recovered",
        userMessage: {
          id: "user_recovered",
          role: "user",
          content: "モバイル復元の相談です",
          createdAt: "2026-05-26T00:00:00.000Z",
        },
        assistantMessage: {
          id: "assistant_recovered",
          role: "assistant",
          content: "復元後の回答です",
          createdAt: "2026-05-26T00:00:01.000Z",
        },
        tier: "tier-3-ollama-deepseek",
        ui: { kind: "choice-panel", choiceSet: finalMediumChoices },
      }),
    )
    expect(await screen.findByText("復元後の回答です")).toBeInTheDocument()
    expect(screen.getByText("最終媒体を教えてください")).toBeInTheDocument()
    await waitFor(() => {
      const storedAfterRecovery = JSON.parse(window.localStorage.getItem(chatbotSessionStorageKey) ?? "{}")
      expect(storedAfterRecovery.pendingRequest).toBeUndefined()
      expect(storedAfterRecovery.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "user_recovered", role: "user", content: "モバイル復元の相談です" }),
          expect.objectContaining({ id: "assistant_recovered", role: "assistant", content: "復元後の回答です" }),
        ]),
      )
    })
  })

  it("restores an expired pending mobile request as a retry action instead of the Tier4 form", async () => {
    const submittedAt = new Date(Date.now() - 20 * 60 * 1000).toISOString()
    const pendingRequest = {
      kind: "message",
      message: "長い入力の相談です",
      clientUserMessageId: "client_msg_11111111-1111-4111-8111-111111111111",
      submittedAt,
      conversationId: "conv_1",
    }
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({
        conversationId: "conv_1",
        userMessage: {
          id: "user_recovered",
          role: "user",
          content: "長い入力の相談です",
          createdAt: "2026-05-26T00:00:00.000Z",
        },
        assistantMessage: {
          id: "assistant_recovered",
          role: "assistant",
          content: "復旧しました",
          createdAt: "2026-05-26T00:00:01.000Z",
        },
        tier: "tier-3-gemini-flash",
        ui: { kind: "none" },
      }),
    )
    vi.stubGlobal("fetch", fetchMock)
    writeStoredWidgetSession({
      messages: [
        {
          id: pendingRequest.clientUserMessageId,
          role: "user",
          content: "長い入力の相談です",
          createdAt: submittedAt,
        },
      ],
      conversationId: "conv_1",
      activeUi: { kind: "tier4-inquiry-form" },
      pendingRequest,
    })

    render(<WidgetShell onMinimize={vi.fn()} displayMode="full-screen" />)

    expect(await screen.findByText("直前の送信が完了していません。入力内容は保持しています。")).toBeInTheDocument()
    expect(screen.queryByLabelText("問い合わせフォーム")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "再送する" }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      message: "長い入力の相談です",
      conversationId: "conv_1",
      recoverClientUserMessageId: pendingRequest.clientUserMessageId,
      pendingRequestKind: "message",
    })
    expect(await screen.findByText("復旧しました")).toBeInTheDocument()
    expect(screen.queryByLabelText("問い合わせフォーム")).not.toBeInTheDocument()
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
    const jumpButton = screen.getByRole("button", { name: "一番下へ移動" })
    expect(jumpButton).toBeInTheDocument()
    expect(jumpButton.parentElement).toBe(container.parentElement)
    expect(jumpButton).toHaveClass("bottom-4", "left-1/2", "h-11", "w-11")
    expect(jumpButton).not.toHaveClass("top-1/2")
    expect(jumpButton).not.toHaveClass("-translate-y-1/2")
    expect(jumpButton).toHaveStyle({
      background: "rgba(255, 255, 255, 0.42)",
      backdropFilter: "blur(18px) saturate(140%)",
    })
    const chevron = jumpButton.querySelector("svg")
    expect(chevron).toBeInTheDocument()
    expect(chevron).toHaveAttribute("aria-hidden", "true")
    expect(chevron).toHaveAttribute("stroke-linecap", "square")
    expect(screen.queryByText("▽")).not.toBeInTheDocument()
    expect(screen.queryByText("一番下へ移動")).not.toBeInTheDocument()
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

    fireEvent.click(jumpButton)
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
    expect(screen.queryByText(/応答が中断しました/u)).not.toBeInTheDocument()
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
    const jumpButton = screen.getByRole("button", { name: "一番下へ移動" })
    expect(jumpButton.querySelector("svg")).toBeInTheDocument()
    expect(jumpButton).not.toHaveTextContent("▽")
    expect(screen.queryByText("一番下へ移動")).not.toBeInTheDocument()
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
    process.env.NEXT_PUBLIC_ENABLE_BOOKING = "true"
    const slot = {
      start: "2026-07-10T01:00:00.000Z",
      end: "2026-07-10T02:00:00.000Z",
      label: "7月10日 午前",
    }
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
        mockJsonResponse({
          conversationId: "conv_1",
          assistantMessage: {
            ...assistantMessage,
            content: "候補日時から予約できます",
          },
          tier: "tier-3-ollama-deepseek",
          ui: {
            kind: "booking-card",
            suggestedSlots: [slot],
            jobContext: {
              finalMedium: "web",
              workSite: "remote-grading",
              documentaryAttachment: { kind: "none" },
              workflowEstimate: { stages: [], totalMinDays: 2, totalMaxDays: 3, riskFlags: [] },
            },
            bookingPrefill: {
              projectTitle: "ライブ案件",
              contactEmail: "client@example.jp",
              memo: "観客の顔ぼかし30カット以上",
            },
          },
        }),
      )
        .mockResolvedValue(mockJsonResponse({ candidates: [slot], busyDateKeys: [] })),
    )

    render(<WidgetShell onMinimize={vi.fn()} />)
    submitMessage()

    expect(await screen.findByText("候補日時から予約する")).toBeInTheDocument()
    expect(screen.getByLabelText("仮キープ候補のカレンダー選択")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "2026-07-10 選択可" })).toBeInTheDocument()
    expect(screen.getByLabelText("案件名")).toHaveValue("ライブ案件")
    expect(screen.getByLabelText("メール")).toHaveValue("client@example.jp")
    expect(screen.getByLabelText("補足")).toHaveValue("観客の顔ぼかし30カット以上\n作業場所: リモート")

    const stored = JSON.parse(window.localStorage.getItem(chatbotSessionStorageKey) ?? "{}")
    expect(stored.activeUi.bookingPrefill).toMatchObject({
      projectTitle: "ライブ案件",
      contactEmail: "client@example.jp",
      memo: "観客の顔ぼかし30カット以上",
    })
  })

  it("persists and restores the booking completion screen", async () => {
    process.env.NEXT_PUBLIC_ENABLE_BOOKING = "true"
    const slot = {
      start: "2026-07-10T01:00:00.000Z",
      end: "2026-07-10T02:00:00.000Z",
      label: "7月10日 午前",
    }
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === "/api/chatbot/message") {
        return Promise.resolve(
          mockJsonResponse({
            conversationId: "conv_1",
            assistantMessage: {
              ...assistantMessage,
              content: "候補日時から予約できます",
            },
            tier: "tier-3-ollama-deepseek",
            ui: {
              kind: "booking-card",
              suggestedSlots: [slot],
              jobContext: {
                finalMedium: "web",
                workSite: "remote-grading",
                documentaryAttachment: { kind: "none" },
                workflowEstimate: { stages: [], totalMinDays: 1, totalMaxDays: 1, riskFlags: [] },
              },
              bookingPrefill: {
                projectTitle: "ライブ案件",
                contactName: "田中",
                contactEmail: "client@example.jp",
                companyName: "株式会社サンプル",
                memo: "観客の顔ぼかし30カット以上",
              },
            },
          }),
        )
      }
      if (url === "/api/chatbot/booking-candidates") {
        return Promise.resolve(mockJsonResponse({ candidates: [slot], busyDateKeys: [] }))
      }
      if (url === "/api/chatbot/create-booking-from-chat") {
        return Promise.resolve(mockJsonResponse({ bookingGroupId: "group_1", bookingIds: ["slot_1"] }))
      }
      return Promise.resolve(mockJsonResponse({}))
    })
    vi.stubGlobal("fetch", fetchMock)

    render(<WidgetShell onMinimize={vi.fn()} />)
    submitMessage()

    expect(await screen.findByText("候補日時から予約する")).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText(/予約内容に同意します/))
    fireEvent.click(screen.getByRole("button", { name: "予約内容を送信" }))

    expect(await screen.findByLabelText("予約送信完了")).toBeInTheDocument()
    expect(screen.getByText("予約番号: group_1")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "予約内容を送信" })).not.toBeInTheDocument()

    await waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem(chatbotSessionStorageKey) ?? "{}")
      expect(stored.activeUi.completedBooking).toMatchObject({
        bookingGroupId: "group_1",
        projectTitle: "ライブ案件",
        contactName: "田中",
        contactEmail: "client@example.jp",
        companyName: "株式会社サンプル",
        memo: expect.stringContaining("観客の顔ぼかし30カット以上"),
      })
    })

    cleanup()
    render(<WidgetShell onMinimize={vi.fn()} />)
    expect(await screen.findByLabelText("予約送信完了")).toBeInTheDocument()
    expect(screen.getByText("予約番号: group_1")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "予約内容を送信" })).not.toBeInTheDocument()
  })

  it("drops restored booking completion state when an earlier message is edited into a new booking card", async () => {
    process.env.NEXT_PUBLIC_ENABLE_BOOKING = "true"
    const slot = {
      start: "2026-07-10T01:00:00.000Z",
      end: "2026-07-10T02:00:00.000Z",
      label: "7月10日 午前",
    }
    writeStoredWidgetSession({
      clientSessionId: "11111111-1111-4111-8111-111111111111",
      conversationId: "conv_1",
      messages: [
        {
          id: "user_original",
          role: "user",
          content: "良いです！",
          createdAt: "2026-05-26T00:00:00.000Z",
        },
        {
          id: "assistant_original",
          role: "assistant",
          content: "候補日を確認しました。",
          createdAt: "2026-05-26T00:00:01.000Z",
        },
      ],
      activeUi: {
        kind: "booking-card",
        suggestedSlots: [slot],
        jobContext: {
          finalMedium: "web",
          workSite: "remote-grading",
          documentaryAttachment: { kind: "none" },
          workflowEstimate: { stages: [], totalMinDays: 1, totalMaxDays: 1, riskFlags: [] },
        },
        bookingPrefill: {
          projectTitle: "旧ライブ案件",
          contactName: "田中",
          contactEmail: "client@example.jp",
        },
        completedBooking: {
          bookingGroupId: "group_old",
          bookingIds: ["slot_old"],
          scheduleLabel: "7月10日",
          projectTitle: "旧ライブ案件",
          contactName: "田中",
          contactEmail: "client@example.jp",
        },
      },
    })
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === "/api/chatbot/message") {
        return Promise.resolve(
          mockJsonResponse({
            conversationId: "conv_1",
            userMessage: {
              id: "user_edited",
              role: "user",
              content: "了解です",
              createdAt: "2026-05-26T00:00:02.000Z",
            },
            assistantMessage: {
              ...assistantMessage,
              id: "assistant_edited",
              content: "候補日を確認しました。\n下の予約カードから選択してください。",
              createdAt: "2026-05-26T00:00:03.000Z",
            },
            tier: "tier-2-hosted-chrome-notion-ai",
            ui: {
              kind: "booking-card",
              suggestedSlots: [slot],
              jobContext: {
                finalMedium: "web",
                workSite: "remote-grading",
                documentaryAttachment: { kind: "none" },
                workflowEstimate: { stages: [], totalMinDays: 1, totalMaxDays: 1, riskFlags: [] },
              },
              bookingPrefill: {
                projectTitle: "新ライブ案件",
                contactName: "田中",
                contactEmail: "client@example.jp",
              },
            },
          }),
        )
      }
      if (url === "/api/chatbot/booking-candidates") {
        return Promise.resolve(mockJsonResponse({ candidates: [slot], busyDateKeys: [] }))
      }
      return Promise.resolve(mockJsonResponse({}))
    })
    vi.stubGlobal("fetch", fetchMock)

    render(<WidgetShell onMinimize={vi.fn()} />)
    expect(await screen.findByLabelText("予約送信完了")).toBeInTheDocument()
    expect(screen.getByText("予約番号: group_old")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "メッセージを編集" }))
    fireEvent.change(screen.getByLabelText("編集内容"), { target: { value: "了解です" } })
    fireEvent.click(screen.getByRole("button", { name: "保存" }))
    fireEvent.click(screen.getByRole("button", { name: "OK" }))

    expect(await screen.findByText("候補日時から予約する")).toBeInTheDocument()
    expect(screen.getByLabelText("案件名")).toHaveValue("新ライブ案件")
    expect(screen.queryByLabelText("予約送信完了")).not.toBeInTheDocument()
    expect(screen.queryByText("予約番号: group_old")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "予約内容を送信" })).toBeInTheDocument()
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
    expect(screen.queryByText(/応答が中断しました/u)).not.toBeInTheDocument()
  })

  it("keeps an exhausted transient message failure retryable before showing the inquiry form", async () => {
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

    expect(await screen.findByText(/応答が中断しました/u)).toBeInTheDocument()
    expect(screen.getByText("直前の送信が完了していません。入力内容は保持しています。")).toBeInTheDocument()
    expect(screen.queryByLabelText("問い合わせフォーム")).not.toBeInTheDocument()
    expect(screen.getByText("相談したいです")).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)

    fireEvent.click(screen.getByRole("button", { name: "フォームに切り替える" }))
    expect(await screen.findByLabelText("問い合わせフォーム")).toBeInTheDocument()
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
    expect(screen.getByText("下の会話は削除されます")).toBeInTheDocument()
    expect(screen.queryByText("保存すると、これより後のやり取りは削除されます。")).not.toBeInTheDocument()
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
