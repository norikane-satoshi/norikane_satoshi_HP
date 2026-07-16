"use client"

/* eslint-disable @next/next/no-img-element */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react"
import { createPortal } from "react-dom"
import { X } from "lucide-react"
import {
  FEATURED_PLAYLIST_WORKS,
  FEATURED_WORKS,
  calculateClipWindow,
  getNextYouTubeThumbnailVariant,
  getYouTubeThumbnailUrl,
  shuffleVideoIds,
  type ClipWindow,
  type FeaturedPlaylistWork,
  type FeaturedWorkPreviewVideo,
  type FeaturedWork,
  type FeaturedWorkLink,
  type YouTubeThumbnailVariantSelection,
} from "@/components/hp/featured-works-data"
import { MARS_ABSTRACT_COVER_BACKGROUND } from "@/components/hp/hero-deep-surface"
import { HP_MODAL_OVERLAY_Z_INDEX } from "@/components/hp/modal-layer"

type YouTubePlayerStateChangeEvent = {
  data: number
  target: YouTubePlayer
}

type YouTubePlayerErrorEvent = {
  data: number
  target: YouTubePlayer
}

type YouTubePlayer = {
  mute?: () => void
  playVideo?: () => void
  stopVideo?: () => void
  destroy?: () => void
  getDuration?: () => number
  seekTo?: (seconds: number, allowSeekAhead: boolean) => void
  loadVideoById?: (
    videoId:
      | string
      | { videoId: string; startSeconds?: number; endSeconds?: number },
  ) => void
}

type ActiveVideoModal = {
  videoId: string
  label: string
}

type YouTubePlayerConstructor = new (
  element: HTMLElement,
  options: {
    videoId?: string
    playerVars?: Record<string, string | number>
    events?: {
      onReady?: (event: { target: YouTubePlayer }) => void
      onStateChange?: (event: YouTubePlayerStateChangeEvent) => void
      onError?: (event: YouTubePlayerErrorEvent) => void
    }
  },
) => YouTubePlayer

declare global {
  interface Window {
    YT?: {
      Player: YouTubePlayerConstructor
      PlayerState: {
        ENDED: number
        PLAYING: number
      }
    }
    onYouTubeIframeAPIReady?: () => void
  }
}

type YouTubePlayerVarsOptions = {
  loop?: boolean
}

let youtubeApiPromise: Promise<void> | null = null
const YOUTUBE_ORIGIN = "https://www.youtube.com"
const STARTUP_COVER_HOLD_MS = 5000
const MARQUEE_LOOP_SECONDS = 72
const MARQUEE_INPUT_IDLE_MS = 1300
const MARQUEE_PROGRESS_MIN_THUMB_WIDTH = 44
const CARD_NEAR_VIEWPORT_ROOT_MARGIN_PX = 320
const VIDEO_OPEN_DRAG_THRESHOLD_PX = 8
const INITIAL_THUMBNAIL_SELECTION: YouTubeThumbnailVariantSelection = {
  variant: 1,
  queue: [],
  lastOrder: [],
}

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",")

type MarqueeMetrics = {
  start: number
  loopWidth: number
}

export type FeaturedWorkMarqueeProgressBarGeometry = {
  progress: number
  thumbWidth: number
  thumbTranslateX: number
}

export function getFeaturedWorkMarqueeProgressBarGeometry({
  virtualScrollLeft,
  metrics,
  viewportWidth,
  trackWidth,
  minThumbWidth = MARQUEE_PROGRESS_MIN_THUMB_WIDTH,
}: {
  virtualScrollLeft: number
  metrics: MarqueeMetrics | null
  viewportWidth: number
  trackWidth: number
  minThumbWidth?: number
}): FeaturedWorkMarqueeProgressBarGeometry {
  if (!metrics || metrics.loopWidth <= 0 || viewportWidth <= 0 || trackWidth <= 0) {
    return {
      progress: 0,
      thumbWidth: Math.max(0, Math.min(minThumbWidth, trackWidth)),
      thumbTranslateX: 0,
    }
  }

  const relativeScrollLeft = virtualScrollLeft - metrics.start
  const normalizedRelativeScrollLeft =
    ((relativeScrollLeft % metrics.loopWidth) + metrics.loopWidth) %
    metrics.loopWidth
  const progress = normalizedRelativeScrollLeft / metrics.loopWidth
  const proportionalThumbWidth = trackWidth * (viewportWidth / metrics.loopWidth)
  const thumbWidth = Math.min(
    trackWidth,
    Math.max(minThumbWidth, proportionalThumbWidth),
  )
  const thumbTranslateX = progress * Math.max(0, trackWidth - thumbWidth)

  return {
    progress,
    thumbWidth,
    thumbTranslateX,
  }
}

function loadYouTubeIframeApi() {
  if (typeof window === "undefined") {
    return Promise.resolve()
  }

  if (!document.querySelector(`link[rel="preconnect"][href="${YOUTUBE_ORIGIN}"]`)) {
    const preconnect = document.createElement("link")
    preconnect.rel = "preconnect"
    preconnect.href = YOUTUBE_ORIGIN
    preconnect.crossOrigin = "anonymous"
    document.head.appendChild(preconnect)
  }

  if (window.YT?.Player) {
    return Promise.resolve()
  }

  youtubeApiPromise ??= new Promise((resolve) => {
    const previousReady = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      previousReady?.()
      resolve()
    }

    if (!document.querySelector(`script[src="${YOUTUBE_ORIGIN}/iframe_api"]`)) {
      const script = document.createElement("script")
      script.src = `${YOUTUBE_ORIGIN}/iframe_api`
      script.async = true
      document.head.appendChild(script)
    }
  })

  return youtubeApiPromise
}

function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false)

  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)")
    if (!query) {
      return
    }

    const syncPreference = () => setPrefersReducedMotion(query.matches)
    syncPreference()
    query.addEventListener("change", syncPreference)
    return () => query.removeEventListener("change", syncPreference)
  }, [])

  return prefersReducedMotion
}

function useHasEnteredViewport<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const [hasEnteredViewport, setHasEnteredViewport] = useState(
    () => typeof window !== "undefined" && !("IntersectionObserver" in window),
  )

  useEffect(() => {
    const element = ref.current
    if (!element) {
      return
    }

    if (!("IntersectionObserver" in window)) {
      return
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setHasEnteredViewport(true)
          observer.disconnect()
        }
      },
      { rootMargin: "160px 0px", threshold: 0.18 },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return [ref, hasEnteredViewport] as const
}

function useNearMarqueeViewport<T extends HTMLElement>(enabled: boolean) {
  const ref = useRef<T | null>(null)
  const [isNearViewport, setIsNearViewport] = useState(
    () => typeof window !== "undefined" && !("IntersectionObserver" in window),
  )

  useEffect(() => {
    const element = ref.current
    const setNearViewportAsync = (value: boolean) => {
      let cancelled = false
      queueMicrotask(() => {
        if (!cancelled) {
          setIsNearViewport(value)
        }
      })
      return () => {
        cancelled = true
      }
    }

    if (!enabled || !element) {
      return setNearViewportAsync(false)
    }

    if (!("IntersectionObserver" in window)) {
      return setNearViewportAsync(true)
    }

    const root = element.closest<HTMLElement>(
      '[data-featured-work-marquee-viewport="true"]',
    )
    if (!root) {
      return setNearViewportAsync(true)
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsNearViewport(entry.isIntersecting)
      },
      {
        root,
        rootMargin: `0px ${CARD_NEAR_VIEWPORT_ROOT_MARGIN_PX}px`,
        threshold: 0.01,
      },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [enabled])

  return [ref, isNearViewport] as const
}

function getNormalizedMarqueeScrollLeft(
  scrollLeft: number,
  metrics: MarqueeMetrics,
) {
  if (metrics.loopWidth <= 0) {
    return scrollLeft
  }

  const relativeScrollLeft = scrollLeft - metrics.start
  return (
    metrics.start +
    ((relativeScrollLeft % metrics.loopWidth) + metrics.loopWidth) %
      metrics.loopWidth
  )
}

function normalizeMarqueeScrollLeft(
  viewport: HTMLElement,
  metrics: MarqueeMetrics,
) {
  const normalizedScrollLeft = getNormalizedMarqueeScrollLeft(
    viewport.scrollLeft,
    metrics,
  )

  if (Math.abs(viewport.scrollLeft - normalizedScrollLeft) > 1) {
    viewport.scrollLeft = normalizedScrollLeft
  }

  return normalizedScrollLeft
}

function getMarqueeScrollLeftFromProgress(
  progress: number,
  metrics: MarqueeMetrics,
) {
  if (progress >= 1) {
    return metrics.start + Math.max(0, metrics.loopWidth - 1)
  }

  return metrics.start + Math.max(0, progress) * metrics.loopWidth
}

function useScrollableMarquee(
  viewportRef: RefObject<HTMLDivElement | null>,
  progressTrackRef: RefObject<HTMLDivElement | null>,
  progressThumbRef: RefObject<HTMLDivElement | null>,
  enabled: boolean,
) {
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || !enabled) {
      return
    }

    const getMetrics = (): MarqueeMetrics | null => {
      const primaryStart = viewport.querySelector<HTMLElement>(
        '[data-featured-work-marquee-segment-start="primary"]',
      )
      const cloneAfterStart = viewport.querySelector<HTMLElement>(
        '[data-featured-work-marquee-segment-start="clone-after"]',
      )
      if (!primaryStart || !cloneAfterStart) {
        return null
      }

      const loopWidth = cloneAfterStart.offsetLeft - primaryStart.offsetLeft
      if (loopWidth <= 0) {
        return null
      }

      return {
        start: primaryStart.offsetLeft,
        loopWidth,
      }
    }

    let animationFrame = 0
    let lastFrameTime: number | null = null
    let resumeAt = 0
    let metrics = getMetrics()
    let hasInitializedScrollPosition = false
    let virtualScrollLeft = viewport.scrollLeft
    let dragState: {
      pointerId: number
      startClientX: number
      startThumbTranslateX: number
      thumbWidth: number
      trackWidth: number
    } | null = null

    const setState = (state: "running" | "paused") => {
      viewport.dataset.featuredWorkMarqueeState = state
    }

    const getProgressBarGeometry = () => {
      const progressTrack = progressTrackRef.current
      if (!progressTrack) {
        return null
      }

      return getFeaturedWorkMarqueeProgressBarGeometry({
        virtualScrollLeft,
        metrics,
        viewportWidth: viewport.clientWidth,
        trackWidth: progressTrack.clientWidth,
      })
    }

    const syncProgressBar = () => {
      const progressThumb = progressThumbRef.current
      const geometry = getProgressBarGeometry()
      if (!geometry || !progressThumb) {
        return
      }

      progressThumb.style.width = `${geometry.thumbWidth}px`
      progressThumb.style.transform = `translate3d(${geometry.thumbTranslateX}px, 0, 0)`
      progressThumb.setAttribute("aria-valuenow", String(Math.round(geometry.progress * 1000)))
      progressThumb.dataset.featuredWorkMarqueeProgress = geometry.progress.toFixed(4)
    }

    const syncMetrics = () => {
      metrics = getMetrics()
      if (metrics) {
        if (!hasInitializedScrollPosition) {
          viewport.scrollLeft = metrics.start
          virtualScrollLeft = metrics.start
          hasInitializedScrollPosition = true
          syncProgressBar()
          return
        }
        virtualScrollLeft = normalizeMarqueeScrollLeft(viewport, metrics)
      }
      syncProgressBar()
    }

    const pauseForInput = () => {
      resumeAt = performance.now() + MARQUEE_INPUT_IDLE_MS
      lastFrameTime = null
      setState("paused")
    }

    const setScrollProgress = (progress: number) => {
      if (!metrics) {
        syncMetrics()
      }
      if (!metrics) {
        return
      }

      virtualScrollLeft = getMarqueeScrollLeftFromProgress(progress, metrics)
      viewport.scrollLeft = virtualScrollLeft
      syncProgressBar()
    }

    const step = (timestamp: number) => {
      if (!metrics) {
        syncMetrics()
      }

      if (metrics) {
        if (timestamp >= resumeAt) {
          setState("running")
          const previousFrameTime = lastFrameTime ?? timestamp
          const elapsedSeconds = Math.min(timestamp - previousFrameTime, 64) / 1000
          virtualScrollLeft += (metrics.loopWidth / MARQUEE_LOOP_SECONDS) * elapsedSeconds
          virtualScrollLeft = getNormalizedMarqueeScrollLeft(
            virtualScrollLeft,
            metrics,
          )
          if (Math.abs(viewport.scrollLeft - virtualScrollLeft) > 0.5) {
            viewport.scrollLeft = virtualScrollLeft
          }
          syncProgressBar()
          lastFrameTime = timestamp
        } else {
          virtualScrollLeft = normalizeMarqueeScrollLeft(viewport, metrics)
          syncProgressBar()
          lastFrameTime = null
        }
      }

      animationFrame = window.requestAnimationFrame(step)
    }

    const handleViewportKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        pauseForInput()
      }
    }

    const handleThumbKeyDown = (event: KeyboardEvent) => {
      if (!metrics) {
        syncMetrics()
      }
      const geometry = getProgressBarGeometry()
      if (!metrics || !geometry) {
        return
      }

      const progressStep = Math.max(
        0.01,
        Math.min(0.1, viewport.clientWidth / metrics.loopWidth / 2),
      )
      let nextProgress = geometry.progress

      if (event.key === "ArrowLeft") {
        nextProgress -= progressStep
      } else if (event.key === "ArrowRight") {
        nextProgress += progressStep
      } else if (event.key === "Home") {
        nextProgress = 0
      } else if (event.key === "End") {
        nextProgress = 1
      } else {
        return
      }

      event.preventDefault()
      pauseForInput()
      setScrollProgress(nextProgress)
    }

    const handleScroll = () => {
      if (metrics) {
        virtualScrollLeft = viewport.scrollLeft
        virtualScrollLeft = normalizeMarqueeScrollLeft(viewport, metrics)
        syncProgressBar()
      }
    }

    const handleThumbPointerDown = (event: PointerEvent) => {
      if (!metrics) {
        syncMetrics()
      }
      const progressThumb = progressThumbRef.current
      const progressTrack = progressTrackRef.current
      const geometry = getProgressBarGeometry()
      if (!progressThumb || !progressTrack || !geometry || !metrics) {
        return
      }

      event.preventDefault()
      pauseForInput()
      progressThumb.setPointerCapture?.(event.pointerId)
      dragState = {
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startThumbTranslateX: geometry.thumbTranslateX,
        thumbWidth: geometry.thumbWidth,
        trackWidth: progressTrack.clientWidth,
      }
    }

    const handleThumbPointerMove = (event: PointerEvent) => {
      if (!dragState || dragState.pointerId !== event.pointerId) {
        return
      }

      event.preventDefault()
      pauseForInput()
      const travelWidth = Math.max(0, dragState.trackWidth - dragState.thumbWidth)
      if (travelWidth <= 0) {
        setScrollProgress(0)
        return
      }

      const translateX = Math.min(
        travelWidth,
        Math.max(0, dragState.startThumbTranslateX + event.clientX - dragState.startClientX),
      )
      setScrollProgress(translateX / travelWidth)
    }

    const handleThumbPointerEnd = (event: PointerEvent) => {
      if (!dragState || dragState.pointerId !== event.pointerId) {
        return
      }

      pauseForInput()
      progressThumbRef.current?.releasePointerCapture?.(event.pointerId)
      dragState = null
    }

    const handleTrackPointerDown = (event: PointerEvent) => {
      if (!metrics) {
        syncMetrics()
      }
      const progressTrack = progressTrackRef.current
      const progressThumb = progressThumbRef.current
      const geometry = getProgressBarGeometry()
      if (
        !progressTrack ||
        !progressThumb ||
        !geometry ||
        !metrics ||
        event.target === progressThumb
      ) {
        return
      }

      event.preventDefault()
      pauseForInput()
      progressThumb.focus()
      const trackRect = progressTrack.getBoundingClientRect()
      const travelWidth = Math.max(0, progressTrack.clientWidth - geometry.thumbWidth)
      const centeredThumbX = event.clientX - trackRect.left - geometry.thumbWidth / 2
      const translateX = Math.min(travelWidth, Math.max(0, centeredThumbX))
      setScrollProgress(travelWidth <= 0 ? 0 : translateX / travelWidth)
    }

    syncMetrics()
    const progressTrack = progressTrackRef.current
    const progressThumb = progressThumbRef.current
    viewport.dataset.featuredWorkMarqueeIdleMs = String(MARQUEE_INPUT_IDLE_MS)
    viewport.addEventListener("wheel", pauseForInput, { passive: true })
    viewport.addEventListener("touchstart", pauseForInput, { passive: true })
    viewport.addEventListener("pointerdown", pauseForInput, { passive: true })
    viewport.addEventListener("keydown", handleViewportKeyDown)
    viewport.addEventListener("scroll", handleScroll, { passive: true })
    progressTrack?.addEventListener("pointerdown", handleTrackPointerDown)
    progressThumb?.addEventListener("pointerdown", handleThumbPointerDown)
    progressThumb?.addEventListener("pointermove", handleThumbPointerMove)
    progressThumb?.addEventListener("pointerup", handleThumbPointerEnd)
    progressThumb?.addEventListener("pointercancel", handleThumbPointerEnd)
    progressThumb?.addEventListener("keydown", handleThumbKeyDown)
    window.addEventListener("resize", syncMetrics)
    animationFrame = window.requestAnimationFrame(step)

    return () => {
      window.cancelAnimationFrame(animationFrame)
      viewport.removeEventListener("wheel", pauseForInput)
      viewport.removeEventListener("touchstart", pauseForInput)
      viewport.removeEventListener("pointerdown", pauseForInput)
      viewport.removeEventListener("keydown", handleViewportKeyDown)
      viewport.removeEventListener("scroll", handleScroll)
      progressTrack?.removeEventListener("pointerdown", handleTrackPointerDown)
      progressThumb?.removeEventListener("pointerdown", handleThumbPointerDown)
      progressThumb?.removeEventListener("pointermove", handleThumbPointerMove)
      progressThumb?.removeEventListener("pointerup", handleThumbPointerEnd)
      progressThumb?.removeEventListener("pointercancel", handleThumbPointerEnd)
      progressThumb?.removeEventListener("keydown", handleThumbKeyDown)
      window.removeEventListener("resize", syncMetrics)
      delete viewport.dataset.featuredWorkMarqueeState
      delete viewport.dataset.featuredWorkMarqueeIdleMs
    }
  }, [enabled, progressThumbRef, progressTrackRef, viewportRef])
}

function PreviewFrame({
  children,
  abstractCover = false,
  background,
}: {
  children: ReactNode
  abstractCover?: boolean
  background?: string
}) {
  return (
    <div
      className="relative -mx-4 -mt-4 aspect-video overflow-hidden rounded-none md:-mx-5 md:-mt-5"
      data-featured-work-abstract-cover={abstractCover ? "true" : undefined}
      data-hp-color-field={abstractCover ? "cinematic-neutral" : undefined}
      style={background ? { background } : undefined}
    >
      {children}
    </div>
  )
}

function PreviewThumbnail({
  videoId,
  isVisible,
}: {
  videoId: string
  isVisible: boolean
}) {
  const previousVisibleRef = useRef(isVisible)
  const previousVideoIdRef = useRef(videoId)
  const hasInitializedThumbnailRef = useRef(false)
  const [thumbnailSelection, setThumbnailSelection] =
    useState<YouTubeThumbnailVariantSelection>(INITIAL_THUMBNAIL_SELECTION)
  const thumbnailKey = `${videoId}:${thumbnailSelection.variant}`
  const [fallbackThumbnailKey, setFallbackThumbnailKey] = useState<string | null>(
    null,
  )
  const useDefaultThumbnail = fallbackThumbnailKey === thumbnailKey

  useEffect(() => {
    const shouldSelectInitialVisible =
      isVisible && !hasInitializedThumbnailRef.current
    const becameVisible = isVisible && !previousVisibleRef.current
    const videoChangedWhileVisible =
      isVisible && previousVideoIdRef.current !== videoId

    hasInitializedThumbnailRef.current = true
    previousVisibleRef.current = isVisible
    previousVideoIdRef.current = videoId

    if (shouldSelectInitialVisible || becameVisible || videoChangedWhileVisible) {
      let cancelled = false
      queueMicrotask(() => {
        if (cancelled) {
          return
        }
        setThumbnailSelection((selection) =>
          getNextYouTubeThumbnailVariant(selection),
        )
      })
      return () => {
        cancelled = true
      }
    }
  }, [isVisible, videoId])

  return (
    <img
      src={getYouTubeThumbnailUrl(
        videoId,
        useDefaultThumbnail ? "default" : thumbnailSelection.variant,
      )}
      alt=""
      className={`featured-work-preview-thumbnail pointer-events-none absolute inset-0 z-20 h-full w-full rounded-none object-cover transition-opacity duration-[var(--motion-duration-press)] ease-[var(--ease-out-strong)] ${
        isVisible ? "opacity-100" : "opacity-0"
      }`}
      loading="lazy"
      decoding="async"
      onError={() => setFallbackThumbnailKey(thumbnailKey)}
      data-featured-work-preview-thumbnail={isVisible ? "visible" : "hidden"}
      data-featured-work-preview-thumbnail-variant={
        useDefaultThumbnail ? "default" : thumbnailSelection.variant
      }
    />
  )
}

function WorkLinkBadges({
  links,
  workTitle,
  clone = false,
  hideYouTube = false,
  layout = "inline",
}: {
  links: FeaturedWorkLink[]
  workTitle: string
  clone?: boolean
  hideYouTube?: boolean
  layout?: "inline" | "two-row"
}) {
  const visibleLinks = hideYouTube
    ? links.filter((link) => link.label !== "YouTube")
    : links

  const renderBadge = (link: FeaturedWorkLink) => (
    <a
      key={`${link.label}:${link.url}`}
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      tabIndex={clone ? -1 : undefined}
      className="glass-badge px-2.5 py-1 text-[0.64rem] leading-none transition-colors hover:bg-white/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-primary)]"
      aria-label={clone ? undefined : `${workTitle} ${link.label}を新しいタブで開く`}
      data-featured-work-link-badge={link.label}
    >
      {link.label}
    </a>
  )

  if (layout === "two-row") {
    return (
      <div
        className="flex flex-col items-end justify-end gap-1.5"
        data-featured-work-link-badges="inline"
        data-featured-work-link-badges-layout="two-row"
      >
        <div className="flex justify-end gap-1.5" data-featured-work-link-badge-row="top">
          {visibleLinks.slice(0, 2).map(renderBadge)}
        </div>
        <div className="flex justify-end gap-1.5" data-featured-work-link-badge-row="bottom">
          {visibleLinks.slice(2).map(renderBadge)}
        </div>
      </div>
    )
  }

  return (
    <div
      className="flex flex-wrap justify-end gap-1.5"
      data-featured-work-link-badges="inline"
    >
      {visibleLinks.map(renderBadge)}
    </div>
  )
}

function VideoOpenButton({
  label,
  clone,
  onOpen,
}: {
  label: string
  clone: boolean
  onOpen: (triggerElement: HTMLButtonElement) => void
}) {
  const pointerStartRef = useRef<{ x: number; y: number; moved: boolean } | null>(null)

  return (
    <button
      type="button"
      className="absolute inset-0 z-30 cursor-pointer rounded-none bg-transparent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--accent-primary)]"
      aria-label={clone ? undefined : label}
      tabIndex={clone ? -1 : undefined}
      data-featured-work-video-trigger="true"
      onPointerDown={(event) => {
        pointerStartRef.current = {
          x: event.clientX,
          y: event.clientY,
          moved: false,
        }
      }}
      onPointerMove={(event) => {
        const start = pointerStartRef.current
        if (!start) {
          return
        }

        const distance = Math.hypot(event.clientX - start.x, event.clientY - start.y)
        if (distance > VIDEO_OPEN_DRAG_THRESHOLD_PX) {
          start.moved = true
        }
      }}
      onPointerCancel={() => {
        pointerStartRef.current = null
      }}
      onClick={(event) => {
        if (pointerStartRef.current?.moved) {
          event.preventDefault()
          pointerStartRef.current = null
          return
        }

        pointerStartRef.current = null
        onOpen(event.currentTarget)
      }}
    />
  )
}

function getModalYouTubeSrc(videoId: string) {
  const params = new URLSearchParams({
    autoplay: "1",
    controls: "1",
    fs: "1",
    iv_load_policy: "3",
    modestbranding: "1",
    playsinline: "1",
    rel: "0",
  })

  return `https://www.youtube-nocookie.com/embed/${videoId}?${params.toString()}`
}

function FeaturedWorkVideoDialog({
  activeVideo,
  triggerElementRef,
  onClose,
}: {
  activeVideo: ActiveVideoModal | null
  triggerElementRef: RefObject<HTMLElement | null>
  onClose: () => void
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!activeVideo) {
      return
    }

    const previousOverflow = document.body.style.overflow
    const previousActiveElement =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    const triggerElement = triggerElementRef.current

    document.body.style.overflow = "hidden"
    closeButtonRef.current?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        onClose()
        return
      }

      if (event.key !== "Tab" || !dialogRef.current) {
        return
      }

      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(focusableSelector),
      ).filter((element) => !element.hasAttribute("disabled") && element.tabIndex !== -1)

      if (focusable.length === 0) {
        event.preventDefault()
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
        return
      }

      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener("keydown", handleKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener("keydown", handleKeyDown)
      if (triggerElement?.isConnected) {
        triggerElement.focus()
      } else if (previousActiveElement?.isConnected) {
        previousActiveElement.focus()
      }
    }
  }, [activeVideo, onClose, triggerElementRef])

  const canUseDocument = typeof document !== "undefined"
  if (!activeVideo || !canUseDocument) {
    return null
  }

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center bg-[rgba(8,4,24,0.42)] p-4 md:p-8"
      style={{
        zIndex: HP_MODAL_OVERLAY_Z_INDEX,
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
      data-featured-work-video-modal-overlay="true"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={activeVideo.label}
        className="glass-card relative w-full max-w-5xl overflow-hidden p-3 md:p-4"
        data-featured-work-video-modal="true"
      >
        <button
          ref={closeButtonRef}
          type="button"
          className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full border border-white/30 bg-black/35 text-white transition-colors hover:bg-black/45 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          aria-label="動画モーダルを閉じる"
          onClick={onClose}
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
        <div className="aspect-video w-full overflow-hidden rounded-none bg-black">
          <iframe
            src={getModalYouTubeSrc(activeVideo.videoId)}
            title={activeVideo.label}
            className="h-full w-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      </div>
    </div>,
    document.body,
  )
}

function getFixedClipWindow(video: FeaturedWorkPreviewVideo): ClipWindow | null {
  if (
    typeof video.loopStart !== "number" ||
    typeof video.loopEnd !== "number" ||
    video.loopEnd <= video.loopStart
  ) {
    return null
  }

  return {
    startSeconds: video.loopStart,
    playSeconds: video.loopEnd - video.loopStart,
  }
}

function hasPreviewClipConstraint(video: FeaturedWorkPreviewVideo) {
  return (
    typeof video.loopStart === "number" ||
    typeof video.loopEnd === "number" ||
    typeof video.clipRangeStart === "number" ||
    typeof video.clipRangeEnd === "number" ||
    typeof video.clipExcludeStart === "number" ||
    typeof video.clipExcludeEnd === "number"
  )
}

function getYouTubeLoadVideoArg(video: FeaturedWorkPreviewVideo) {
  const fixedClip = getFixedClipWindow(video)
  if (!fixedClip) {
    return video.videoId
  }

  return {
    videoId: video.videoId,
    startSeconds: fixedClip.startSeconds,
    endSeconds: fixedClip.startSeconds + fixedClip.playSeconds,
  }
}

function getPlayableDuration(durationSeconds: number) {
  return Number.isFinite(durationSeconds) && durationSeconds > 0
    ? durationSeconds
    : 30
}

function callReadyPlayerMethod(
  player: YouTubePlayer | null,
  isReady: boolean,
  method: Exclude<keyof YouTubePlayer, "getDuration">,
  ...args: unknown[]
) {
  if (!isReady || !player) {
    return false
  }

  const playerMethod = player[method]
  if (typeof playerMethod !== "function") {
    return false
  }

  try {
    ;(playerMethod as (...methodArgs: unknown[]) => unknown).apply(player, args)
    return true
  } catch {
    return false
  }
}

function getReadyPlayerDuration(player: YouTubePlayer, isReady: boolean) {
  if (!isReady || typeof player.getDuration !== "function") {
    return 0
  }

  try {
    return player.getDuration()
  } catch {
    return 0
  }
}

function stopAndDestroyPlayer(player: YouTubePlayer | null, isReady: boolean) {
  callReadyPlayerMethod(player, isReady, "stopVideo")
  callReadyPlayerMethod(player, isReady, "destroy")
}

export function getPreviewClipWindow(
  video: FeaturedWorkPreviewVideo,
  durationSeconds: number,
  random: () => number = Math.random,
  maxPlaySeconds = 30,
) {
  return (
    getFixedClipWindow(video) ??
    calculateClipWindow(
      getPlayableDuration(durationSeconds),
      random,
      maxPlaySeconds,
      video,
    )
  )
}

export function getYouTubePlayerVars(
  video?: string | FeaturedWorkPreviewVideo,
  options: YouTubePlayerVarsOptions = {},
) {
  const videoId = typeof video === "string" ? video : video?.videoId
  const fixedClip =
    typeof video === "object" && video ? getFixedClipWindow(video) : null
  const shouldLoop = options.loop ?? Boolean(videoId)

  return {
    autoplay: 1,
    controls: 0,
    disablekb: 1,
    fs: 0,
    iv_load_policy: 3,
    modestbranding: 1,
    mute: 1,
    origin: window.location.origin,
    playsinline: 1,
    rel: 0,
    ...(shouldLoop && videoId ? { loop: 1, playlist: videoId } : {}),
    ...(fixedClip
      ? {
          start: fixedClip.startSeconds,
          end: fixedClip.startSeconds + fixedClip.playSeconds,
        }
      : {}),
  }
}

function VideoSurface({
  videoId,
  loopStart,
  loopEnd,
  clipRangeStart,
  clipRangeEnd,
  clipExcludeStart,
  clipExcludeEnd,
  title,
  isActive,
  prefersReducedMotion,
  clone,
  onOpenVideo,
}: {
  videoId: string
  loopStart?: number
  loopEnd?: number
  clipRangeStart?: number
  clipRangeEnd?: number
  clipExcludeStart?: number
  clipExcludeEnd?: number
  title: string
  isActive: boolean
  prefersReducedMotion: boolean
  clone: boolean
  onOpenVideo: (
    video: ActiveVideoModal,
    triggerElement: HTMLButtonElement,
  ) => void
}) {
  const playerHostRef = useRef<HTMLDivElement | null>(null)
  const playerRef = useRef<YouTubePlayer | null>(null)
  const playerReadyRef = useRef(false)
  const previewVideoRef = useRef<FeaturedWorkPreviewVideo>({
    videoId,
    loopStart,
    loopEnd,
    clipRangeStart,
    clipRangeEnd,
    clipExcludeStart,
    clipExcludeEnd,
  })
  const clipRef = useRef<ClipWindow | null>(null)
  const timerRef = useRef<number | null>(null)
  const coverTimerRef = useRef<number | null>(null)
  const [activeClip, setActiveClip] = useState<ClipWindow | null>(null)
  const [isCoverVisible, setIsCoverVisible] = useState(true)
  const shouldPlay = isActive && !prefersReducedMotion
  const isPreviewReady = !isCoverVisible

  useEffect(() => {
    previewVideoRef.current = {
      videoId,
      loopStart,
      loopEnd,
      clipRangeStart,
      clipRangeEnd,
      clipExcludeStart,
      clipExcludeEnd,
    }
  }, [
    clipExcludeEnd,
    clipExcludeStart,
    clipRangeEnd,
    clipRangeStart,
    loopEnd,
    loopStart,
    videoId,
  ])

  useEffect(() => {
    const clearNextTimer = () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }

    const clearCoverTimer = () => {
      if (coverTimerRef.current) {
        window.clearTimeout(coverTimerRef.current)
        coverTimerRef.current = null
      }
    }

    const scheduleCoverHide = () => {
      clearCoverTimer()
      coverTimerRef.current = window.setTimeout(() => {
        setIsCoverVisible(false)
        coverTimerRef.current = null
      }, STARTUP_COVER_HOLD_MS)
    }

    if (!shouldPlay) {
      clearNextTimer()
      clearCoverTimer()
      clipRef.current = null
      window.setTimeout(() => {
        setActiveClip(null)
        setIsCoverVisible(true)
      }, 0)
      stopAndDestroyPlayer(playerRef.current, playerReadyRef.current)
      playerRef.current = null
      playerReadyRef.current = false
      return
    }

    let cancelled = false

    const playFullVideo = (player: YouTubePlayer) => {
      clearNextTimer()
      const duration = getPlayableDuration(
        getReadyPlayerDuration(player, playerReadyRef.current),
      )
      const clip = {
        startSeconds: 0,
        playSeconds: duration,
      }
      clipRef.current = clip
      setActiveClip(clip)
      clearCoverTimer()
      setIsCoverVisible(true)
      callReadyPlayerMethod(player, playerReadyRef.current, "seekTo", 0, true)
      callReadyPlayerMethod(player, playerReadyRef.current, "playVideo")
    }

    const playNextClip = (player: YouTubePlayer) => {
      clearNextTimer()
      const clip = getPreviewClipWindow(
        previewVideoRef.current,
        getReadyPlayerDuration(player, playerReadyRef.current),
        Math.random,
        30,
      )
      clipRef.current = clip
      setActiveClip(clip)
      clearCoverTimer()
      setIsCoverVisible(true)
      callReadyPlayerMethod(
        player,
        playerReadyRef.current,
        "seekTo",
        clip.startSeconds,
        true,
      )
      callReadyPlayerMethod(player, playerReadyRef.current, "playVideo")
      timerRef.current = window.setTimeout(() => {
        if (!cancelled && playerRef.current) {
          clipRef.current = null
          playNextClip(playerRef.current)
        }
      }, Math.max(1, clip.playSeconds) * 1000)
    }

    const handleStateChange = (event: YouTubePlayerStateChangeEvent) => {
      if (!window.YT) {
        return
      }

      if (event.data === window.YT.PlayerState.ENDED) {
        clipRef.current = null
        if (!hasPreviewClipConstraint(previewVideoRef.current)) {
          playFullVideo(event.target)
          return
        }
        playNextClip(event.target)
        return
      }

      if (event.data !== window.YT.PlayerState.PLAYING) {
        return
      }

      if (!clipRef.current) {
        if (hasPreviewClipConstraint(previewVideoRef.current)) {
          playNextClip(event.target)
        } else {
          const duration = getPlayableDuration(
            getReadyPlayerDuration(event.target, playerReadyRef.current),
          )
          const clip = {
            startSeconds: 0,
            playSeconds: duration,
          }
          clipRef.current = clip
          setActiveClip(clip)
        }
      }

      scheduleCoverHide()
    }

    loadYouTubeIframeApi().then(() => {
      if (cancelled || !window.YT || !playerHostRef.current) {
        return
      }

      if (playerRef.current) {
        callReadyPlayerMethod(
          playerRef.current,
          playerReadyRef.current,
          "playVideo",
        )
        return
      }

      playerReadyRef.current = false
      playerRef.current = new window.YT.Player(playerHostRef.current, {
        videoId,
        playerVars: getYouTubePlayerVars(previewVideoRef.current, {
          loop: !hasPreviewClipConstraint(previewVideoRef.current),
        }),
        events: {
          onReady: (event) => {
            if (cancelled) {
              callReadyPlayerMethod(event.target, true, "destroy")
              if (playerRef.current === event.target) {
                playerRef.current = null
                playerReadyRef.current = false
              }
              return
            }

            playerReadyRef.current = true
            callReadyPlayerMethod(event.target, true, "mute")
            callReadyPlayerMethod(event.target, true, "playVideo")
          },
          onStateChange: handleStateChange,
          onError: () => {
            clearCoverTimer()
            setIsCoverVisible(true)
          },
        },
      })
    })

    return () => {
      cancelled = true
      clearNextTimer()
      clearCoverTimer()
    }
  }, [shouldPlay, videoId])

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current)
      }
      if (coverTimerRef.current) {
        window.clearTimeout(coverTimerRef.current)
      }
      callReadyPlayerMethod(playerRef.current, playerReadyRef.current, "destroy")
      playerRef.current = null
      playerReadyRef.current = false
    }
  }, [])

  return (
    <>
      {shouldPlay ? (
        <div
          className={`featured-work-preview-media pointer-events-none absolute inset-0 h-full w-full rounded-none transition-opacity duration-[var(--motion-duration-press)] ease-[var(--ease-out-strong)] ${
            isPreviewReady ? "opacity-100" : "opacity-0"
          }`}
          aria-hidden="true"
          data-featured-work-preview-media={
            isPreviewReady ? "playing" : "preparing"
          }
          data-featured-work-current-video-id={videoId}
          data-featured-work-clip-start={activeClip?.startSeconds}
          data-featured-work-clip-seconds={activeClip?.playSeconds}
          data-featured-work-loop-start={loopStart}
          data-featured-work-loop-end={loopEnd}
          data-featured-work-clip-range-start={clipRangeStart}
          data-featured-work-clip-range-end={clipRangeEnd}
          data-featured-work-clip-exclude-start={clipExcludeStart}
          data-featured-work-clip-exclude-end={clipExcludeEnd}
        >
          <div
            ref={playerHostRef}
            title={`${title} preview`}
            className="h-full w-full"
          />
        </div>
      ) : null}
      <PreviewThumbnail videoId={videoId} isVisible={!isPreviewReady} />
      <VideoOpenButton
        label={`${title} の動画をモーダルで再生`}
        clone={clone}
        onOpen={(triggerElement) => {
          onOpenVideo(
            {
              videoId,
              label: `${title} の動画をモーダルで再生`,
            },
            triggerElement,
          )
        }}
      />
    </>
  )
}

function updateFeaturedWorkTilt(
  event: React.PointerEvent<HTMLDivElement>,
  prefersReducedMotion: boolean,
) {
  if (prefersReducedMotion) {
    return
  }

  const bounds = event.currentTarget.getBoundingClientRect()
  const x = Math.min(
    Math.max((event.clientX - bounds.left) / Math.max(bounds.width, 1), 0),
    1,
  )
  const y = Math.min(
    Math.max((event.clientY - bounds.top) / Math.max(bounds.height, 1), 0),
    1,
  )

  event.currentTarget.style.setProperty(
    "--featured-work-tilt-x",
    `${(0.5 - y) * 3}deg`,
  )
  event.currentTarget.style.setProperty(
    "--featured-work-tilt-y",
    `${(x - 0.5) * 3}deg`,
  )
}

function FeaturedWorkCard({
  work,
  shouldStartVideo,
  prefersReducedMotion,
  clone = false,
  segmentStart,
  onOpenVideo,
}: {
  work: FeaturedWork
  shouldStartVideo: boolean
  prefersReducedMotion: boolean
  clone?: boolean
  segmentStart?: "primary" | "clone-before" | "clone-after"
  onOpenVideo: (
    video: ActiveVideoModal,
    triggerElement: HTMLButtonElement,
  ) => void
}) {
  const [cardRef, isNearViewport] = useNearMarqueeViewport<HTMLDivElement>(
    shouldStartVideo && !prefersReducedMotion,
  )
  const shouldPlayVideo = shouldStartVideo && isNearViewport

  return (
    <div
      ref={cardRef}
      className="featured-work-transparent-card group flex shrink-0 flex-col overflow-hidden rounded-none p-4 md:p-5"
      aria-label={clone ? undefined : `${work.title} 作品カード`}
      data-featured-work-card={work.title}
      data-featured-work-video-near-viewport={isNearViewport ? "true" : "false"}
      data-featured-work-tilt={prefersReducedMotion ? "disabled" : "enabled"}
      data-featured-work-marquee-segment-start={segmentStart}
      onPointerMove={(event) => updateFeaturedWorkTilt(event, prefersReducedMotion)}
    >
      <div className="flex min-h-0 flex-1 flex-col">
        {work.youtubeId ? (
          <PreviewFrame>
            <VideoSurface
              videoId={work.youtubeId}
              loopStart={work.loopStart}
              loopEnd={work.loopEnd}
              clipRangeStart={work.clipRangeStart}
              clipRangeEnd={work.clipRangeEnd}
              clipExcludeStart={work.clipExcludeStart}
              clipExcludeEnd={work.clipExcludeEnd}
              title={work.title}
              isActive={shouldPlayVideo}
              prefersReducedMotion={prefersReducedMotion}
              clone={clone}
              onOpenVideo={onOpenVideo}
            />
          </PreviewFrame>
        ) : (
          <PreviewFrame abstractCover background={MARS_ABSTRACT_COVER_BACKGROUND}>
            <div className="absolute inset-0 z-10 flex flex-wrap content-end items-end justify-end gap-1.5 p-3 md:p-4">
              <WorkLinkBadges
                links={work.links}
                workTitle={work.title}
                clone={clone}
                layout="two-row"
              />
            </div>
          </PreviewFrame>
        )}
        <div className="featured-work-card-meta mt-4">
          <p className="text-sm font-semibold leading-snug text-hp md:text-[0.95rem]">
            {work.title}
          </p>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <p className="text-xs text-hp-muted md:text-sm">{work.client}</p>
            {work.youtubeId ? (
              <WorkLinkBadges
                links={work.links}
                workTitle={work.title}
                clone={clone}
                hideYouTube
              />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

function PlaylistWorkCard({
  work,
  shouldStartVideo,
  prefersReducedMotion,
  clone = false,
  segmentStart,
  onOpenVideo,
}: {
  work: FeaturedPlaylistWork
  shouldStartVideo: boolean
  prefersReducedMotion: boolean
  clone?: boolean
  segmentStart?: "primary" | "clone-before" | "clone-after"
  onOpenVideo: (
    video: ActiveVideoModal,
    triggerElement: HTMLButtonElement,
  ) => void
}) {
  const [cardRef, isNearViewport] = useNearMarqueeViewport<HTMLDivElement>(
    shouldStartVideo && !prefersReducedMotion,
  )
  const playerHostRef = useRef<HTMLDivElement | null>(null)
  const playerRef = useRef<YouTubePlayer | null>(null)
  const playerReadyRef = useRef(false)
  const queueRef = useRef<FeaturedWorkPreviewVideo[]>([])
  const clipRef = useRef<ClipWindow | null>(null)
  const timerRef = useRef<number | null>(null)
  const coverTimerRef = useRef<number | null>(null)
  const previewVideoRef = useRef<FeaturedWorkPreviewVideo>(work.videos[0])
  const [previewVideo, setPreviewVideo] = useState<FeaturedWorkPreviewVideo>(
    work.videos[0],
  )
  const [activeClip, setActiveClip] = useState<ClipWindow | null>(null)
  const [isCoverVisible, setIsCoverVisible] = useState(true)
  const playlistVideoIds = work.videos.map((video) => video.videoId).join(",")
  const shouldPlayVideo = shouldStartVideo && isNearViewport
  const isPreviewReady = !isCoverVisible

  useEffect(() => {
    previewVideoRef.current = previewVideo
  }, [previewVideo])

  useEffect(() => {
    const clearNextTimer = () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }

    const clearCoverTimer = () => {
      if (coverTimerRef.current) {
        window.clearTimeout(coverTimerRef.current)
        coverTimerRef.current = null
      }
    }

    const scheduleCoverHide = () => {
      clearCoverTimer()
      coverTimerRef.current = window.setTimeout(() => {
        setIsCoverVisible(false)
        coverTimerRef.current = null
      }, STARTUP_COVER_HOLD_MS)
    }

    if (!shouldPlayVideo || prefersReducedMotion) {
      clearNextTimer()
      clearCoverTimer()
      window.setTimeout(() => {
        setActiveClip(null)
        setIsCoverVisible(true)
      }, 0)
      stopAndDestroyPlayer(playerRef.current, playerReadyRef.current)
      playerRef.current = null
      playerReadyRef.current = false
      return
    }

    let cancelled = false

    const nextVideo = () => {
      if (queueRef.current.length === 0) {
        queueRef.current = shuffleVideoIds(
          work.videos,
          Math.random,
          previewVideoRef.current,
        )
      }
      return queueRef.current.shift() ?? work.videos[0]
    }

    const playNext = () => {
      const player = playerRef.current
      if (!player || !playerReadyRef.current) {
        return
      }
      clearNextTimer()
      clipRef.current = null
      setActiveClip(null)
      const video = nextVideo()
      previewVideoRef.current = video
      setPreviewVideo(video)
      clearCoverTimer()
      setIsCoverVisible(true)
      callReadyPlayerMethod(
        player,
        playerReadyRef.current,
        "loadVideoById",
        getYouTubeLoadVideoArg(video),
      )
    }

    const handleStateChange = (event: YouTubePlayerStateChangeEvent) => {
      if (!window.YT) {
        return
      }

      if (event.data === window.YT.PlayerState.ENDED) {
        const fixedClip = getFixedClipWindow(previewVideoRef.current)
        if (fixedClip) {
          callReadyPlayerMethod(
            event.target,
            playerReadyRef.current,
            "seekTo",
            fixedClip.startSeconds,
            true,
          )
          callReadyPlayerMethod(
            event.target,
            playerReadyRef.current,
            "playVideo",
          )
          return
        }
        playNext()
        return
      }

      if (event.data !== window.YT.PlayerState.PLAYING) {
        return
      }

      const player = event.target
      const existingClip = clipRef.current
      const fixedClip = getFixedClipWindow(previewVideoRef.current)
      const clip =
        existingClip ??
        fixedClip ??
        getPreviewClipWindow(
          previewVideoRef.current,
          getReadyPlayerDuration(player, playerReadyRef.current),
          Math.random,
          30,
        )
      clipRef.current = clip
      setActiveClip(clip)

      if (!existingClip && !fixedClip && clip.startSeconds > 0) {
        callReadyPlayerMethod(
          player,
          playerReadyRef.current,
          "seekTo",
          clip.startSeconds,
          true,
        )
      }

      scheduleCoverHide()
      clearNextTimer()
      timerRef.current = window.setTimeout(
        playNext,
        Math.max(1, clip.playSeconds) * 1000,
      )
    }

    loadYouTubeIframeApi().then(() => {
      if (cancelled || !window.YT || !playerHostRef.current) {
        return
      }

      if (playerRef.current) {
        callReadyPlayerMethod(
          playerRef.current,
          playerReadyRef.current,
          "playVideo",
        )
        return
      }

      playerReadyRef.current = false
      queueRef.current = shuffleVideoIds(work.videos)
      const firstVideo = nextVideo()
      previewVideoRef.current = firstVideo
      setPreviewVideo(firstVideo)
      clipRef.current = getFixedClipWindow(firstVideo)
      setIsCoverVisible(true)
      playerRef.current = new window.YT.Player(playerHostRef.current, {
        videoId: firstVideo.videoId,
        playerVars: getYouTubePlayerVars(firstVideo),
        events: {
          onReady: (event) => {
            if (cancelled) {
              callReadyPlayerMethod(event.target, true, "destroy")
              if (playerRef.current === event.target) {
                playerRef.current = null
                playerReadyRef.current = false
              }
              return
            }

            playerReadyRef.current = true
            callReadyPlayerMethod(event.target, true, "mute")
            callReadyPlayerMethod(event.target, true, "playVideo")
          },
          onStateChange: handleStateChange,
          onError: () => playNext(),
        },
      })
    })

    return () => {
      cancelled = true
      clearNextTimer()
      clearCoverTimer()
    }
  }, [prefersReducedMotion, shouldPlayVideo, work.videos])

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current)
      }
      if (coverTimerRef.current) {
        window.clearTimeout(coverTimerRef.current)
      }
      callReadyPlayerMethod(playerRef.current, playerReadyRef.current, "destroy")
      playerRef.current = null
      playerReadyRef.current = false
    }
  }, [])

  return (
    <div
      ref={cardRef}
      className="featured-work-transparent-card group flex shrink-0 flex-col overflow-hidden rounded-none p-4 md:p-5"
      aria-label={clone ? undefined : `${work.title}のランダムループ再生カード`}
      data-featured-work-card={work.title}
      data-featured-work-playlist-card={work.title}
      data-featured-work-playlist-video-count={work.videos.length}
      data-featured-work-playlist-video-ids={playlistVideoIds}
      data-featured-work-video-near-viewport={isNearViewport ? "true" : "false"}
      data-featured-work-tilt={prefersReducedMotion ? "disabled" : "enabled"}
      data-featured-work-marquee-segment-start={segmentStart}
      onPointerMove={(event) => updateFeaturedWorkTilt(event, prefersReducedMotion)}
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <PreviewFrame>
          {shouldPlayVideo && !prefersReducedMotion ? (
            <div
              className={`featured-work-preview-media pointer-events-none absolute inset-0 h-full w-full rounded-none transition-opacity duration-[var(--motion-duration-press)] ease-[var(--ease-out-strong)] ${
                isPreviewReady ? "opacity-100" : "opacity-0"
              }`}
              aria-hidden="true"
              data-featured-work-preview-media={
                isPreviewReady ? "playing" : "preparing"
              }
              data-featured-work-current-video-id={previewVideo.videoId}
              data-featured-work-clip-start={activeClip?.startSeconds}
              data-featured-work-clip-seconds={activeClip?.playSeconds}
              data-featured-work-loop-start={previewVideo.loopStart}
              data-featured-work-loop-end={previewVideo.loopEnd}
              data-featured-work-clip-range-start={previewVideo.clipRangeStart}
              data-featured-work-clip-range-end={previewVideo.clipRangeEnd}
              data-featured-work-clip-exclude-start={previewVideo.clipExcludeStart}
              data-featured-work-clip-exclude-end={previewVideo.clipExcludeEnd}
            >
              <div ref={playerHostRef} className="h-full w-full" />
            </div>
          ) : null}
          <PreviewThumbnail
            videoId={previewVideo.videoId}
            isVisible={!isPreviewReady}
          />
          <VideoOpenButton
            label={`${work.title}をモーダルで再生`}
            clone={clone}
            onOpen={(triggerElement) => {
              onOpenVideo(
                {
                  videoId: previewVideo.videoId,
                  label: `${work.title}をモーダルで再生`,
                },
                triggerElement,
              )
            }}
          />
        </PreviewFrame>
        <div className="featured-work-card-meta mt-4">
          <p className="text-sm font-semibold leading-snug text-hp md:text-[0.95rem]">
            {work.title}
          </p>
          {work.client ? (
            <p className="mt-3 text-xs text-hp-muted md:text-sm">{work.client}</p>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export function FeaturedWorks() {
  const prefersReducedMotion = usePrefersReducedMotion()
  const marqueeViewportId = useId()
  const [marqueeRef, hasEnteredViewport] = useHasEnteredViewport<HTMLDivElement>()
  const [activeVideo, setActiveVideo] = useState<ActiveVideoModal | null>(null)
  const progressTrackRef = useRef<HTMLDivElement | null>(null)
  const progressThumbRef = useRef<HTMLDivElement | null>(null)
  const videoTriggerRef = useRef<HTMLElement | null>(null)
  const shouldRenderCloneTrack = !prefersReducedMotion
  useScrollableMarquee(
    marqueeRef,
    progressTrackRef,
    progressThumbRef,
    shouldRenderCloneTrack,
  )

  const openVideo = useCallback(
    (video: ActiveVideoModal, triggerElement: HTMLButtonElement) => {
      videoTriggerRef.current = triggerElement
      setActiveVideo(video)
    },
    [],
  )

  const closeVideo = useCallback(() => {
    setActiveVideo(null)
  }, [])

  const renderCards = (
    clone = false,
    segmentStart?: "primary" | "clone-before" | "clone-after",
  ) => (
    <>
      {FEATURED_WORKS.map((work, index) => (
        <FeaturedWorkCard
          key={`${clone ? "clone" : "primary"}-${work.youtubeId ?? work.officialUrl}`}
          work={work}
          shouldStartVideo={hasEnteredViewport}
          prefersReducedMotion={prefersReducedMotion}
          clone={clone}
          segmentStart={index === 0 ? segmentStart : undefined}
          onOpenVideo={openVideo}
        />
      ))}
      {FEATURED_PLAYLIST_WORKS.map((work) => (
        <PlaylistWorkCard
          key={`${clone ? "clone" : "primary"}-${work.title}`}
          work={work}
          shouldStartVideo={hasEnteredViewport}
          prefersReducedMotion={prefersReducedMotion}
          clone={clone}
          onOpenVideo={openVideo}
        />
      ))}
    </>
  )

  return (
    <div className="hp-featured-works-block">
      <style>{`
        .featured-work-transparent-card {
          --featured-work-tilt-x: 0deg;
          --featured-work-tilt-y: 0deg;
          box-shadow: none;
          isolation: isolate;
          outline: 1px solid transparent;
          outline-offset: -1px;
          position: relative;
          transition:
            outline-color 150ms var(--ease-out-strong),
            box-shadow 150ms var(--ease-out-strong),
            transform var(--motion-duration-press) var(--ease-out-strong);
          width: min(72vw, 260px);
        }

        .featured-work-transparent-card:is(:hover, :focus-within) {
          box-shadow: var(--hp-shadow-soft);
          outline-color: var(--glass-border);
          transform: perspective(800px) rotateX(var(--featured-work-tilt-x)) rotateY(var(--featured-work-tilt-y));
        }

        .featured-work-transparent-card:active {
          transform: scale(0.985);
        }

        .featured-work-transparent-card:hover:active {
          transform: perspective(800px) rotateX(var(--featured-work-tilt-x)) rotateY(var(--featured-work-tilt-y)) scale(0.985);
        }

        @media (min-width: 1280px) {
          .featured-work-transparent-card {
            width: 390px;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .featured-work-transparent-card {
            transition: none;
          }

          .featured-work-transparent-card:active {
            transform: none;
          }
        }

        [data-featured-work-marquee-segment] {
          display: contents;
        }

        [data-featured-work-native-scrollbar="hidden"] {
          scrollbar-width: none;
        }

        [data-featured-work-native-scrollbar="hidden"]::-webkit-scrollbar {
          display: none;
        }

        @media (prefers-reduced-motion: reduce) {
          [data-featured-work-marquee-viewport="true"] {
            overflow-x: auto;
            scrollbar-width: auto;
          }

          [data-featured-work-marquee-viewport="true"]::-webkit-scrollbar {
            display: initial;
          }
        }
      `}</style>
      <div className="hp-grid">
        <p className="hp-section-heading text-xs uppercase tracking-[0.22em] text-hp-muted">
          Featured Works
        </p>
      </div>

      <div
        className="relative mt-6 -mx-8 md:-mx-10 xl:-mx-12"
        data-featured-work-marquee-shell
      >
        <div
          id={marqueeViewportId}
          ref={marqueeRef}
          className="featured-work-content-viewport relative overflow-x-auto overflow-y-hidden pb-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-primary)]"
          aria-label="Featured Works"
          tabIndex={0}
          data-featured-work-marquee-viewport="true"
          data-featured-work-native-scrollbar={
            shouldRenderCloneTrack ? "hidden" : undefined
          }
        >
          <div
            className="relative flex w-max gap-0 px-8 pb-4 md:px-10 xl:px-12"
            data-featured-work-marquee-track="continuous"
          >
            {shouldRenderCloneTrack ? (
              <div
                className="contents"
                aria-hidden="true"
                data-featured-work-marquee-segment="clone"
                data-featured-work-marquee-clone-position="before"
              >
                {renderCards(true, "clone-before")}
              </div>
            ) : null}
            <div
              className="contents"
              data-featured-work-marquee-segment="primary"
            >
              {renderCards(false, "primary")}
            </div>
            {shouldRenderCloneTrack ? (
              <div
                className="contents"
                aria-hidden="true"
                data-featured-work-marquee-segment="clone"
                data-featured-work-marquee-clone-position="after"
              >
                {renderCards(true, "clone-after")}
              </div>
            ) : null}
          </div>
        </div>
        {shouldRenderCloneTrack ? (
          <div
            ref={progressTrackRef}
            className="h-1 w-full cursor-pointer overflow-hidden rounded-full bg-white/60"
            data-featured-work-marquee-progress-track="true"
          >
            <div
              ref={progressThumbRef}
              className="h-full touch-none rounded-full bg-[var(--accent-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-primary)]"
              role="scrollbar"
              tabIndex={0}
              aria-label="Featured Works scrollbar"
              aria-controls={marqueeViewportId}
              aria-orientation="horizontal"
              aria-valuemin={0}
              aria-valuemax={1000}
              aria-valuenow={0}
              data-featured-work-marquee-progress-thumb="true"
            />
          </div>
        ) : null}
      </div>
      <FeaturedWorkVideoDialog
        activeVideo={activeVideo}
        triggerElementRef={videoTriggerRef}
        onClose={closeVideo}
      />
    </div>
  )
}
