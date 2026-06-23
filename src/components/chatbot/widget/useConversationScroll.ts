"use client"

import { useCallback, useLayoutEffect, useRef, useState } from "react"

const bottomThresholdPx = 48

function isNearBottom(element: HTMLElement) {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= bottomThresholdPx
}

export function useConversationScroll(contentKey: string) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const hasObservedContentRef = useRef(false)
  const wasNearBottomRef = useRef(true)
  const [hasPendingLatest, setHasPendingLatest] = useState(false)

  const scrollToLatest = useCallback(() => {
    const container = containerRef.current
    if (!container) return
    container.scrollTop = container.scrollHeight
    wasNearBottomRef.current = true
    setHasPendingLatest(false)
  }, [])

  const handleScroll = useCallback(() => {
    const container = containerRef.current
    if (!container) return
    const nearBottom = isNearBottom(container)
    wasNearBottomRef.current = nearBottom
    setHasPendingLatest(!nearBottom)
  }, [])

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return

    if (!hasObservedContentRef.current) {
      hasObservedContentRef.current = true
      container.scrollTop = container.scrollHeight
      wasNearBottomRef.current = true
      return
    }

    if (wasNearBottomRef.current) {
      container.scrollTop = container.scrollHeight
      wasNearBottomRef.current = true
      return
    }

    const frameId = window.requestAnimationFrame(() => {
      setHasPendingLatest(true)
    })
    return () => window.cancelAnimationFrame(frameId)
  }, [contentKey])

  return {
    containerRef,
    handleScroll,
    hasPendingLatest,
    shouldShowLatestButton: hasPendingLatest,
    scrollToLatest,
  }
}
