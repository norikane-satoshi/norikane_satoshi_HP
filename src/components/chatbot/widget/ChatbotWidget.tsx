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

  if (!chatbotEnabled) return null
  const isReady = widgetState.hasHydrated && widgetState.isVisible

  return (
    <aside
      role="complementary"
      aria-label="AI 相談窓口"
      hidden={!isReady}
      className="pointer-events-none fixed inset-x-3 bottom-3 z-[2147483640] flex justify-end md:inset-x-auto md:bottom-8 md:right-8"
    >
      {!isReady ? null : widgetState.isMinimized ? (
        <MinimizedBar onOpen={widgetState.open} />
      ) : (
        <WidgetShell onMinimize={widgetState.minimize} />
      )}
    </aside>
  )
}
