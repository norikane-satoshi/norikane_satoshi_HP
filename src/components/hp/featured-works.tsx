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
} from "@/components/hp/featured-works-data"

type YouTubePlayerStateChangeEvent = {
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
const CINEMASCOPE_ASPECT_RATIO = "2.39 / 1"
const YOUTUBE_CHROME_CROP_SCALE = 2.2
const YOUTUBE_NATIVE_WIDTH_IN_CINEMASCOPE_FRAME = "calc(100% * 16 / 9 / 2.39)"

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

function buildPreviewEmbedUrl(videoId: string) {
  const params = new URLSearchParams({
    mute: "1",
    autoplay: "1",
    controls: "0",
    loop: "1",
    playlist: videoId,
    playsinline: "1",
    modestbranding: "1",
    disablekb: "1",
    rel: "0",
  })
  return `https://www.youtube.com/embed/${videoId}?${params.toString()}`
}

function PreviewCropFrame({ children }: { children: ReactNode }) {
  return (
    <div
      className="relative overflow-hidden rounded-[12px] border border-white/55 bg-white/35"
      style={{ aspectRatio: CINEMASCOPE_ASPECT_RATIO }}
      data-featured-work-preview-crop="cinemascope"
    >
      {children}
    </div>
  )
}

function ScaledYouTubeFrame({ children }: { children: ReactNode }) {
  return (
    <div
      className="pointer-events-none absolute left-1/2 top-1/2 h-full max-w-none"
      style={{
        width: YOUTUBE_NATIVE_WIDTH_IN_CINEMASCOPE_FRAME,
        aspectRatio: "16 / 9",
        transform: `translate(-50%, -50%) scale(${YOUTUBE_CHROME_CROP_SCALE})`,
      }}
      data-featured-work-preview-media="youtube-scale"
    >
      {children}
    </div>
  )
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
  if (!isActive || prefersReducedMotion) {
    return (
      <img
        src={getYouTubeThumbnailUrl(videoId)}
        alt=""
        className="h-full w-full object-cover"
        loading="lazy"
        decoding="async"
      />
    )
  }

  return (
    <ScaledYouTubeFrame>
      <iframe
        title={`${title} preview`}
        src={buildPreviewEmbedUrl(videoId)}
        className="h-full w-full"
        allow="autoplay; encrypted-media; picture-in-picture"
        referrerPolicy="strict-origin-when-cross-origin"
        tabIndex={-1}
        aria-hidden="true"
      />
    </ScaledYouTubeFrame>
  )
}

function FeaturedWorkCard({
  work,
  prefersReducedMotion,
}: {
  work: FeaturedWork
  prefersReducedMotion: boolean
}) {
  const [cardRef, isInViewport] = useInViewport<HTMLAnchorElement>()

  return (
    <a
      ref={cardRef}
      href={work.officialUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex shrink-0 snap-start flex-col glass-card-sm p-4 transition-transform hover:-translate-y-0.5 md:p-5"
      style={{ width: "min(72vw, 260px)" }}
      aria-label={`${work.title} 公式ページを新しいタブで開く`}
    >
      <PreviewCropFrame>
        <VideoSurface
          videoId={work.youtubeId}
          title={work.title}
          isActive={isInViewport}
          prefersReducedMotion={prefersReducedMotion}
        />
      </PreviewCropFrame>
      <p className="mt-4 text-sm font-semibold leading-snug text-hp md:text-[0.95rem]">
        {work.title}
      </p>
      <p className="mt-auto pt-3 text-xs text-hp-muted md:text-sm">{work.client}</p>
    </a>
  )
}

function LiveReelCard({ prefersReducedMotion }: { prefersReducedMotion: boolean }) {
  const [cardRef, isInViewport] = useInViewport<HTMLDivElement>()
  const playerHostRef = useRef<HTMLDivElement | null>(null)
  const playerRef = useRef<YouTubePlayer | null>(null)
  const queueRef = useRef<string[]>([])
  const clipRef = useRef<ClipWindow | null>(null)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    if (!isInViewport || prefersReducedMotion) {
      playerRef.current?.stopVideo()
      if (timerRef.current) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
      }
      return
    }

    let cancelled = false

    const clearNextTimer = () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }

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
      player.loadVideoById(nextVideoId())
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
      const clip =
        existingClip ?? calculateClipWindow(player.getDuration(), Math.random, 30)
      clipRef.current = clip

      if (!existingClip && clip.startSeconds > 0) {
        player.seekTo(clip.startSeconds, true)
      }

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
      playerRef.current = new window.YT.Player(playerHostRef.current, {
        videoId: firstVideoId,
        playerVars: {
          autoplay: 1,
          controls: 0,
          disablekb: 1,
          modestbranding: 1,
          playsinline: 1,
          rel: 0,
        },
        events: {
          onReady: (event) => {
            event.target.mute()
            event.target.playVideo()
          },
          onStateChange: handleStateChange,
        },
      })
    })

    return () => {
      cancelled = true
      clearNextTimer()
    }
  }, [isInViewport, prefersReducedMotion])

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current)
      }
      playerRef.current?.destroy()
    }
  }, [])

  return (
    <div
      ref={cardRef}
      className="flex shrink-0 snap-start flex-col glass-card-sm p-4 md:p-5"
      style={{ width: "min(72vw, 260px)" }}
      aria-label="ライブ映像作品多数のランダムループ再生カード"
    >
      <PreviewCropFrame>
        {!isInViewport || prefersReducedMotion ? (
          <img
            src={getYouTubeThumbnailUrl(LIVE_REEL_VIDEO_IDS[0])}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
            decoding="async"
          />
        ) : (
          <ScaledYouTubeFrame>
            <div ref={playerHostRef} className="h-full w-full" />
          </ScaledYouTubeFrame>
        )}
      </PreviewCropFrame>
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
              key={work.youtubeId}
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
