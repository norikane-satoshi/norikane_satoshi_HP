"use client"

import { useEffect } from "react"

export const SCROLL_TRIGGER_RATIO = 0.25
export const SCROLL_TRIGGER_DEBOUNCE_MS = 150

type UseScrollTriggerArgs = {
  disabled?: boolean
  onTriggered: () => void
}

export function hasReachedScrollTrigger(windowRef: Pick<Window, "innerHeight" | "scrollY">, documentRef: Document) {
  const scrollHeight = documentRef.documentElement.scrollHeight
  const threshold = windowRef.innerHeight * SCROLL_TRIGGER_RATIO
  return scrollHeight > windowRef.innerHeight && windowRef.scrollY >= threshold
}

export function useScrollTrigger({ disabled = false, onTriggered }: UseScrollTriggerArgs) {
  useEffect(() => {
    if (disabled) return

    let timeoutId: number | null = null

    const check = () => {
      if (!hasReachedScrollTrigger(window, document)) return
      onTriggered()
    }

    const handleScroll = () => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId)
      }
      timeoutId = window.setTimeout(check, SCROLL_TRIGGER_DEBOUNCE_MS)
    }

    check()
    window.addEventListener("scroll", handleScroll, { passive: true })
    return () => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId)
      }
      window.removeEventListener("scroll", handleScroll)
    }
  }, [disabled, onTriggered])
}
