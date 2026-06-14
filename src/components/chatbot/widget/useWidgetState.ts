"use client"

import { useCallback, useEffect, useState } from "react"

export const CHATBOT_WIDGET_STORAGE_KEY = "chatbot-widget-state"
export const CHATBOT_WIDGET_TTL_DAYS = 30
export const CHATBOT_WIDGET_DESKTOP_BREAKPOINT_PX = 768
export const CHATBOT_WIDGET_MIN_WIDTH = 320
export const CHATBOT_WIDGET_MIN_HEIGHT = 400
export const CHATBOT_WIDGET_DEFAULT_WIDTH = 384
export const CHATBOT_WIDGET_DEFAULT_HEIGHT = 560
export const CHATBOT_WIDGET_DEFAULT_OFFSET = 32

export type WidgetDisplayMode = "floating" | "side-peek"

export type WidgetSize = {
  width: number
  height: number
}

export type WidgetPosition = {
  x: number
  y: number
}

export type WidgetLayoutState = {
  displayMode: WidgetDisplayMode
  floatingSize: WidgetSize
  floatingPosition: WidgetPosition
  sidePeekWidth: number
}

export type StoredWidgetState = {
  minimized: boolean
  firstShownAt: string
  lastSeenAt: string
  expiresAt: string
  displayMode?: WidgetDisplayMode
  floatingSize?: Partial<WidgetSize>
  floatingPosition?: Partial<WidgetPosition>
  sidePeekWidth?: number
}

type WidgetState = {
  hasHydrated: boolean
  isVisible: boolean
  isMinimized: boolean
  layout: WidgetLayoutState
  showInitial: () => void
  open: () => void
  minimize: () => void
  setDisplayMode: (displayMode: WidgetDisplayMode) => void
  toggleDisplayMode: () => void
  setFloatingSize: (size: Partial<WidgetSize>) => void
  setFloatingPosition: (position: Partial<WidgetPosition>) => void
  setSidePeekWidth: (width: number) => void
}

type ViewportSize = {
  width: number
  height: number
}

function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

function clamp(value: number, min: number, max: number) {
  if (max < min) return min
  return Math.min(Math.max(value, min), max)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function getViewportSize(): ViewportSize {
  if (typeof window === "undefined") {
    return { width: 1024, height: 768 }
  }

  return {
    width: window.innerWidth,
    height: window.innerHeight,
  }
}

function getMaxSize(viewport: ViewportSize) {
  return {
    width: Math.max(CHATBOT_WIDGET_MIN_WIDTH, Math.floor(viewport.width * 0.9)),
    height: Math.max(CHATBOT_WIDGET_MIN_HEIGHT, Math.floor(viewport.height * 0.9)),
  }
}

function defaultLayoutForViewport(viewport: ViewportSize): WidgetLayoutState {
  const maxSize = getMaxSize(viewport)
  const width = clamp(CHATBOT_WIDGET_DEFAULT_WIDTH, CHATBOT_WIDGET_MIN_WIDTH, maxSize.width)
  const height = clamp(
    Math.min(CHATBOT_WIDGET_DEFAULT_HEIGHT, viewport.height - CHATBOT_WIDGET_DEFAULT_OFFSET * 2),
    CHATBOT_WIDGET_MIN_HEIGHT,
    maxSize.height,
  )

  return {
    displayMode: "floating",
    floatingSize: { width, height },
    floatingPosition: {
      x: clamp(viewport.width - width - CHATBOT_WIDGET_DEFAULT_OFFSET, 0, viewport.width - width),
      y: clamp(viewport.height - height - CHATBOT_WIDGET_DEFAULT_OFFSET, 0, viewport.height - height),
    },
    sidePeekWidth: width,
  }
}

export function sanitizeWidgetLayout(
  input: Partial<WidgetLayoutState> | Partial<StoredWidgetState> | null | undefined,
  viewport = getViewportSize(),
): WidgetLayoutState {
  const fallback = defaultLayoutForViewport(viewport)
  const maxSize = getMaxSize(viewport)
  const inputLayout = (input ?? {}) as Partial<WidgetLayoutState> & Partial<StoredWidgetState>
  const inputSize = inputLayout.floatingSize ?? fallback.floatingSize
  const inputPosition = inputLayout.floatingPosition ?? fallback.floatingPosition

  const width = clamp(
    isFiniteNumber(inputSize.width) ? inputSize.width : fallback.floatingSize.width,
    CHATBOT_WIDGET_MIN_WIDTH,
    maxSize.width,
  )
  const height = clamp(
    isFiniteNumber(inputSize.height) ? inputSize.height : fallback.floatingSize.height,
    CHATBOT_WIDGET_MIN_HEIGHT,
    maxSize.height,
  )
  const sidePeekWidth = clamp(
    isFiniteNumber(inputLayout.sidePeekWidth) ? inputLayout.sidePeekWidth : fallback.sidePeekWidth,
    CHATBOT_WIDGET_MIN_WIDTH,
    maxSize.width,
  )
  const displayMode = inputLayout.displayMode === "side-peek" ? "side-peek" : "floating"

  return {
    displayMode,
    floatingSize: { width, height },
    floatingPosition: {
      x: clamp(isFiniteNumber(inputPosition.x) ? inputPosition.x : fallback.floatingPosition.x, 0, viewport.width - width),
      y: clamp(isFiniteNumber(inputPosition.y) ? inputPosition.y : fallback.floatingPosition.y, 0, viewport.height - height),
    },
    sidePeekWidth,
  }
}

function createStoredState(
  minimized: boolean,
  now: Date,
  firstShownAt = now,
  layout = sanitizeWidgetLayout(null),
): StoredWidgetState {
  return {
    minimized,
    firstShownAt: firstShownAt.toISOString(),
    lastSeenAt: now.toISOString(),
    expiresAt: addDays(firstShownAt, CHATBOT_WIDGET_TTL_DAYS).toISOString(),
    displayMode: layout.displayMode,
    floatingSize: layout.floatingSize,
    floatingPosition: layout.floatingPosition,
    sidePeekWidth: layout.sidePeekWidth,
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

export function persistWidgetState(
  storage: Storage,
  minimized: boolean,
  now: Date,
  firstShownAt?: Date,
  layout?: WidgetLayoutState,
) {
  const storedState = createStoredState(minimized, now, firstShownAt, layout)
  storage.setItem(CHATBOT_WIDGET_STORAGE_KEY, JSON.stringify(storedState))
  return storedState
}

export function useWidgetState(): WidgetState {
  const [hasHydrated, setHasHydrated] = useState(false)
  const [isVisible, setIsVisible] = useState(false)
  const [isMinimized, setIsMinimized] = useState(false)
  const [layout, setLayout] = useState<WidgetLayoutState>(() => sanitizeWidgetLayout(null))
  const [firstShownAt, setFirstShownAt] = useState<Date | null>(null)

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      const now = new Date(Date.now())
      const storedState = readStoredWidgetState(window.localStorage, now)
      const nextLayout = sanitizeWidgetLayout(storedState)
      setLayout(nextLayout)
      if (storedState) {
        setFirstShownAt(new Date(storedState.firstShownAt))
        setIsVisible(true)
        setIsMinimized(storedState.minimized)
      }
      setHasHydrated(true)
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [])

  useEffect(() => {
    const handleResize = () => {
      setLayout((currentLayout) => {
        const nextLayout = sanitizeWidgetLayout(currentLayout)
        if (isVisible) {
          const now = new Date(Date.now())
          const nextFirstShownAt = firstShownAt ?? now
          persistWidgetState(window.localStorage, isMinimized, now, nextFirstShownAt, nextLayout)
        }
        return nextLayout
      })
    }

    window.addEventListener("resize", handleResize)
    return () => window.removeEventListener("resize", handleResize)
  }, [firstShownAt, isMinimized, isVisible])

  const writeState = useCallback((minimized: boolean, initialShownAt?: Date, nextLayout = layout) => {
    const now = new Date(Date.now())
    const nextFirstShownAt = initialShownAt ?? firstShownAt ?? now
    persistWidgetState(window.localStorage, minimized, now, nextFirstShownAt, nextLayout)
    setFirstShownAt(nextFirstShownAt)
    setIsVisible(true)
    setIsMinimized(minimized)
  }, [firstShownAt, layout])

  const updateLayout = useCallback((nextLayout: WidgetLayoutState) => {
    const sanitizedLayout = sanitizeWidgetLayout(nextLayout)
    setLayout(sanitizedLayout)
    if (isVisible) {
      const now = new Date(Date.now())
      const nextFirstShownAt = firstShownAt ?? now
      persistWidgetState(window.localStorage, isMinimized, now, nextFirstShownAt, sanitizedLayout)
      setFirstShownAt(nextFirstShownAt)
    }
  }, [firstShownAt, isMinimized, isVisible])

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

  const setDisplayMode = useCallback((displayMode: WidgetDisplayMode) => {
    updateLayout({ ...layout, displayMode })
  }, [layout, updateLayout])

  const toggleDisplayMode = useCallback(() => {
    setDisplayMode(layout.displayMode === "side-peek" ? "floating" : "side-peek")
  }, [layout.displayMode, setDisplayMode])

  const setFloatingSize = useCallback((size: Partial<WidgetSize>) => {
    updateLayout({
      ...layout,
      floatingSize: { ...layout.floatingSize, ...size },
    })
  }, [layout, updateLayout])

  const setFloatingPosition = useCallback((position: Partial<WidgetPosition>) => {
    updateLayout({
      ...layout,
      floatingPosition: { ...layout.floatingPosition, ...position },
    })
  }, [layout, updateLayout])

  const setSidePeekWidth = useCallback((width: number) => {
    updateLayout({ ...layout, sidePeekWidth: width })
  }, [layout, updateLayout])

  return {
    hasHydrated,
    isVisible,
    isMinimized,
    layout,
    showInitial,
    open,
    minimize,
    setDisplayMode,
    toggleDisplayMode,
    setFloatingSize,
    setFloatingPosition,
    setSidePeekWidth,
  }
}
