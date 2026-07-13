// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"
import { readFileSync } from "node:fs"
import React from "react"
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ChatbotWidget } from "@/components/chatbot/widget/ChatbotWidget"
import { CHATBOT_CONVERSATION_CONTENT_CLASS_NAME } from "@/components/chatbot/widget/conversationTypography"
import { FloatingLauncher } from "@/components/chatbot/widget/FloatingLauncher"
import { MinimizedBar } from "@/components/chatbot/widget/MinimizedBar"
import { WidgetShell } from "@/components/chatbot/widget/WidgetShell"
import type { WidgetUi } from "@/components/chatbot/widget/api"
import {
  hasReachedScrollTrigger,
  SCROLL_TRIGGER_DEBOUNCE_MS,
  SCROLL_TRIGGER_RATIO,
  useScrollTrigger,
} from "@/components/chatbot/widget/useScrollTrigger"
import {
  CHATBOT_WIDGET_STORAGE_KEY,
  CHATBOT_WIDGET_TTL_DAYS,
  persistWidgetState,
  readStoredWidgetState,
  sanitizeWidgetLayout,
  useWidgetState,
} from "@/components/chatbot/widget/useWidgetState"

function setScrollGeometry({ innerHeight, scrollHeight, scrollY }: {
  innerHeight: number
  scrollHeight: number
  scrollY: number
}) {
  Object.defineProperty(window, "innerHeight", { configurable: true, value: innerHeight })
  Object.defineProperty(window, "scrollY", { configurable: true, value: scrollY })
  Object.defineProperty(document.documentElement, "scrollHeight", { configurable: true, value: scrollHeight })
}

function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width })
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

const conversationContentClasses = CHATBOT_CONVERSATION_CONTENT_CLASS_NAME.split(" ")
const CHATBOT_SESSION_STORAGE_KEY = "hp-chatbot-session-v1"

function storeWidgetShellUi(activeUi: WidgetUi) {
  window.localStorage.setItem(
    CHATBOT_SESSION_STORAGE_KEY,
    JSON.stringify({
      messages: [
        {
          role: "assistant",
          content: "既存の相談応答です。",
          createdAt: "2026-05-26T00:00:00.000Z",
        },
      ],
      activeUi,
      expiresAt: "2026-06-26T00:00:00.000Z",
    }),
  )
}

const bookingCardUi = {
  kind: "booking-card",
  suggestedSlots: [
    {
      start: "2026-06-10T01:00:00.000Z",
      end: "2026-06-10T02:00:00.000Z",
      label: "6月10日 午前",
    },
  ],
  jobContext: {
    jobKind: "cm-30s",
    finalMedium: "web",
    workSite: "remote-grading",
    documentaryAttachment: { kind: "none" },
    workflowEstimate: {
      stages: [],
      totalMinDays: 1,
      totalMaxDays: 1,
      riskFlags: [],
    },
  },
} satisfies WidgetUi

async function openVisibleWidget() {
  render(<ChatbotWidget />)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
  await act(async () => {
    window.dispatchEvent(new Event("hp-chatbot:open"))
  })
}

function getWidgetAside() {
  return screen.getByRole("complementary", { name: "AI 相談窓口" })
}

function getWidgetShell() {
  const shell = document.querySelector<HTMLElement>(".chatbot-widget-shell")
  expect(shell).not.toBeNull()
  return shell!
}

function getStoredWidgetLayout() {
  return JSON.parse(window.localStorage.getItem(CHATBOT_WIDGET_STORAGE_KEY) ?? "{}")
}

function getWidgetHeaderText() {
  return screen.getAllByText("AI アシスタント")[0]
}

describe("chatbot widget shell", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_ENABLE_CHATBOT = "true"
    installLocalStorage()
    window.localStorage.clear()
    window.location.hash = ""
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-05-26T00:00:00.000Z"))
    setViewportWidth(1024)
    setScrollGeometry({ innerHeight: 800, scrollHeight: 4000, scrollY: 0 })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
    delete process.env.NEXT_PUBLIC_ENABLE_CHATBOT
    delete process.env.NEXT_PUBLIC_ENABLE_BOOKING
    window.localStorage.clear()
    window.location.hash = ""
  })

  it("keeps SSR output hidden before hydration", () => {
    const html = renderToStaticMarkup(React.createElement(ChatbotWidget))
    expect(html).toContain('aria-label="AI 相談窓口"')
    expect(html).toContain("hidden")
    expect(html).not.toContain("相談内容")
  })

  it("stays hidden after hydration until the scroll threshold is reached", async () => {
    render(<ChatbotWidget />)
    await vi.runOnlyPendingTimersAsync()

    expect(screen.queryByRole("complementary", { name: "AI 相談窓口" })).not.toBeInTheDocument()
  })

  it("shows the minimized consultation bar when viewport bottom passes 25 percent of the document", async () => {
    render(<ChatbotWidget />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    setScrollGeometry({ innerHeight: 800, scrollHeight: 4000, scrollY: 250 })
    await act(async () => {
      window.dispatchEvent(new Event("scroll"))
      await vi.advanceTimersByTimeAsync(SCROLL_TRIGGER_DEBOUNCE_MS)
    })

    expect(screen.getByRole("complementary", { name: "AI 相談窓口" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "AI 相談窓口を開く" })).toHaveAttribute("data-attention", "true")
    expect(screen.getByRole("button", { name: "AI 相談窓口を開く" })).toHaveClass("chatbot-minimized-attention")
    expect(screen.getByRole("link", { name: "公式LINEを友だち追加" })).toHaveAttribute(
      "href",
      "https://line.me/R/ti/p/%40044ucnym",
    )
    expect(screen.queryByText("のりかね映像設計室のご相談窓口")).not.toBeInTheDocument()
    expect(screen.queryByLabelText("相談内容")).not.toBeInTheDocument()
    expect(JSON.parse(window.localStorage.getItem(CHATBOT_WIDGET_STORAGE_KEY) ?? "{}")).toMatchObject({
      minimized: true,
      hasOpened: false,
      firstShownAt: "2026-05-26T00:00:00.150Z",
      lastSeenAt: "2026-05-26T00:00:00.150Z",
      expiresAt: "2026-06-25T00:00:00.150Z",
    })
  })

  it("stops minimized bar attention after the user opens it once", async () => {
    render(<ChatbotWidget />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    setScrollGeometry({ innerHeight: 800, scrollHeight: 4000, scrollY: 250 })
    await act(async () => {
      window.dispatchEvent(new Event("scroll"))
      await vi.advanceTimersByTimeAsync(SCROLL_TRIGGER_DEBOUNCE_MS)
    })
    expect(screen.getByRole("button", { name: "AI 相談窓口を開く" })).toHaveAttribute("data-attention", "true")

    await act(async () => {
      screen.getByRole("button", { name: "AI 相談窓口を開く" }).click()
    })
    expect(JSON.parse(window.localStorage.getItem(CHATBOT_WIDGET_STORAGE_KEY) ?? "{}")).toMatchObject({
      minimized: false,
      hasOpened: true,
    })

    await act(async () => {
      screen.getByRole("button", { name: "最小化" }).click()
    })
    expect(screen.getByRole("button", { name: "AI 相談窓口を開く" })).toHaveAttribute("data-attention", "false")
    expect(screen.getByRole("button", { name: "AI 相談窓口を開く" })).not.toHaveClass("chatbot-minimized-attention")
  })

  it("opens from the existing header event without requiring a scroll", async () => {
    render(<ChatbotWidget />)
    await vi.runOnlyPendingTimersAsync()

    await act(async () => {
      window.dispatchEvent(new Event("hp-chatbot:open"))
    })
    expect(screen.getByRole("complementary", { name: "AI 相談窓口" })).toBeInTheDocument()
  })

  it("keeps the chatbot enabled when the public chatbot flag is unset", async () => {
    delete process.env.NEXT_PUBLIC_ENABLE_CHATBOT
    render(<ChatbotWidget />)
    await vi.runOnlyPendingTimersAsync()

    await act(async () => {
      window.dispatchEvent(new Event("hp-chatbot:open"))
    })

    expect(screen.getByRole("complementary", { name: "AI 相談窓口" })).toBeInTheDocument()
  })

  it("opens from the legacy contact hash after hydration", async () => {
    window.location.hash = "#contact"
    render(<ChatbotWidget />)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(screen.getByRole("complementary", { name: "AI 相談窓口" })).toBeInTheDocument()
  })

  it("opens when the hash later changes to the legacy contact anchor", async () => {
    render(<ChatbotWidget />)
    await vi.runOnlyPendingTimersAsync()
    expect(screen.queryByRole("complementary", { name: "AI 相談窓口" })).not.toBeInTheDocument()

    await act(async () => {
      window.location.hash = "#contact"
      window.dispatchEvent(new HashChangeEvent("hashchange"))
    })

    expect(screen.getByRole("complementary", { name: "AI 相談窓口" })).toBeInTheDocument()
  })

  it("uses mobile full-screen instead of side-peek and restores normal floating display", async () => {
    setViewportWidth(390)
    render(<ChatbotWidget />)
    await vi.runOnlyPendingTimersAsync()

    await act(async () => {
      window.dispatchEvent(new Event("hp-chatbot:open"))
    })

    expect(screen.getByRole("button", { name: "全画面表示に切り替え" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "サイドピーク表示に切り替え" })).not.toBeInTheDocument()

    await act(async () => {
      screen.getByRole("button", { name: "全画面表示に切り替え" }).click()
    })

    expect(document.body).toHaveClass("chatbot-mobile-fullscreen-active")
    expect(screen.getByRole("button", { name: "通常表示に戻す" })).toBeInTheDocument()
    expect(JSON.parse(window.localStorage.getItem(CHATBOT_WIDGET_STORAGE_KEY) ?? "{}")).toMatchObject({
      minimized: false,
      displayMode: "full-screen",
    })

    await act(async () => {
      screen.getByRole("button", { name: "通常表示に戻す" }).click()
    })

    expect(document.body).not.toHaveClass("chatbot-mobile-fullscreen-active")
    expect(screen.getByRole("button", { name: "全画面表示に切り替え" })).toBeInTheDocument()
  })

  it("toggles desktop floating and side-peek display in both directions", async () => {
    setViewportWidth(1024)
    render(<ChatbotWidget />)
    await vi.runOnlyPendingTimersAsync()

    await act(async () => {
      window.dispatchEvent(new Event("hp-chatbot:open"))
    })

    await act(async () => {
      screen.getByRole("button", { name: "サイドピーク表示に切り替え" }).click()
    })

    expect(document.body).toHaveClass("chatbot-side-peek-active")
    expect(screen.getByRole("button", { name: "フローティング表示に切り替え" })).toBeInTheDocument()
    expect(JSON.parse(window.localStorage.getItem(CHATBOT_WIDGET_STORAGE_KEY) ?? "{}")).toMatchObject({
      minimized: false,
      displayMode: "side-peek",
    })

    await act(async () => {
      screen.getByRole("button", { name: "フローティング表示に切り替え" }).click()
    })

    expect(document.body).not.toHaveClass("chatbot-side-peek-active")
    expect(screen.getByRole("button", { name: "サイドピーク表示に切り替え" })).toBeInTheDocument()
    expect(JSON.parse(window.localStorage.getItem(CHATBOT_WIDGET_STORAGE_KEY) ?? "{}")).toMatchObject({
      minimized: false,
      displayMode: "floating",
    })
  })

  it("ends floating drag even when shell pointer events stop bubbling", async () => {
    setViewportWidth(1024)
    await openVisibleWidget()

    const aside = getWidgetAside()
    const shell = getWidgetShell()
    const headerText = getWidgetHeaderText()
    const startLeft = Number.parseFloat(aside.style.left)
    const startTop = Number.parseFloat(aside.style.top)

    await act(async () => {
      fireEvent.pointerDown(headerText, { pointerId: 11, pointerType: "mouse", button: 0, clientX: 300, clientY: 240 })
      fireEvent.pointerMove(shell, { pointerId: 11, pointerType: "mouse", clientX: 220, clientY: 190 })
    })

    expect(Number.parseFloat(aside.style.left)).toBe(startLeft - 80)
    expect(Number.parseFloat(aside.style.top)).toBe(startTop - 50)

    await act(async () => {
      fireEvent.pointerUp(shell, { pointerId: 11, pointerType: "mouse", clientX: 220, clientY: 190 })
      fireEvent.pointerMove(shell, { pointerId: 11, pointerType: "mouse", clientX: 100, clientY: 100 })
    })

    expect(Number.parseFloat(aside.style.left)).toBe(startLeft - 80)
    expect(Number.parseFloat(aside.style.top)).toBe(startTop - 50)
    expect(getStoredWidgetLayout()).toMatchObject({
      displayMode: "floating",
      floatingPosition: { x: startLeft - 80, y: startTop - 50 },
    })
  })

  it("cleans up floating drag on pointercancel and window blur", async () => {
    setViewportWidth(1024)
    await openVisibleWidget()

    const aside = getWidgetAside()
    const shell = getWidgetShell()
    const headerText = getWidgetHeaderText()
    const startLeft = Number.parseFloat(aside.style.left)

    await act(async () => {
      fireEvent.pointerDown(headerText, { pointerId: 12, pointerType: "mouse", button: 0, clientX: 300, clientY: 240 })
      fireEvent.pointerMove(shell, { pointerId: 12, pointerType: "mouse", clientX: 250, clientY: 240 })
      fireEvent.pointerCancel(shell, { pointerId: 12, pointerType: "mouse" })
      fireEvent.pointerMove(shell, { pointerId: 12, pointerType: "mouse", clientX: 150, clientY: 240 })
    })

    expect(Number.parseFloat(aside.style.left)).toBe(startLeft - 50)

    await act(async () => {
      fireEvent.pointerDown(headerText, { pointerId: 13, pointerType: "mouse", button: 0, clientX: 250, clientY: 240 })
      fireEvent.pointerMove(shell, { pointerId: 13, pointerType: "mouse", clientX: 230, clientY: 240 })
      window.dispatchEvent(new Event("blur"))
      fireEvent.pointerMove(shell, { pointerId: 13, pointerType: "mouse", clientX: 130, clientY: 240 })
    })

    expect(Number.parseFloat(aside.style.left)).toBe(startLeft - 70)
  })

  it("uses mouseup as a drag cleanup fallback", async () => {
    setViewportWidth(1024)
    await openVisibleWidget()

    const aside = getWidgetAside()
    const shell = getWidgetShell()
    const headerText = getWidgetHeaderText()
    const startLeft = Number.parseFloat(aside.style.left)

    await act(async () => {
      fireEvent.pointerDown(headerText, { pointerId: 14, pointerType: "mouse", button: 0, clientX: 300, clientY: 240 })
      fireEvent.pointerMove(shell, { pointerId: 14, pointerType: "mouse", clientX: 260, clientY: 240 })
      fireEvent.mouseUp(window)
      fireEvent.pointerMove(shell, { pointerId: 14, pointerType: "mouse", clientX: 120, clientY: 240 })
    })

    expect(Number.parseFloat(aside.style.left)).toBe(startLeft - 40)
  })

  it("tracks side-peek resize continuously and stops after release inside the shell", async () => {
    setViewportWidth(1024)
    await openVisibleWidget()

    await act(async () => {
      screen.getByRole("button", { name: "サイドピーク表示に切り替え" }).click()
    })

    const aside = getWidgetAside()
    const shell = getWidgetShell()
    const resizeHandle = screen.getByRole("button", { name: "サイドピーク幅を変更" })

    await act(async () => {
      fireEvent.pointerDown(resizeHandle, { pointerId: 21, pointerType: "mouse", button: 0, clientX: 700, clientY: 300 })
      fireEvent.pointerMove(shell, { pointerId: 21, pointerType: "mouse", clientX: 660, clientY: 300 })
    })
    expect(Number.parseFloat(aside.style.width)).toBe(424)

    await act(async () => {
      fireEvent.pointerMove(shell, { pointerId: 21, pointerType: "mouse", clientX: 620, clientY: 300 })
    })
    expect(Number.parseFloat(aside.style.width)).toBe(464)

    await act(async () => {
      fireEvent.pointerUp(shell, { pointerId: 21, pointerType: "mouse", clientX: 620, clientY: 300 })
      fireEvent.pointerMove(shell, { pointerId: 21, pointerType: "mouse", clientX: 500, clientY: 300 })
    })

    expect(Number.parseFloat(aside.style.width)).toBe(464)
    expect(document.body).toHaveClass("chatbot-side-peek-active")
    expect(getStoredWidgetLayout()).toMatchObject({
      displayMode: "side-peek",
      sidePeekWidth: 464,
    })

    await act(async () => {
      screen.getByRole("button", { name: "フローティング表示に切り替え" }).click()
    })

    expect(document.body).not.toHaveClass("chatbot-side-peek-active")
    expect(screen.getByRole("button", { name: "サイドピーク表示に切り替え" })).toBeInTheDocument()
  })

  it("restores a minimized widget from localStorage and reopens it from the minimized bar", async () => {
    persistWidgetState(window.localStorage, true, new Date("2026-05-26T00:00:00.000Z"))
    render(<ChatbotWidget />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(screen.getByRole("button", { name: "AI 相談窓口を開く" })).toBeInTheDocument()

    await act(async () => {
      screen.getByRole("button", { name: "AI 相談窓口を開く" }).click()
    })
    expect(screen.getByLabelText("相談内容")).toBeInTheDocument()
  })

  it("renders launcher and minimized controls with the required open label", () => {
    const onOpen = vi.fn()
    const { rerender } = render(<FloatingLauncher onOpen={onOpen} />)
    screen.getByRole("button", { name: "AI 相談窓口を開く" }).click()
    expect(onOpen).toHaveBeenCalledTimes(1)

    rerender(<MinimizedBar onOpen={onOpen} />)
    expect(screen.getByRole("button", { name: "AI 相談窓口を開く" })).toBeInTheDocument()
  })

  it("renders shell a11y labels and minimize behavior", () => {
    const onMinimize = vi.fn()
    render(<WidgetShell onMinimize={onMinimize} />)

    expect(screen.getByLabelText("AI 相談窓口")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "最小化" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "送信" })).toBeInTheDocument()
    expect(screen.getByLabelText("相談内容")).toBeEnabled()

    screen.getByRole("button", { name: "最小化" }).click()
    expect(onMinimize).toHaveBeenCalledTimes(1)
  })

  it("renders desktop display and resize controls without visible move or resize glyph affordances", () => {
    const onResize = vi.fn()
    const onSideResize = vi.fn()
    const onToggle = vi.fn()
    const { rerender } = render(
      <WidgetShell
        displayMode="floating"
        isDesktopLayout
        onFloatingResizeBy={onResize}
        onMinimize={vi.fn()}
        onSidePeekResizeBy={onSideResize}
        onToggleDisplayMode={onToggle}
      />,
    )

    expect(screen.queryByRole("button", { name: "パネルを移動" })).not.toBeInTheDocument()

    const resizeControl = screen.getByRole("button", { name: "パネルを拡大・縮小" })
    expect(resizeControl.querySelector("svg")).toBeNull()
    fireEvent.keyDown(resizeControl, { key: "ArrowDown" })
    expect(onResize).toHaveBeenCalledWith(0, 16)

    screen.getByRole("button", { name: "サイドピーク表示に切り替え" }).click()
    expect(onToggle).toHaveBeenCalledTimes(1)

    rerender(
      <WidgetShell
        displayMode="side-peek"
        isDesktopLayout
        onMinimize={vi.fn()}
        onSidePeekResizeBy={onSideResize}
        onToggleDisplayMode={onToggle}
      />,
    )
    fireEvent.keyDown(screen.getByRole("button", { name: "サイドピーク幅を変更" }), { key: "ArrowLeft" })
    expect(onSideResize).toHaveBeenCalledWith(16)
    expect(screen.getByRole("button", { name: "フローティング表示に切り替え" })).toBeInTheDocument()
  })

  it("renders mobile full-screen controls without side-peek controls", () => {
    const onToggle = vi.fn()
    const { rerender } = render(<WidgetShell onMinimize={vi.fn()} onToggleDisplayMode={onToggle} />)

    screen.getByRole("button", { name: "全画面表示に切り替え" }).click()
    expect(onToggle).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole("button", { name: "サイドピーク表示に切り替え" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "サイドピーク幅を変更" })).not.toBeInTheDocument()

    rerender(<WidgetShell displayMode="full-screen" onMinimize={vi.fn()} onToggleDisplayMode={onToggle} />)
    expect(screen.getByRole("button", { name: "通常表示に戻す" })).toBeInTheDocument()
  })

  it("does not render the previous placeholder badges", () => {
    render(<WidgetShell onMinimize={vi.fn()} />)

    const removedLabels = ["カラー" + "グレーディング", "公開時期" + "から逆算", "予約まで" + "進めたい"]
    for (const label of removedLabels) {
      expect(screen.queryByText(label)).not.toBeInTheDocument()
    }
  })

  it("renders the initial assistant message", () => {
    render(<WidgetShell onMinimize={vi.fn()} />)

    expect(screen.getByText("ご相談や案件依頼はこちらです。最終媒体、公開時期、作業時期などを会話で整理します。")).toBeInTheDocument()
  })

  it("keeps sans typography scoped away from the widget chrome", () => {
    render(<WidgetShell onMinimize={vi.fn()} />)

    expect(screen.getByText("ご相談や案件依頼はこちらです。最終媒体、公開時期、作業時期などを会話で整理します。")).toHaveClass(
      ...conversationContentClasses,
    )
    for (const assistantLabel of screen.getAllByText("AI アシスタント")) {
      expect(assistantLabel).not.toHaveClass(...conversationContentClasses)
    }
    expect(screen.getByText("のりかね映像設計室のご相談窓口")).not.toHaveClass(...conversationContentClasses)
  })

  it("renders the security note inside the shell", () => {
    render(<WidgetShell onMinimize={vi.fn()} />)

    expect(screen.getByRole("button", { name: "安全に扱います" })).toBeInTheDocument()
  })

  it("renders chatbot booking cards even when the public booking entrypoint is disabled", async () => {
    delete process.env.NEXT_PUBLIC_ENABLE_BOOKING
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ candidates: [], busyDateKeys: [] }),
    }))
    storeWidgetShellUi(bookingCardUi)

    render(<WidgetShell onMinimize={vi.fn()} />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(screen.getByText("既存の相談応答です。")).toBeInTheDocument()
    expect(screen.getByLabelText("相談内容")).toBeEnabled()
    expect(screen.getByLabelText("チャット内予約")).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "候補日時から予約する" })).toBeInTheDocument()
  })

  it("renders the booking card from the same stored UI when booking is enabled", async () => {
    process.env.NEXT_PUBLIC_ENABLE_BOOKING = "true"
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ candidates: [], busyDateKeys: [] }),
    }))
    storeWidgetShellUi(bookingCardUi)

    render(<WidgetShell onMinimize={vi.fn()} />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(screen.getByText("既存の相談応答です。")).toBeInTheDocument()
    expect(screen.getByLabelText("チャット内予約")).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "候補日時から予約する" })).toBeInTheDocument()
  })
})

describe("chatbot widget hooks", () => {
  beforeEach(() => {
    installLocalStorage()
    window.localStorage.clear()
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-05-26T00:00:00.000Z"))
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
    window.localStorage.clear()
  })

  it("uses a 25 percent document-depth scroll trigger ratio", () => {
    setScrollGeometry({ innerHeight: 800, scrollHeight: 4000, scrollY: 199 })
    expect(SCROLL_TRIGGER_RATIO).toBe(0.25)
    expect(hasReachedScrollTrigger(window, document)).toBe(false)

    setScrollGeometry({ innerHeight: 800, scrollHeight: 4000, scrollY: 200 })
    expect(hasReachedScrollTrigger(window, document)).toBe(true)
  })

  it("debounces scroll listener notifications and cleans up listeners", async () => {
    setScrollGeometry({ innerHeight: 800, scrollHeight: 4000, scrollY: 0 })
    const onTriggered = vi.fn()
    const { unmount } = renderHook(() => useScrollTrigger({ onTriggered }))

    setScrollGeometry({ innerHeight: 800, scrollHeight: 4000, scrollY: 250 })
    window.dispatchEvent(new Event("scroll"))
    expect(onTriggered).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(SCROLL_TRIGGER_DEBOUNCE_MS)
    expect(onTriggered).toHaveBeenCalledTimes(1)

    unmount()
    window.dispatchEvent(new Event("scroll"))
    await vi.advanceTimersByTimeAsync(SCROLL_TRIGGER_DEBOUNCE_MS)
    expect(onTriggered).toHaveBeenCalledTimes(1)
  })

  it("persists localStorage state with a 30 day TTL", () => {
    const storedState = persistWidgetState(window.localStorage, true, new Date("2026-05-26T00:00:00.000Z"))

    expect(storedState.expiresAt).toBe("2026-06-25T00:00:00.000Z")
    expect(CHATBOT_WIDGET_TTL_DAYS).toBe(30)
    expect(readStoredWidgetState(window.localStorage, new Date("2026-06-24T23:59:59.000Z"))).toMatchObject({
      minimized: true,
    })
  })

  it("extends persisted state with layout while preserving old stored state compatibility", () => {
    const storedState = persistWidgetState(
      window.localStorage,
      false,
      new Date("2026-05-26T00:00:00.000Z"),
      undefined,
      {
        displayMode: "side-peek",
        floatingSize: { width: 520, height: 620 },
        floatingPosition: { x: 40, y: 50 },
        sidePeekWidth: 460,
      },
    )

    expect(storedState).toMatchObject({
      minimized: false,
      hasOpened: true,
      displayMode: "side-peek",
      floatingSize: { width: 520, height: 620 },
      floatingPosition: { x: 40, y: 50 },
      sidePeekWidth: 460,
    })

    window.localStorage.setItem(
      CHATBOT_WIDGET_STORAGE_KEY,
      JSON.stringify({
        minimized: true,
        firstShownAt: "2026-05-26T00:00:00.000Z",
        lastSeenAt: "2026-05-26T00:00:00.000Z",
        expiresAt: "2026-06-25T00:00:00.000Z",
      }),
    )

    expect(readStoredWidgetState(window.localStorage, new Date("2026-05-27T00:00:00.000Z"))).toMatchObject({
      minimized: true,
      hasOpened: true,
    })
  })

  it("keeps reduced motion users out of minimized attention animation", () => {
    const css = readFileSync("src/app/globals.css", "utf8")

    expect(css).toContain(".chatbot-minimized-attention")
    expect(css).toContain("@media (prefers-reduced-motion: reduce)")
    expect(css).toMatch(/\.chatbot-minimized-attention,[\s\S]*?animation: none;/)
  })

  it("keeps minimized attention bouncing until the first open", () => {
    const css = readFileSync("src/app/globals.css", "utf8")

    expect(css).toMatch(/chatbot-minimized-pop 420ms cubic-bezier\(0\.2, 0\.9, 0\.2, 1\.2\) both/)
    expect(css).toMatch(/chatbot-minimized-bounce 3\.2s ease-in-out 900ms infinite/)
    expect(css).not.toMatch(/chatbot-minimized-bounce 3\.2s ease-in-out 900ms 3\b/)
  })

  it("clamps invalid restored layout values to the desktop viewport", () => {
    expect(
      sanitizeWidgetLayout(
        {
          displayMode: "side-peek",
          floatingSize: { width: 9999, height: 10 },
          floatingPosition: { x: 9999, y: -50 },
          sidePeekWidth: Number.NaN,
        },
        { width: 1200, height: 900 },
      ),
    ).toMatchObject({
      displayMode: "side-peek",
      floatingSize: { width: 1080, height: 400 },
      floatingPosition: { x: 120, y: 0 },
      sidePeekWidth: 384,
    })
  })

  it("preserves display mode when another layout update lands before rerender", async () => {
    const { result } = renderHook(() => useWidgetState())

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    await act(async () => {
      result.current.open()
    })

    await act(async () => {
      result.current.setDisplayMode("side-peek")
      result.current.setFloatingPosition({ x: 24, y: 40 })
      result.current.setFloatingSize({ width: 520 })
    })

    expect(result.current.layout).toMatchObject({
      displayMode: "side-peek",
      floatingPosition: { x: 24, y: 40 },
      floatingSize: { width: 520 },
    })
    expect(JSON.parse(window.localStorage.getItem(CHATBOT_WIDGET_STORAGE_KEY) ?? "{}")).toMatchObject({
      minimized: false,
      displayMode: "side-peek",
      floatingPosition: { x: 24, y: 40 },
      floatingSize: { width: 520 },
    })
  })

  it("preserves a restored mobile full-screen layout mode", () => {
    expect(
      sanitizeWidgetLayout(
        {
          displayMode: "full-screen",
          floatingSize: { width: 360, height: 520 },
          floatingPosition: { x: 12, y: 24 },
          sidePeekWidth: 384,
        },
        { width: 390, height: 844 },
      ),
    ).toMatchObject({
      displayMode: "full-screen",
      floatingSize: { width: 351, height: 520 },
      floatingPosition: { x: 12, y: 24 },
      sidePeekWidth: 351,
    })
  })

  it("resets expired or malformed localStorage state", () => {
    persistWidgetState(window.localStorage, true, new Date("2026-05-26T00:00:00.000Z"))
    expect(readStoredWidgetState(window.localStorage, new Date("2026-06-26T00:00:00.000Z"))).toBeNull()
    expect(window.localStorage.getItem(CHATBOT_WIDGET_STORAGE_KEY)).toBeNull()

    window.localStorage.setItem(CHATBOT_WIDGET_STORAGE_KEY, "{")
    expect(readStoredWidgetState(window.localStorage, new Date("2026-05-26T00:00:00.000Z"))).toBeNull()
    expect(window.localStorage.getItem(CHATBOT_WIDGET_STORAGE_KEY)).toBeNull()
  })
})
