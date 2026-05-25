"use client"

import { useEffect } from "react"
import { MinimizedBar } from "./MinimizedBar"
import { WidgetShell } from "./WidgetShell"
import { useScrollTrigger } from "./useScrollTrigger"
import { useWidgetState } from "./useWidgetState"

const CHATBOT_OPEN_EVENT = "hp-chatbot:open"

export function ChatbotWidget() {
  const widgetState = useWidgetState()
  const { open } = widgetState

  useEffect(() => {
    const handleOpen = () => open()
    window.addEventListener(CHATBOT_OPEN_EVENT, handleOpen)
    return () => window.removeEventListener(CHATBOT_OPEN_EVENT, handleOpen)
  }, [open])

  useScrollTrigger({
    disabled: !widgetState.hasHydrated || widgetState.isVisible,
    onTriggered: widgetState.showInitial,
  })

  if (!widgetState.hasHydrated) return null
  if (!widgetState.isVisible) return null

  return (
    <aside
      role="complementary"
      aria-label="AI 相談窓口"
      className="pointer-events-none fixed inset-x-3 bottom-3 z-[2147483640] flex justify-end md:inset-x-auto md:bottom-8 md:right-8"
    >
      {widgetState.isMinimized ? (
        <MinimizedBar onOpen={widgetState.open} />
      ) : (
        <WidgetShell onMinimize={widgetState.minimize} />
      )}
    </aside>
  )
}
