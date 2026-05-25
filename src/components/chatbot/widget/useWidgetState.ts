"use client"

import { useCallback, useEffect, useState } from "react"

export const CHATBOT_WIDGET_STORAGE_KEY = "chatbot-widget-state"
export const CHATBOT_WIDGET_TTL_DAYS = 30

export type StoredWidgetState = {
  minimized: boolean
  firstShownAt: string
  lastSeenAt: string
  expiresAt: string
}

type WidgetState = {
  hasHydrated: boolean
  isVisible: boolean
  isMinimized: boolean
  showInitial: () => void
  open: () => void
  minimize: () => void
}

function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

function createStoredState(minimized: boolean, now: Date, firstShownAt = now): StoredWidgetState {
  return {
    minimized,
    firstShownAt: firstShownAt.toISOString(),
    lastSeenAt: now.toISOString(),
    expiresAt: addDays(firstShownAt, CHATBOT_WIDGET_TTL_DAYS).toISOString(),
  }
}

export function readStoredWidgetState(storage: Storage, now: Date): StoredWidgetState | null {
  const raw = storage.getItem(CHATBOT_WIDGET_STORAGE_KEY)
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as Partial<StoredWidgetState>
    if (!parsed.firstShownAt || !parsed.lastSeenAt || !parsed.expiresAt || typeof parsed.minimized !== "boolean") {
      storage.removeItem(CHATBOT_WIDGET_STORAGE_KEY)
      return null
    }

    if (now.getTime() > new Date(parsed.expiresAt).getTime()) {
      storage.removeItem(CHATBOT_WIDGET_STORAGE_KEY)
      return null
    }

    return parsed as StoredWidgetState
  } catch {
    storage.removeItem(CHATBOT_WIDGET_STORAGE_KEY)
    return null
  }
}

export function persistWidgetState(storage: Storage, minimized: boolean, now: Date, firstShownAt?: Date) {
  const storedState = createStoredState(minimized, now, firstShownAt)
  storage.setItem(CHATBOT_WIDGET_STORAGE_KEY, JSON.stringify(storedState))
  return storedState
}

export function useWidgetState(): WidgetState {
  const [hasHydrated, setHasHydrated] = useState(false)
  const [isVisible, setIsVisible] = useState(false)
  const [isMinimized, setIsMinimized] = useState(false)
  const [firstShownAt, setFirstShownAt] = useState<Date | null>(null)

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      const now = new Date(Date.now())
      const storedState = readStoredWidgetState(window.localStorage, now)
      if (storedState) {
        setFirstShownAt(new Date(storedState.firstShownAt))
        setIsVisible(true)
        setIsMinimized(storedState.minimized)
      }
      setHasHydrated(true)
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [])

  const writeState = useCallback((minimized: boolean, initialShownAt?: Date) => {
    const now = new Date(Date.now())
    const nextFirstShownAt = initialShownAt ?? firstShownAt ?? now
    persistWidgetState(window.localStorage, minimized, now, nextFirstShownAt)
    setFirstShownAt(nextFirstShownAt)
    setIsVisible(true)
    setIsMinimized(minimized)
  }, [firstShownAt])

  const showInitial = useCallback(() => {
    if (isVisible) return
    writeState(false, new Date(Date.now()))
  }, [isVisible, writeState])

  const open = useCallback(() => {
    writeState(false)
  }, [writeState])

  const minimize = useCallback(() => {
    writeState(true)
  }, [writeState])

  return {
    hasHydrated,
    isVisible,
    isMinimized,
    showInitial,
    open,
    minimize,
  }
}
