"use client"

import { type CSSProperties, type PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef, useState } from "react"
import { isChatbotEnabled } from "@/lib/feature-flags"
import { MinimizedBar } from "./MinimizedBar"
import { WidgetShell } from "./WidgetShell"
import { useScrollTrigger } from "./useScrollTrigger"
import {
  CHATBOT_WIDGET_DESKTOP_BREAKPOINT_PX,
  type WidgetPosition,
  type WidgetSize,
  useWidgetState,
} from "./useWidgetState"

const CHATBOT_OPEN_EVENT = "hp-chatbot:open"
const CONTACT_HASH = "#contact"

type DragState =
  | {
      kind: "move"
      startClientX: number
      startClientY: number
      startPosition: WidgetPosition
    }
  | {
      kind: "resize-floating"
      startClientX: number
      startClientY: number
      startSize: WidgetSize
    }
  | {
      kind: "resize-side-peek"
      startClientX: number
      startWidth: number
    }

export function ChatbotWidget() {
  const chatbotEnabled = isChatbotEnabled()
  const widgetState = useWidgetState()
  const { open } = widgetState
  const [isDesktopLayout, setIsDesktopLayout] = useState(false)
  const dragStateRef = useRef<DragState | null>(null)

  useEffect(() => {
    if (!chatbotEnabled) return
    const handleOpen = () => open()
    window.addEventListener(CHATBOT_OPEN_EVENT, handleOpen)
    return () => window.removeEventListener(CHATBOT_OPEN_EVENT, handleOpen)
  }, [chatbotEnabled, open])

  useEffect(() => {
    if (!chatbotEnabled) return
    const openForContactHash = () => {
      if (window.location.hash === CONTACT_HASH) open()
    }

    openForContactHash()
    window.addEventListener("hashchange", openForContactHash)
    return () => window.removeEventListener("hashchange", openForContactHash)
  }, [chatbotEnabled, open])

  useScrollTrigger({
    disabled: !chatbotEnabled || !widgetState.hasHydrated || widgetState.isVisible,
    onTriggered: widgetState.showInitial,
  })

  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      const updateDesktopState = () => setIsDesktopLayout(window.innerWidth >= CHATBOT_WIDGET_DESKTOP_BREAKPOINT_PX)
      updateDesktopState()
      window.addEventListener("resize", updateDesktopState)
      return () => window.removeEventListener("resize", updateDesktopState)
    }

    const mediaQuery = window.matchMedia(`(min-width: ${CHATBOT_WIDGET_DESKTOP_BREAKPOINT_PX}px)`)
    const updateDesktopState = () => setIsDesktopLayout(mediaQuery.matches)

    updateDesktopState()
    mediaQuery.addEventListener("change", updateDesktopState)
    return () => mediaQuery.removeEventListener("change", updateDesktopState)
  }, [])

  const resizeFloatingBy = useCallback((deltaWidth: number, deltaHeight: number) => {
    widgetState.setFloatingSize({
      width: widgetState.layout.floatingSize.width + deltaWidth,
      height: widgetState.layout.floatingSize.height + deltaHeight,
    })
  }, [widgetState])

  const resizeSidePeekBy = useCallback((deltaWidth: number) => {
    widgetState.setSidePeekWidth(widgetState.layout.sidePeekWidth + deltaWidth)
  }, [widgetState])

  const startDrag = useCallback((dragState: DragState) => {
    dragStateRef.current = dragState

    const handlePointerMove = (event: PointerEvent) => {
      const currentDragState = dragStateRef.current
      if (!currentDragState) return

      if (currentDragState.kind === "move") {
        widgetState.setFloatingPosition({
          x: currentDragState.startPosition.x + event.clientX - currentDragState.startClientX,
          y: currentDragState.startPosition.y + event.clientY - currentDragState.startClientY,
        })
        return
      }

      if (currentDragState.kind === "resize-floating") {
        widgetState.setFloatingSize({
          width: currentDragState.startSize.width + event.clientX - currentDragState.startClientX,
          height: currentDragState.startSize.height + event.clientY - currentDragState.startClientY,
        })
        return
      }

      widgetState.setSidePeekWidth(currentDragState.startWidth - (event.clientX - currentDragState.startClientX))
    }

    const handlePointerUp = () => {
      dragStateRef.current = null
      window.removeEventListener("pointermove", handlePointerMove)
      window.removeEventListener("pointerup", handlePointerUp)
      window.removeEventListener("pointercancel", handlePointerUp)
    }

    window.addEventListener("pointermove", handlePointerMove)
    window.addEventListener("pointerup", handlePointerUp)
    window.addEventListener("pointercancel", handlePointerUp)
  }, [widgetState])

  const beginFloatingMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (!isDesktopLayout || widgetState.layout.displayMode !== "floating") return
    if (event.button !== 0) return
    event.preventDefault()
    startDrag({
      kind: "move",
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPosition: widgetState.layout.floatingPosition,
    })
  }, [isDesktopLayout, startDrag, widgetState.layout.displayMode, widgetState.layout.floatingPosition])

  const beginFloatingResize = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (!isDesktopLayout || widgetState.layout.displayMode !== "floating") return
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    startDrag({
      kind: "resize-floating",
      startClientX: event.clientX,
      startClientY: event.clientY,
      startSize: widgetState.layout.floatingSize,
    })
  }, [isDesktopLayout, startDrag, widgetState.layout.displayMode, widgetState.layout.floatingSize])

  const beginSidePeekResize = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (!isDesktopLayout || widgetState.layout.displayMode !== "side-peek") return
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    startDrag({
      kind: "resize-side-peek",
      startClientX: event.clientX,
      startWidth: widgetState.layout.sidePeekWidth,
    })
  }, [isDesktopLayout, startDrag, widgetState.layout.displayMode, widgetState.layout.sidePeekWidth])

  const isReady = widgetState.hasHydrated && widgetState.isVisible
  const isSidePeekActive =
    isReady &&
    isDesktopLayout &&
    !widgetState.isMinimized &&
    widgetState.layout.displayMode === "side-peek"

  useEffect(() => {
    if (!isSidePeekActive) {
      document.body.classList.remove("chatbot-side-peek-active")
      document.body.style.removeProperty("--chatbot-side-peek-width")
      return undefined
    }

    document.body.classList.add("chatbot-side-peek-active")
    document.body.style.setProperty("--chatbot-side-peek-width", `${widgetState.layout.sidePeekWidth}px`)
    return () => {
      document.body.classList.remove("chatbot-side-peek-active")
      document.body.style.removeProperty("--chatbot-side-peek-width")
    }
  }, [isSidePeekActive, widgetState.layout.sidePeekWidth])

  if (!chatbotEnabled) return null

  const asideClassName = isSidePeekActive
    ? "pointer-events-none fixed bottom-0 right-0 top-0 z-[2147483640] flex justify-end"
    : isDesktopLayout && isReady && !widgetState.isMinimized
      ? "pointer-events-none fixed z-[2147483640] flex justify-end"
      : "pointer-events-none fixed inset-x-3 bottom-3 z-[2147483640] flex justify-end md:inset-x-auto md:bottom-8 md:right-8"

  const asideStyle: CSSProperties | undefined = isSidePeekActive
    ? { width: widgetState.layout.sidePeekWidth, height: "100dvh" }
    : isDesktopLayout && isReady && !widgetState.isMinimized
      ? {
          left: widgetState.layout.floatingPosition.x,
          top: widgetState.layout.floatingPosition.y,
          width: widgetState.layout.floatingSize.width,
          height: widgetState.layout.floatingSize.height,
        }
      : undefined

  return (
    <aside
      role="complementary"
      aria-label="AI 相談窓口"
      hidden={!isReady}
      className={asideClassName}
      style={asideStyle}
    >
      {!isReady ? null : widgetState.isMinimized ? (
        <MinimizedBar onOpen={widgetState.open} />
      ) : (
        <WidgetShell
          displayMode={widgetState.layout.displayMode}
          isDesktopLayout={isDesktopLayout}
          onFloatingResizeBy={resizeFloatingBy}
          onFloatingResizePointerDown={beginFloatingResize}
          onHeaderPointerDown={beginFloatingMove}
          onMinimize={widgetState.minimize}
          onSidePeekResizeBy={resizeSidePeekBy}
          onSidePeekResizePointerDown={beginSidePeekResize}
          onToggleDisplayMode={widgetState.toggleDisplayMode}
        />
      )}
    </aside>
  )
}
