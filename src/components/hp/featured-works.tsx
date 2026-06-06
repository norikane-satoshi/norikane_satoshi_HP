"use client"

/* eslint-disable @next/next/no-img-element */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react"
import { createPortal } from "react-dom"
import { X } from "lucide-react"
import {
  FEATURED_WORKS,
  LIVE_REEL_VIDEO_IDS,
  calculateClipWindow,
  getYouTubeThumbnailUrl,
  shuffleVideoIds,
  type ClipWindow,
  type FeaturedWork,
  type FeaturedWorkLink,
} from "@/components/hp/featured-works-data"
import { MARS_ABSTRACT_COVER_BACKGROUND } from "@/components/hp/hero-deep-surface"

type YouTubePlayerStateChangeEvent = {
  data: number
  target: YouTubePlayer
}

type YouTubePlayerErrorEvent = {
  data: number
  target: YouTubePlayer
}

type YouTubePlayer = {
  mute: () => void
  playVideo: () => void
  stopVideo: () => void
  destroy: () => void
  getDuration: () => number
  seekTo: (seconds: number, allowSeekAhead: boolean) => void
  loadVideoById: (videoId: string | { videoId: string; startSeconds?: number }) => void
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

let youtubeApiPromise: Promise<void> | null = null
const STARTUP_COVER_HOLD_MS = 900
const MARQUEE_LOOP_SECONDS = 72
const MARQUEE_INPUT_IDLE_MS = 1300
const MARQUEE_PROGRESS_MIN_THUMB_WIDTH = 44
const VIDEO_OPEN_DRAG_THRESHOLD_PX = 8

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

  if (window.YT?.Player) {
    return Promise.resolve()
  }

  youtubeApiPromise ??= new Promise((resolve) => {
    const previousReady = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      previousReady?.()
      resolve()
    }

    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const script = document.createElement("script")
      script.src = "https://www.youtube.com/iframe_api"
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

    const setState = (state: "running" | "paused") => {
      viewport.dataset.featuredWorkMarqueeState = state
    }

    const syncProgressBar = () => {
      const progressTrack = progressTrackRef.current
      const progressThumb = progressThumbRef.current
      if (!progressTrack || !progressThumb) {
        return
      }

      const geometry = getFeaturedWorkMarqueeProgressBarGeometry({
        virtualScrollLeft,
        metrics,
        viewportWidth: viewport.clientWidth,
        trackWidth: progressTrack.clientWidth,
      })
      progressThumb.style.width = `${geometry.thumbWidth}px`
      progressThumb.style.transform = `translate3d(${geometry.thumbTranslateX}px, 0, 0)`
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

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === "ArrowLeft" ||
        event.key === "ArrowRight" ||
        event.key === "Home" ||
        event.key === "End"
      ) {
        pauseForInput()
      }
    }

    const handleScroll = () => {
      if (metrics) {
        virtualScrollLeft = viewport.scrollLeft
        virtualScrollLeft = normalizeMarqueeScrollLeft(viewport, metrics)
        syncProgressBar()
      }
    }

    syncMetrics()
    viewport.dataset.featuredWorkMarqueeIdleMs = String(MARQUEE_INPUT_IDLE_MS)
    viewport.addEventListener("wheel", pauseForInput, { passive: true })
    viewport.addEventListener("touchstart", pauseForInput, { passive: true })
    viewport.addEventListener("pointerdown", pauseForInput, { passive: true })
    viewport.addEventListener("keydown", handleKeyDown)
    viewport.addEventListener("scroll", handleScroll, { passive: true })
    window.addEventListener("resize", syncMetrics)
    animationFrame = window.requestAnimationFrame(step)

    return () => {
      window.cancelAnimationFrame(animationFrame)
      viewport.removeEventListener("wheel", pauseForInput)
      viewport.removeEventListener("touchstart", pauseForInput)
      viewport.removeEventListener("pointerdown", pauseForInput)
      viewport.removeEventListener("keydown", handleKeyDown)
      viewport.removeEventListener("scroll", handleScroll)
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
  return (
    <img
      src={getYouTubeThumbnailUrl(videoId)}
      alt=""
      className={`pointer-events-none absolute inset-0 z-20 h-full w-full rounded-none object-cover transition-opacity duration-300 ${
        isVisible ? "opacity-100" : "opacity-0"
      }`}
      loading="lazy"
      decoding="async"
      data-featured-work-preview-thumbnail={isVisible ? "visible" : "hidden"}
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
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[rgba(8,4,24,0.42)] p-4 md:p-8"
      style={{
        right: "var(--chatbot-side-peek-occupied-width, 0px)",
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

function getYouTubePlayerVars(videoId?: string) {
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
    ...(videoId ? { loop: 1, playlist: videoId } : {}),
  }
}

function VideoSurface({
  videoId,
  title,
  isActive,
  prefersReducedMotion,
  clone,
  onOpenVideo,
}: {
  videoId: string
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
  const coverTimerRef = useRef<number | null>(null)
  const [isCoverVisible, setIsCoverVisible] = useState(true)
  const shouldPlay = isActive && !prefersReducedMotion

  useEffect(() => {
    const clearCoverTimer = () => {
      if (coverTimerRef.current) {
        window.clearTimeout(coverTimerRef.current)
        coverTimerRef.current = null
      }
    }

    if (!shouldPlay) {
      clearCoverTimer()
      window.setTimeout(() => setIsCoverVisible(true), 0)
      playerRef.current?.stopVideo()
      return
    }

    let cancelled = false

    const handleStateChange = (event: YouTubePlayerStateChangeEvent) => {
      if (!window.YT || event.data !== window.YT.PlayerState.PLAYING) {
        return
      }
      clearCoverTimer()
      coverTimerRef.current = window.setTimeout(() => {
        setIsCoverVisible(false)
        coverTimerRef.current = null
      }, STARTUP_COVER_HOLD_MS)
    }

    loadYouTubeIframeApi().then(() => {
      if (cancelled || !window.YT || !playerHostRef.current) {
        return
      }

      if (playerRef.current) {
        playerRef.current.playVideo()
        return
      }

      playerRef.current = new window.YT.Player(playerHostRef.current, {
        videoId,
        playerVars: getYouTubePlayerVars(videoId),
        events: {
          onReady: (event) => {
            event.target.mute()
            event.target.playVideo()
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
      clearCoverTimer()
    }
  }, [shouldPlay, videoId])

  useEffect(() => {
    return () => {
      if (coverTimerRef.current) {
        window.clearTimeout(coverTimerRef.current)
      }
      playerRef.current?.destroy()
    }
  }, [])

  return (
    <>
      {shouldPlay ? (
        <div
          className={`pointer-events-none absolute inset-0 h-full w-full rounded-none transition-opacity duration-300 ${
            isCoverVisible ? "opacity-0" : "opacity-100"
          }`}
          aria-hidden="true"
          data-featured-work-preview-media={isCoverVisible ? "preparing" : "playing"}
        >
          <div
            ref={playerHostRef}
            title={`${title} preview`}
            className="h-full w-full"
          />
        </div>
      ) : null}
      <PreviewThumbnail videoId={videoId} isVisible={isCoverVisible} />
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
  return (
    <div
      className="featured-work-transparent-card group flex shrink-0 flex-col overflow-hidden rounded-none p-4 transition-transform hover:-translate-y-0.5 md:p-5"
      style={{ width: "min(72vw, 260px)" }}
      aria-label={clone ? undefined : `${work.title} 作品カード`}
      data-featured-work-card={work.title}
      data-featured-work-marquee-segment-start={segmentStart}
    >
      <div className="flex min-h-0 flex-1 flex-col">
        {work.youtubeId ? (
          <PreviewFrame>
            <VideoSurface
              videoId={work.youtubeId}
              title={work.title}
              isActive={shouldStartVideo}
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
        <p className="mt-4 text-sm font-semibold leading-snug text-hp md:text-[0.95rem]">
          {work.title}
        </p>
        <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-2 pt-3">
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
  )
}

function LiveReelCard({
  shouldStartVideo,
  prefersReducedMotion,
  clone = false,
  segmentStart,
  onOpenVideo,
}: {
  shouldStartVideo: boolean
  prefersReducedMotion: boolean
  clone?: boolean
  segmentStart?: "primary" | "clone-before" | "clone-after"
  onOpenVideo: (
    video: ActiveVideoModal,
    triggerElement: HTMLButtonElement,
  ) => void
}) {
  const playerHostRef = useRef<HTMLDivElement | null>(null)
  const playerRef = useRef<YouTubePlayer | null>(null)
  const queueRef = useRef<string[]>([])
  const clipRef = useRef<ClipWindow | null>(null)
  const timerRef = useRef<number | null>(null)
  const coverTimerRef = useRef<number | null>(null)
  const [previewVideoId, setPreviewVideoId] = useState<string>(LIVE_REEL_VIDEO_IDS[0])
  const [isCoverVisible, setIsCoverVisible] = useState(true)

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

    if (!shouldStartVideo || prefersReducedMotion) {
      clearNextTimer()
      clearCoverTimer()
      window.setTimeout(() => setIsCoverVisible(true), 0)
      playerRef.current?.stopVideo()
      return
    }

    let cancelled = false

    const nextVideoId = () => {
      if (queueRef.current.length === 0) {
        queueRef.current = shuffleVideoIds(LIVE_REEL_VIDEO_IDS)
      }
      return queueRef.current.shift() ?? LIVE_REEL_VIDEO_IDS[0]
    }

    const playNext = () => {
      const player = playerRef.current
      if (!player) {
        return
      }
      clearNextTimer()
      clipRef.current = null
      const videoId = nextVideoId()
      setPreviewVideoId(videoId)
      clearCoverTimer()
      setIsCoverVisible(true)
      player.loadVideoById(videoId)
    }

    const handleStateChange = (event: YouTubePlayerStateChangeEvent) => {
      if (!window.YT) {
        return
      }

      if (event.data === window.YT.PlayerState.ENDED) {
        playNext()
        return
      }

      if (event.data !== window.YT.PlayerState.PLAYING) {
        return
      }

      const player = event.target
      const existingClip = clipRef.current
      const duration = player.getDuration()
      const playableDuration = Number.isFinite(duration) ? Math.max(duration, 30) : 30
      const clip =
        existingClip ??
        calculateClipWindow(playableDuration, Math.random, 30)
      clipRef.current = clip

      if (!existingClip && clip.startSeconds > 0) {
        player.seekTo(clip.startSeconds, true)
      }

      clearCoverTimer()
      coverTimerRef.current = window.setTimeout(() => {
        setIsCoverVisible(false)
        coverTimerRef.current = null
      }, STARTUP_COVER_HOLD_MS)
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
        playerRef.current.playVideo()
        return
      }

      queueRef.current = shuffleVideoIds(LIVE_REEL_VIDEO_IDS)
      const firstVideoId = nextVideoId()
      setPreviewVideoId(firstVideoId)
      setIsCoverVisible(true)
      playerRef.current = new window.YT.Player(playerHostRef.current, {
        videoId: firstVideoId,
        playerVars: getYouTubePlayerVars(),
        events: {
          onReady: (event) => {
            event.target.mute()
            event.target.playVideo()
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
  }, [shouldStartVideo, prefersReducedMotion])

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current)
      }
      if (coverTimerRef.current) {
        window.clearTimeout(coverTimerRef.current)
      }
      playerRef.current?.destroy()
    }
  }, [])

  return (
    <div
      className="featured-work-transparent-card flex shrink-0 flex-col overflow-hidden rounded-none p-4 md:p-5"
      style={{ width: "min(72vw, 260px)" }}
      aria-label={clone ? undefined : "ライブ映像作品多数のランダムループ再生カード"}
      data-featured-work-marquee-segment-start={segmentStart}
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <PreviewFrame>
          {shouldStartVideo && !prefersReducedMotion ? (
            <div
              className={`pointer-events-none absolute inset-0 h-full w-full rounded-none transition-opacity duration-300 ${
                isCoverVisible ? "opacity-0" : "opacity-100"
              }`}
              aria-hidden="true"
              data-featured-work-preview-media={isCoverVisible ? "preparing" : "playing"}
              data-featured-work-live-current-video-id={previewVideoId}
            >
              <div ref={playerHostRef} className="h-full w-full" />
            </div>
          ) : null}
          <PreviewThumbnail videoId={previewVideoId} isVisible={isCoverVisible} />
          <VideoOpenButton
            label="ライブ映像作品をモーダルで再生"
            clone={clone}
            onOpen={(triggerElement) => {
              onOpenVideo(
                {
                  videoId: previewVideoId,
                  label: "ライブ映像作品をモーダルで再生",
                },
                triggerElement,
              )
            }}
          />
        </PreviewFrame>
        <p className="mt-4 text-sm font-semibold leading-snug text-hp md:text-[0.95rem]">
          ライブ映像作品多数
        </p>
        <p className="mt-auto pt-3 text-xs text-hp-muted md:text-sm">配信</p>
      </div>
    </div>
  )
}

export function FeaturedWorks() {
  const prefersReducedMotion = usePrefersReducedMotion()
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
      <LiveReelCard
        shouldStartVideo={hasEnteredViewport}
        prefersReducedMotion={prefersReducedMotion}
        clone={clone}
        onOpenVideo={openVideo}
      />
    </>
  )

  return (
    <div className="mt-10 md:mt-12">
      <style>{`
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
      <p className="text-xs uppercase tracking-[0.22em] text-hp-muted">
        Featured Works
      </p>

      <div
        className="relative mt-6 -mx-8 md:-mx-10 xl:-mx-12"
        data-featured-work-marquee-shell
      >
        <div
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
            className="h-1 w-full overflow-hidden rounded-full bg-white/60"
            aria-hidden="true"
            data-featured-work-marquee-progress-track="true"
          >
            <div
              ref={progressThumbRef}
              className="h-full rounded-full bg-[var(--accent-primary)]"
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
