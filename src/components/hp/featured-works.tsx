"use client"

/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, useState, type ReactNode } from "react"
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

function useInViewport<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const [isInViewport, setIsInViewport] = useState(
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
      ([entry]) => setIsInViewport(entry.isIntersecting),
      { rootMargin: "160px 0px", threshold: 0.18 },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return [ref, isInViewport] as const
}

function PreviewFrame({
  children,
  abstractCover = false,
}: {
  children: ReactNode
  abstractCover?: boolean
}) {
  return (
    <div
      className="relative -mx-4 -mt-4 aspect-video overflow-hidden rounded-t-[12px] md:-mx-5 md:-mt-5"
      data-featured-work-abstract-cover={abstractCover ? "true" : undefined}
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
}: {
  links: FeaturedWorkLink[]
  workTitle: string
}) {
  return (
    <div
      className="flex flex-wrap justify-end gap-1.5"
      data-featured-work-link-badges="inline"
    >
      {links.map((link) => (
        <a
          key={`${link.label}:${link.url}`}
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          className="glass-badge px-2.5 py-1 text-[0.64rem] leading-none transition-colors hover:bg-white/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-primary)]"
          aria-label={`${workTitle} ${link.label}を新しいタブで開く`}
          data-featured-work-link-badge={link.label}
        >
          {link.label}
        </a>
      ))}
    </div>
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
}: {
  videoId: string
  title: string
  isActive: boolean
  prefersReducedMotion: boolean
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
    </>
  )
}

function FeaturedWorkCard({
  work,
  prefersReducedMotion,
}: {
  work: FeaturedWork
  prefersReducedMotion: boolean
}) {
  const [cardRef, isInViewport] = useInViewport<HTMLDivElement>()

  return (
    <div
      ref={cardRef}
      className="group flex shrink-0 snap-start flex-col overflow-hidden glass-card-sm p-4 transition-transform hover:-translate-y-0.5 md:p-5"
      style={{ width: "min(72vw, 260px)" }}
      aria-label={`${work.title} 代表作品カード`}
      data-featured-work-card={work.title}
    >
      {work.youtubeId ? (
        <PreviewFrame>
          <VideoSurface
            videoId={work.youtubeId}
            title={work.title}
            isActive={isInViewport}
            prefersReducedMotion={prefersReducedMotion}
          />
        </PreviewFrame>
      ) : (
        <PreviewFrame abstractCover>
          <div className="absolute inset-0 bg-[radial-gradient(130%_130%_at_18%_12%,#C9BCFF_0%,var(--accent-primary)_48%,#3B2A9E_100%)]" />
          <div className="absolute inset-0 bg-[radial-gradient(90%_90%_at_86%_84%,rgba(121,199,199,0.42)_0%,rgba(255,255,255,0)_62%)]" />
          <div className="absolute inset-0 z-10 flex flex-wrap content-end items-end justify-end gap-1.5 p-3 md:p-4">
            <WorkLinkBadges links={work.links} workTitle={work.title} />
          </div>
        </PreviewFrame>
      )}
      <p className="mt-4 text-sm font-semibold leading-snug text-hp md:text-[0.95rem]">
        {work.title}
      </p>
      <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-2 pt-3">
        <p className="text-xs text-hp-muted md:text-sm">{work.client}</p>
        {work.youtubeId ? (
          <WorkLinkBadges links={work.links} workTitle={work.title} />
        ) : null}
      </div>
    </div>
  )
}

function LiveReelCard({ prefersReducedMotion }: { prefersReducedMotion: boolean }) {
  const [cardRef, isInViewport] = useInViewport<HTMLDivElement>()
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

    if (!isInViewport || prefersReducedMotion) {
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
  }, [isInViewport, prefersReducedMotion])

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
      ref={cardRef}
      className="flex shrink-0 snap-start flex-col overflow-hidden glass-card-sm p-4 md:p-5"
      style={{ width: "min(72vw, 260px)" }}
      aria-label="ライブ映像作品多数のランダムループ再生カード"
    >
      <PreviewFrame>
        {isInViewport && !prefersReducedMotion ? (
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
      </PreviewFrame>
      <p className="mt-4 text-sm font-semibold leading-snug text-hp md:text-[0.95rem]">
        ライブ映像作品多数
      </p>
      <p className="mt-auto pt-3 text-xs text-hp-muted md:text-sm">配信</p>
    </div>
  )
}

export function FeaturedWorks() {
  const prefersReducedMotion = usePrefersReducedMotion()

  return (
    <div className="mt-10 md:mt-12">
      <p className="text-xs uppercase tracking-[0.22em] text-hp-muted">
        Featured Works
      </p>
      <h3 className="mt-2 text-base font-semibold text-hp md:text-lg">代表作品</h3>

      <div className="mt-6 -mx-8 overflow-x-auto md:-mx-10 xl:-mx-12">
        <div className="flex snap-x snap-mandatory gap-4 px-8 pb-4 md:gap-5 md:px-10 xl:px-12">
          {FEATURED_WORKS.map((work) => (
            <FeaturedWorkCard
              key={work.youtubeId ?? work.officialUrl}
              work={work}
              prefersReducedMotion={prefersReducedMotion}
            />
          ))}
          <LiveReelCard prefersReducedMotion={prefersReducedMotion} />
        </div>
      </div>
    </div>
  )
}
