"use client"

import { useCallback, useEffect, useState } from "react"

export const CHATBOT_WIDGET_STORAGE_KEY = "chatbot-widget-state"
export const CHATBOT_WIDGET_TTL_DAYS = 30
export const CHATBOT_WIDGET_MIN_WIDTH = 320
export const CHATBOT_WIDGET_MIN_HEIGHT = 400
export const CHATBOT_WIDGET_DEFAULT_WIDTH = 384
export const CHATBOT_WIDGET_DEFAULT_HEIGHT = 560
export const CHATBOT_WIDGET_DEFAULT_SIDE_PEEK_WIDTH = 384
export const CHATBOT_WIDGET_VIEWPORT_GAP = 32

export type WidgetMode = "floating" | "side-peek"

export type WidgetSize = {
  width: number
  height: number
}

export type WidgetPosition = {
  x: number
  y: number
}

export type WidgetLayout = {
  mode: WidgetMode
  floatingSize: WidgetSize
  floatingPosition: WidgetPosition
  sidePeekWidth: number
}

export type StoredWidgetState = {
  minimized: boolean
  firstShownAt: string
  lastSeenAt: string
  expiresAt: string
  mode?: WidgetMode
  floatingSize?: WidgetSize
  floatingPosition?: WidgetPosition
  sidePeekWidth?: number
}

type WidgetState = {
  hasHydrated: boolean
  isVisible: boolean
  isMinimized: boolean
  layout: WidgetLayout
  showInitial: () => void
  open: () => void
  minimize: () => void
  setMode: (mode: WidgetMode) => void
  setFloatingGeometry: (geometry: { position?: WidgetPosition; size?: WidgetSize }) => void
  setSidePeekWidth: (width: number) => void
}

function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function viewportSize() {
  if (typeof window === "undefined") {
    return { width: 1280, height: 800 }
  }

  return {
    width: window.innerWidth,
    height: window.innerHeight,
  }
}

export function getWidgetLayoutBounds(viewport = viewportSize()) {
  const maxWidth = Math.max(CHATBOT_WIDGET_MIN_WIDTH, Math.floor(viewport.width * 0.9))
  const maxHeight = Math.max(CHATBOT_WIDGET_MIN_HEIGHT, Math.floor(viewport.height * 0.9))
  return {
    maxWidth,
    maxHeight,
    minX: CHATBOT_WIDGET_VIEWPORT_GAP,
    minY: CHATBOT_WIDGET_VIEWPORT_GAP,
    maxX: Math.max(CHATBOT_WIDGET_VIEWPORT_GAP, viewport.width - CHATBOT_WIDGET_VIEWPORT_GAP - CHATBOT_WIDGET_MIN_WIDTH),
    maxY: Math.max(CHATBOT_WIDGET_VIEWPORT_GAP, viewport.height - CHATBOT_WIDGET_VIEWPORT_GAP - CHATBOT_WIDGET_MIN_HEIGHT),
  }
}

export function createDefaultWidgetLayout(viewport = viewportSize()): WidgetLayout {
  const bounds = getWidgetLayoutBounds(viewport)
  const width = clamp(CHATBOT_WIDGET_DEFAULT_WIDTH, CHATBOT_WIDGET_MIN_WIDTH, bounds.maxWidth)
  const height = clamp(CHATBOT_WIDGET_DEFAULT_HEIGHT, CHATBOT_WIDGET_MIN_HEIGHT, bounds.maxHeight)
  return {
    mode: "floating",
    floatingSize: { width, height },
    floatingPosition: {
      x: clamp(viewport.width - width - CHATBOT_WIDGET_VIEWPORT_GAP, bounds.minX, Math.max(bounds.minX, viewport.width - width - CHATBOT_WIDGET_VIEWPORT_GAP)),
      y: clamp(viewport.height - height - CHATBOT_WIDGET_VIEWPORT_GAP, bounds.minY, Math.max(bounds.minY, viewport.height - height - CHATBOT_WIDGET_VIEWPORT_GAP)),
    },
    sidePeekWidth: clamp(CHATBOT_WIDGET_DEFAULT_SIDE_PEEK_WIDTH, CHATBOT_WIDGET_MIN_WIDTH, bounds.maxWidth),
  }
}

export function sanitizeWidgetLayout(value?: Partial<WidgetLayout>, viewport = viewportSize()): WidgetLayout {
  const defaults = createDefaultWidgetLayout(viewport)
  const bounds = getWidgetLayoutBounds(viewport)
  const mode = value?.mode === "side-peek" ? "side-peek" : "floating"
  const width = clamp(
    finiteNumber(value?.floatingSize?.width) ? value.floatingSize.width : defaults.floatingSize.width,
    CHATBOT_WIDGET_MIN_WIDTH,
    bounds.maxWidth,
  )
  const height = clamp(
    finiteNumber(value?.floatingSize?.height) ? value.floatingSize.height : defaults.floatingSize.height,
    CHATBOT_WIDGET_MIN_HEIGHT,
    bounds.maxHeight,
  )
  const maxX = Math.max(bounds.minX, viewport.width - CHATBOT_WIDGET_VIEWPORT_GAP - width)
  const maxY = Math.max(bounds.minY, viewport.height - CHATBOT_WIDGET_VIEWPORT_GAP - height)

  return {
    mode,
    floatingSize: { width, height },
    floatingPosition: {
      x: clamp(finiteNumber(value?.floatingPosition?.x) ? value.floatingPosition.x : defaults.floatingPosition.x, bounds.minX, maxX),
      y: clamp(finiteNumber(value?.floatingPosition?.y) ? value.floatingPosition.y : defaults.floatingPosition.y, bounds.minY, maxY),
    },
    sidePeekWidth: clamp(
      finiteNumber(value?.sidePeekWidth) ? value.sidePeekWidth : defaults.sidePeekWidth,
      CHATBOT_WIDGET_MIN_WIDTH,
      bounds.maxWidth,
    ),
  }
}

function createStoredState(
  minimized: boolean,
  now: Date,
  firstShownAt = now,
  layout = createDefaultWidgetLayout(),
): StoredWidgetState {
  return {
    minimized,
    firstShownAt: firstShownAt.toISOString(),
    lastSeenAt: now.toISOString(),
    expiresAt: addDays(firstShownAt, CHATBOT_WIDGET_TTL_DAYS).toISOString(),
    mode: layout.mode,
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

    return {
      minimized: parsed.minimized,
      firstShownAt: parsed.firstShownAt,
      lastSeenAt: parsed.lastSeenAt,
      expiresAt: parsed.expiresAt,
      ...sanitizeWidgetLayout(parsed),
    }
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
  layout?: WidgetLayout,
) {
  const storedState = createStoredState(minimized, now, firstShownAt, sanitizeWidgetLayout(layout))
  storage.setItem(CHATBOT_WIDGET_STORAGE_KEY, JSON.stringify(storedState))
  return storedState
}

export function useWidgetState(): WidgetState {
  const [hasHydrated, setHasHydrated] = useState(false)
  const [isVisible, setIsVisible] = useState(false)
  const [isMinimized, setIsMinimized] = useState(false)
  const [layout, setLayout] = useState<WidgetLayout>(() => createDefaultWidgetLayout())
  const [firstShownAt, setFirstShownAt] = useState<Date | null>(null)

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      const now = new Date(Date.now())
      const storedState = readStoredWidgetState(window.localStorage, now)
      if (storedState) {
        setFirstShownAt(new Date(storedState.firstShownAt))
        setIsVisible(true)
        setIsMinimized(storedState.minimized)
        setLayout(sanitizeWidgetLayout(storedState))
      }
      setHasHydrated(true)
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [])

  const writeState = useCallback((minimized: boolean, initialShownAt?: Date) => {
    const now = new Date(Date.now())
    const nextFirstShownAt = initialShownAt ?? firstShownAt ?? now
    const nextLayout = sanitizeWidgetLayout(layout)
    persistWidgetState(window.localStorage, minimized, now, nextFirstShownAt, nextLayout)
    setFirstShownAt(nextFirstShownAt)
    setIsVisible(true)
    setIsMinimized(minimized)
    setLayout(nextLayout)
  }, [firstShownAt, layout])

  const writeLayout = useCallback((nextLayout: WidgetLayout) => {
    const now = new Date(Date.now())
    const nextFirstShownAt = firstShownAt ?? now
    const sanitized = sanitizeWidgetLayout(nextLayout)
    persistWidgetState(window.localStorage, isMinimized, now, nextFirstShownAt, sanitized)
    setFirstShownAt(nextFirstShownAt)
    setLayout(sanitized)
  }, [firstShownAt, isMinimized])

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

  const setMode = useCallback((mode: WidgetMode) => {
    writeLayout({ ...layout, mode })
  }, [layout, writeLayout])

  const setFloatingGeometry = useCallback(({ position, size }: { position?: WidgetPosition; size?: WidgetSize }) => {
    writeLayout({
      ...layout,
      floatingPosition: position ?? layout.floatingPosition,
      floatingSize: size ?? layout.floatingSize,
    })
  }, [layout, writeLayout])

  const setSidePeekWidth = useCallback((width: number) => {
    writeLayout({ ...layout, sidePeekWidth: width })
  }, [layout, writeLayout])

  useEffect(() => {
    if (!hasHydrated) return
    const handleResize = () => {
      setLayout((currentLayout) => {
        const nextLayout = sanitizeWidgetLayout(currentLayout)
        persistWidgetState(window.localStorage, isMinimized, new Date(Date.now()), firstShownAt ?? new Date(Date.now()), nextLayout)
        return nextLayout
      })
    }

    window.addEventListener("resize", handleResize)
    return () => window.removeEventListener("resize", handleResize)
  }, [firstShownAt, hasHydrated, isMinimized])

  return {
    hasHydrated,
    isVisible,
    isMinimized,
    layout,
    showInitial,
    open,
    minimize,
    setMode,
    setFloatingGeometry,
    setSidePeekWidth,
  }
}
