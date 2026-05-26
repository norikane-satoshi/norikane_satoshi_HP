// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useDemoPlayback } from "@/components/chatbot/demo/useDemoPlayback"
import type { DemoScript } from "@/lib/chatbot/demo"

const script: DemoScript = {
  id: "test-script",
  title: "テスト",
  initialPoint: { xRatio: 0.1, yRatio: 0.2 },
  steps: [
    { id: "move", kind: "move", target: { xRatio: 0.2, yRatio: 0.3 }, durationMs: 100 },
    {
      id: "annotate",
      kind: "annotate",
      target: { xRatio: 0.4, yRatio: 0.5 },
      durationMs: 100,
      annotation: {
        title: "候補を見る",
        body: "候補を確認します。",
        placement: "top",
      },
    },
    { id: "complete", kind: "complete", target: { xRatio: 0.4, yRatio: 0.5 }, durationMs: 100 },
  ],
}

describe("useDemoPlayback", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    Object.defineProperty(window, "scrollTo", { value: vi.fn(), writable: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("starts and advances with timers", () => {
    const { result } = renderHook(() => useDemoPlayback(script))

    act(() => result.current.start())
    expect(result.current.playing).toBe(true)

    act(() => vi.advanceTimersByTime(100))
    expect(result.current.currentStep?.id).toBe("annotate")
    expect(result.current.annotation?.title).toBe("候補を見る")
  })

  it("resets playback to the first step", () => {
    const { result } = renderHook(() => useDemoPlayback(script))

    act(() => {
      result.current.advance()
      result.current.reset()
    })

    expect(result.current.currentStep?.id).toBe("move")
    expect(result.current.playing).toBe(false)
  })

  it("clears timers on unmount", () => {
    const { result, unmount } = renderHook(() => useDemoPlayback(script))

    act(() => result.current.start())
    expect(vi.getTimerCount()).toBe(1)

    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it("stops when advancing to complete", () => {
    const { result } = renderHook(() => useDemoPlayback(script))

    act(() => result.current.start())
    act(() => vi.advanceTimersByTime(100))
    act(() => vi.advanceTimersByTime(100))

    expect(result.current.currentStep?.kind).toBe("complete")
    expect(result.current.playing).toBe(false)
  })
})
