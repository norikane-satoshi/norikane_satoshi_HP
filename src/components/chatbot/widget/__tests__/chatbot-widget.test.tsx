// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest"
import React from "react"
import { act, cleanup, render, renderHook, screen } from "@testing-library/react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ChatbotWidget } from "@/components/chatbot/widget/ChatbotWidget"
import { FloatingLauncher } from "@/components/chatbot/widget/FloatingLauncher"
import { MinimizedBar } from "@/components/chatbot/widget/MinimizedBar"
import { WidgetShell } from "@/components/chatbot/widget/WidgetShell"
import {
  hasReachedScrollTrigger,
  SCROLL_TRIGGER_DEBOUNCE_MS,
  SCROLL_TRIGGER_RATIO,
  useScrollTrigger,
} from "@/components/chatbot/widget/useScrollTrigger"
import {
  CHATBOT_WIDGET_MIN_HEIGHT,
  CHATBOT_WIDGET_MIN_WIDTH,
  CHATBOT_WIDGET_STORAGE_KEY,
  CHATBOT_WIDGET_TTL_DAYS,
  createDefaultWidgetLayout,
  persistWidgetState,
  readStoredWidgetState,
  sanitizeWidgetLayout,
  type WidgetLayout,
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

function renderWidgetShell({
  layout = createDefaultWidgetLayout(),
  onMinimize = vi.fn(),
  onModeChange = vi.fn(),
  onFloatingGeometryChange = vi.fn(),
  onSidePeekWidthChange = vi.fn(),
}: {
  layout?: WidgetLayout
  onMinimize?: () => void
  onModeChange?: (mode: "floating" | "side-peek") => void
  onFloatingGeometryChange?: (geometry: { position?: { x: number; y: number }; size?: { width: number; height: number } }) => void
  onSidePeekWidthChange?: (width: number) => void
} = {}) {
  return render(
    <WidgetShell
      layout={layout}
      onMinimize={onMinimize}
      onModeChange={onModeChange}
      onFloatingGeometryChange={onFloatingGeometryChange}
      onSidePeekWidthChange={onSidePeekWidthChange}
    />,
  )
}

describe("chatbot widget shell", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_ENABLE_CHATBOT = "true"
    installLocalStorage()
    window.localStorage.clear()
    window.location.hash = ""
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-05-26T00:00:00.000Z"))
    setScrollGeometry({ innerHeight: 800, scrollHeight: 4000, scrollY: 0 })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
    delete process.env.NEXT_PUBLIC_ENABLE_CHATBOT
    window.localStorage.clear()
    window.location.hash = ""
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 })
    document.documentElement.style.removeProperty("--chatbot-side-peek-occupied-width")
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

  it("opens the chat shell automatically when viewport bottom passes 25 percent of the document", async () => {
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
    expect(screen.getByText("のりかね映像設計室のご相談窓口")).toBeInTheDocument()
    expect(screen.getByLabelText("相談内容")).not.toHaveFocus()
    expect(JSON.parse(window.localStorage.getItem(CHATBOT_WIDGET_STORAGE_KEY) ?? "{}")).toMatchObject({
      minimized: false,
      firstShownAt: "2026-05-26T00:00:00.150Z",
      lastSeenAt: "2026-05-26T00:00:00.150Z",
      expiresAt: "2026-06-25T00:00:00.150Z",
    })
  })

  it("opens from the existing header event without requiring a scroll", async () => {
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
    renderWidgetShell({ onMinimize })

    expect(screen.getByLabelText("AI 相談窓口")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "最小化" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "サイドピーク表示に切り替え" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "送信" })).toBeInTheDocument()
    expect(screen.getByLabelText("相談内容")).toBeEnabled()

    screen.getByRole("button", { name: "最小化" }).click()
    expect(onMinimize).toHaveBeenCalledTimes(1)
  })

  it("wires the side-peek toggle without adding move or resize glyph controls", () => {
    const onModeChange = vi.fn()
    renderWidgetShell({ onModeChange })

    screen.getByRole("button", { name: "サイドピーク表示に切り替え" }).click()
    expect(onModeChange).toHaveBeenCalledWith("side-peek")
    expect(screen.queryByRole("button", { name: /移動|リサイズ|サイズ変更/ })).not.toBeInTheDocument()
  })

  it("publishes side-peek occupied width only for desktop side-peek mode", () => {
    const originalInnerWidth = window.innerWidth
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 })
    const sidePeekLayout = {
      ...createDefaultWidgetLayout(),
      mode: "side-peek" as const,
      sidePeekWidth: 480,
    }
    const { rerender } = renderWidgetShell({ layout: sidePeekLayout })

    expect(document.documentElement.style.getPropertyValue("--chatbot-side-peek-occupied-width")).toBe("480px")

    rerender(
      <WidgetShell
        layout={{ ...sidePeekLayout, mode: "floating" }}
        onMinimize={vi.fn()}
        onModeChange={vi.fn()}
        onFloatingGeometryChange={vi.fn()}
        onSidePeekWidthChange={vi.fn()}
      />,
    )
    expect(document.documentElement.style.getPropertyValue("--chatbot-side-peek-occupied-width")).toBe("0px")

    rerender(
      <WidgetShell
        layout={sidePeekLayout}
        onMinimize={vi.fn()}
        onModeChange={vi.fn()}
        onFloatingGeometryChange={vi.fn()}
        onSidePeekWidthChange={vi.fn()}
      />,
    )
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 767 })
    window.dispatchEvent(new Event("resize"))
    expect(document.documentElement.style.getPropertyValue("--chatbot-side-peek-occupied-width")).toBe("0px")
    Object.defineProperty(window, "innerWidth", { configurable: true, value: originalInnerWidth })
  })

  it("does not render the previous placeholder badges", () => {
    renderWidgetShell()

    const removedLabels = ["カラー" + "グレーディング", "公開時期" + "から逆算", "予約まで" + "進めたい"]
    for (const label of removedLabels) {
      expect(screen.queryByText(label)).not.toBeInTheDocument()
    }
  })

  it("renders the initial assistant message", () => {
    renderWidgetShell()

    expect(screen.getByText("ご相談や案件依頼はこちらです。最終媒体、公開時期、作業時期などを会話で整理します。")).toBeInTheDocument()
  })

  it("renders the security note inside the shell", () => {
    renderWidgetShell()

    expect(screen.getByRole("button", { name: "安全に扱います" })).toBeInTheDocument()
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
    const storedState = persistWidgetState(window.localStorage, true, new Date("2026-05-26T00:00:00.000Z"), undefined, {
      mode: "side-peek",
      floatingPosition: { x: 220, y: 120 },
      floatingSize: { width: 640, height: 520 },
      sidePeekWidth: 480,
    })

    expect(storedState.expiresAt).toBe("2026-06-25T00:00:00.000Z")
    expect(CHATBOT_WIDGET_TTL_DAYS).toBe(30)
    expect(readStoredWidgetState(window.localStorage, new Date("2026-06-24T23:59:59.000Z"))).toMatchObject({
      minimized: true,
      mode: "side-peek",
      floatingPosition: { x: 220, y: 120 },
      floatingSize: { width: 640, height: 520 },
      sidePeekWidth: 480,
    })
  })

  it("clamps malformed widget layout values to the current viewport", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1000 })
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 700 })
    const layout = sanitizeWidgetLayout({
      mode: "side-peek",
      floatingPosition: { x: -100, y: 9000 },
      floatingSize: { width: 9999, height: 20 },
      sidePeekWidth: 9999,
    })

    expect(layout.mode).toBe("side-peek")
    expect(layout.floatingSize.width).toBe(900)
    expect(layout.floatingSize.height).toBe(CHATBOT_WIDGET_MIN_HEIGHT)
    expect(layout.floatingPosition.x).toBe(32)
    expect(layout.floatingPosition.y).toBe(268)
    expect(layout.sidePeekWidth).toBe(900)
    expect(layout.floatingSize.width).toBeGreaterThanOrEqual(CHATBOT_WIDGET_MIN_WIDTH)
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
