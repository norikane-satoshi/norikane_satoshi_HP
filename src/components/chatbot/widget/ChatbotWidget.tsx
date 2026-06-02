"use client"

import { useEffect } from "react"
import { isChatbotEnabled } from "@/lib/feature-flags"
import { MinimizedBar } from "./MinimizedBar"
import { WidgetShell } from "./WidgetShell"
import { useScrollTrigger } from "./useScrollTrigger"
import { useWidgetState } from "./useWidgetState"

const CHATBOT_OPEN_EVENT = "hp-chatbot:open"
const CONTACT_HASH = "#contact"

export function ChatbotWidget() {
  const chatbotEnabled = isChatbotEnabled()
  const widgetState = useWidgetState()
  const { open } = widgetState
  const shouldOffsetPage =
    widgetState.hasHydrated &&
    widgetState.isVisible &&
    !widgetState.isMinimized &&
    widgetState.layout.mode === "side-peek"

  useEffect(() => {
    if (!chatbotEnabled) return
    const handleOpen = () => open()
    window.addEventListener(CHATBOT_OPEN_EVENT, handleOpen)
    return () => window.removeEventListener(CHATBOT_OPEN_EVENT, handleOpen)
  }, [chatbotEnabled, open])

  useEffect(() => {
    if (!chatbotEnabled) return
    const openForContactHash = () => {
      if (window.location.hash === CONTACT_HASH && !widgetState.isVisible) open()
    }

    openForContactHash()
    window.addEventListener("hashchange", openForContactHash)
    return () => window.removeEventListener("hashchange", openForContactHash)
  }, [chatbotEnabled, open, widgetState.isVisible])

  useEffect(() => {
    if (!chatbotEnabled || !shouldOffsetPage) {
      document.body.classList.remove("hp-chatbot-side-peek-open")
      document.body.style.removeProperty("--chatbot-side-peek-body-offset")
      return
    }

    document.body.style.setProperty("--chatbot-side-peek-body-offset", `${widgetState.layout.sidePeekWidth}px`)
    document.body.classList.add("hp-chatbot-side-peek-open")
    return () => {
      document.body.classList.remove("hp-chatbot-side-peek-open")
      document.body.style.removeProperty("--chatbot-side-peek-body-offset")
    }
  }, [chatbotEnabled, shouldOffsetPage, widgetState.layout.sidePeekWidth])

  useScrollTrigger({
    disabled: !chatbotEnabled || !widgetState.hasHydrated || widgetState.isVisible,
    onTriggered: widgetState.showInitial,
  })

  if (!chatbotEnabled) return null
  const isReady = widgetState.hasHydrated && widgetState.isVisible
  const asideClassName = widgetState.isMinimized
    ? "pointer-events-none fixed inset-x-3 bottom-3 z-[2147483640] flex justify-end md:inset-x-auto md:bottom-8 md:right-8"
    : "pointer-events-none fixed inset-x-3 bottom-3 z-[2147483640] flex justify-end md:inset-0 md:bottom-auto md:right-auto md:block"

  return (
    <aside
      role="complementary"
      aria-label="AI 相談窓口"
      hidden={!isReady}
      className={asideClassName}
    >
      {!isReady ? null : widgetState.isMinimized ? (
        <MinimizedBar onOpen={widgetState.open} />
      ) : (
        <WidgetShell
          layout={widgetState.layout}
          onMinimize={widgetState.minimize}
          onModeChange={widgetState.setMode}
          onFloatingGeometryChange={widgetState.setFloatingGeometry}
          onSidePeekWidthChange={widgetState.setSidePeekWidth}
        />
      )}
    </aside>
  )
}
