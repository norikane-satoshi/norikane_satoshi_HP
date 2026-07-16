"use client"

import { type CSSProperties, type PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef, useState } from "react"
import { usePathname } from "next/navigation"
import { PUBLIC_AVAILABILITY_ROUTE } from "@/lib/booking/domain/public-availability"
import { isChatbotEnabled } from "@/lib/feature-flags"
import { LineBookingBadge } from "./line-booking-badge"
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
      pointerId: number
      startClientX: number
      startClientY: number
      startPosition: WidgetPosition
    }
  | {
      kind: "resize-floating"
      pointerId: number
      startClientX: number
      startClientY: number
      startSize: WidgetSize
    }
  | {
      kind: "resize-side-peek"
      pointerId: number
      startClientX: number
      startWidth: number
    }

type DragSession = {
  cleanup: () => void
}

export function ChatbotWidget() {
  const pathname = usePathname()
  const isPublicAvailabilityPage = pathname === PUBLIC_AVAILABILITY_ROUTE
  const chatbotEnabled = isChatbotEnabled()
  const shouldRenderChatbot = chatbotEnabled && !isPublicAvailabilityPage
  const widgetState = useWidgetState()
  const { open } = widgetState
  const [isDesktopLayout, setIsDesktopLayout] = useState(false)
  const dragStateRef = useRef<DragState | null>(null)
  const dragSessionRef = useRef<DragSession | null>(null)

  useEffect(() => {
    if (!shouldRenderChatbot) return
    const handleOpen = () => open()
    window.addEventListener(CHATBOT_OPEN_EVENT, handleOpen)
    return () => window.removeEventListener(CHATBOT_OPEN_EVENT, handleOpen)
  }, [open, shouldRenderChatbot])

  useEffect(() => {
    if (!shouldRenderChatbot) return
    const openForContactHash = () => {
      if (!widgetState.hasHydrated) return
      if (window.location.hash === CONTACT_HASH) open()
    }

    openForContactHash()
    window.addEventListener("hashchange", openForContactHash)
    return () => window.removeEventListener("hashchange", openForContactHash)
  }, [open, shouldRenderChatbot, widgetState.hasHydrated])

  useScrollTrigger({
    disabled: !shouldRenderChatbot || !widgetState.hasHydrated || widgetState.isVisible,
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

  const startDrag = useCallback((dragState: DragState, captureTarget: HTMLElement) => {
    dragSessionRef.current?.cleanup()
    dragStateRef.current = dragState

    const handlePointerMove = (event: PointerEvent) => {
      const currentDragState = dragStateRef.current
      if (!currentDragState) return
      if (event.pointerId !== currentDragState.pointerId) return
      event.preventDefault()

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

    let hasCleanedUp = false
    const cleanup = () => {
      if (hasCleanedUp) return
      hasCleanedUp = true
      dragStateRef.current = null
      dragSessionRef.current = null
      window.removeEventListener("pointermove", handlePointerMove, true)
      window.removeEventListener("pointerup", handlePointerEnd, true)
      window.removeEventListener("pointercancel", handlePointerEnd, true)
      window.removeEventListener("mouseup", cleanup, true)
      document.removeEventListener("pointerup", handlePointerEnd, true)
      document.removeEventListener("pointercancel", handlePointerEnd, true)
      window.removeEventListener("blur", cleanup)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
      captureTarget.removeEventListener("pointerup", handlePointerEnd, true)
      captureTarget.removeEventListener("pointercancel", handlePointerEnd, true)
      captureTarget.removeEventListener("lostpointercapture", cleanup)
      try {
        if (captureTarget.hasPointerCapture?.(dragState.pointerId)) {
          captureTarget.releasePointerCapture(dragState.pointerId)
        }
      } catch {
        // The pointer may already have been released by the browser.
      }
    }

    const handlePointerEnd = (event: PointerEvent) => {
      if (event.pointerId !== dragState.pointerId && event.pointerType !== "mouse") return
      cleanup()
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") cleanup()
    }

    dragSessionRef.current = { cleanup }
    window.addEventListener("pointermove", handlePointerMove, true)
    window.addEventListener("pointerup", handlePointerEnd, true)
    window.addEventListener("pointercancel", handlePointerEnd, true)
    window.addEventListener("mouseup", cleanup, true)
    document.addEventListener("pointerup", handlePointerEnd, true)
    document.addEventListener("pointercancel", handlePointerEnd, true)
    window.addEventListener("blur", cleanup)
    document.addEventListener("visibilitychange", handleVisibilityChange)
    captureTarget.addEventListener("pointerup", handlePointerEnd, true)
    captureTarget.addEventListener("pointercancel", handlePointerEnd, true)
    captureTarget.addEventListener("lostpointercapture", cleanup)
    try {
      captureTarget.setPointerCapture?.(dragState.pointerId)
    } catch {
      // Capture can fail if the browser has already ended the pointer.
    }
  }, [widgetState])

  useEffect(() => {
    return () => dragSessionRef.current?.cleanup()
  }, [])

  const beginFloatingMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (!isDesktopLayout || widgetState.layout.displayMode !== "floating") return
    if (event.button !== 0) return
    event.preventDefault()
    startDrag({
      kind: "move",
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPosition: widgetState.layout.floatingPosition,
    }, event.currentTarget)
  }, [isDesktopLayout, startDrag, widgetState.layout.displayMode, widgetState.layout.floatingPosition])

  const beginFloatingResize = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (!isDesktopLayout || widgetState.layout.displayMode !== "floating") return
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    startDrag({
      kind: "resize-floating",
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startSize: widgetState.layout.floatingSize,
    }, event.currentTarget)
  }, [isDesktopLayout, startDrag, widgetState.layout.displayMode, widgetState.layout.floatingSize])

  const beginSidePeekResize = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (!isDesktopLayout || widgetState.layout.displayMode !== "side-peek") return
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    startDrag({
      kind: "resize-side-peek",
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startWidth: widgetState.layout.sidePeekWidth,
    }, event.currentTarget)
  }, [isDesktopLayout, startDrag, widgetState.layout.displayMode, widgetState.layout.sidePeekWidth])

  const isReady = widgetState.hasHydrated && widgetState.isVisible
  const effectiveDisplayMode =
    isDesktopLayout && widgetState.layout.displayMode === "full-screen"
      ? "floating"
      : !isDesktopLayout && widgetState.layout.displayMode === "side-peek"
        ? "floating"
        : widgetState.layout.displayMode
  const isSidePeekActive =
    shouldRenderChatbot &&
    isReady &&
    isDesktopLayout &&
    !widgetState.isMinimized &&
    effectiveDisplayMode === "side-peek"
  const isMobileFullScreenActive =
    shouldRenderChatbot &&
    isReady &&
    !isDesktopLayout &&
    !widgetState.isMinimized &&
    effectiveDisplayMode === "full-screen"

  const toggleResponsiveDisplayMode = useCallback(() => {
    if (isDesktopLayout) {
      widgetState.setDisplayMode(effectiveDisplayMode === "side-peek" ? "floating" : "side-peek")
      return
    }
    widgetState.setDisplayMode(effectiveDisplayMode === "full-screen" ? "floating" : "full-screen")
  }, [effectiveDisplayMode, isDesktopLayout, widgetState])

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

  useEffect(() => {
    if (!isMobileFullScreenActive) {
      document.body.classList.remove("chatbot-mobile-fullscreen-active")
      return undefined
    }

    document.body.classList.add("chatbot-mobile-fullscreen-active")
    return () => {
      document.body.classList.remove("chatbot-mobile-fullscreen-active")
    }
  }, [isMobileFullScreenActive])

  if (!shouldRenderChatbot) return null

  const asideClassName = isSidePeekActive
    ? "pointer-events-none fixed bottom-0 right-0 top-0 z-[2147483640] flex justify-end"
    : isMobileFullScreenActive
      ? "pointer-events-none fixed inset-0 z-[2147483640] flex"
    : isDesktopLayout && isReady && !widgetState.isMinimized
      ? "pointer-events-none fixed z-[2147483640] flex justify-end"
      : "pointer-events-none fixed inset-x-3 bottom-3 z-[2147483640] flex justify-end md:inset-x-auto md:bottom-8 md:right-8"

  const asideStyle: CSSProperties | undefined = isSidePeekActive
    ? { width: widgetState.layout.sidePeekWidth, height: "100dvh" }
    : isMobileFullScreenActive
      ? { width: "100vw", height: "100dvh" }
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
        <div className="flex items-center gap-2">
          <MinimizedBar onOpen={widgetState.open} shouldShowAttention={widgetState.shouldShowMinimizedAttention} />
          <LineBookingBadge />
        </div>
      ) : (
        <WidgetShell
          displayMode={effectiveDisplayMode}
          isDesktopLayout={isDesktopLayout}
          onFloatingResizeBy={resizeFloatingBy}
          onFloatingResizePointerDown={beginFloatingResize}
          onHeaderPointerDown={beginFloatingMove}
          onMinimize={widgetState.minimize}
          onSidePeekResizeBy={resizeSidePeekBy}
          onSidePeekResizePointerDown={beginSidePeekResize}
          onToggleDisplayMode={toggleResponsiveDisplayMode}
        />
      )}
    </aside>
  )
}
