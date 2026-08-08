"use client"

import { useEffect, useId, useRef, useState } from "react"

type RegularWork = {
  kind: "regular"
  title: string
  client: string
  officialUrl: string
  videoId: string
}

type LiveWork = {
  kind: "live"
  title: string
  client: string
  videoIds: string[]
}

export type FeaturedWork = RegularWork | LiveWork

type YoutubePlayer = {
  destroy: () => void
  getDuration: () => number
  loadVideoById: (args: {
    videoId: string
    startSeconds?: number
    endSeconds?: number
  }) => void
  mute: () => void
  seekTo: (seconds: number, allowSeekAhead: boolean) => void
}

type YoutubePlayerConstructor = new (
  elementId: string,
  options: {
    width: string
    height: string
    playerVars: Record<string, number | string>
    videoId?: string
    host?: string
    events: {
      onReady: () => void
      onStateChange: (event: { data: number }) => void
      onError?: () => void
    }
  },
) => YoutubePlayer

declare global {
  interface Window {
    YT?: {
      Player: YoutubePlayerConstructor
      PlayerState: { ENDED: number; PLAYING: number }
    }
    onYouTubeIframeAPIReady?: () => void
  }
}

export const YOUTUBE_CROP_CLASSNAME =
  "relative aspect-[239/100] w-full overflow-hidden rounded-[16px] bg-white/40"
export const YOUTUBE_FRAME_STYLE = {
  transform: "translate(-50%, -50%) scale(1.36)",
} as const

const LIVE_SEGMENT_SECONDS = 30
const YOUTUBE_API_SRC = "https://www.youtube.com/iframe_api"

const playerVars = {
  autoplay: 1,
  controls: 0,
  disablekb: 1,
  fs: 0,
  iv_load_policy: 3,
  modestbranding: 1,
  mute: 1,
  playsinline: 1,
  rel: 0,
}

const regularPlayerVars = {
  ...playerVars,
  loop: 1,
}

export function buildEmbedUrl(videoId: string) {
  const params = new URLSearchParams({
    autoplay: "1",
    controls: "0",
    disablekb: "1",
    fs: "0",
    iv_load_policy: "3",
    loop: "1",
    modestbranding: "1",
    mute: "1",
    playlist: videoId,
    playsinline: "1",
    rel: "0",
  })

  return `https://www.youtube-nocookie.com/embed/${videoId}?${params.toString()}`
}

function shuffle<T>(items: readonly T[]) {
  const shuffled = [...items]
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1))
    ;[shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]]
  }
  return shuffled
}

function ensureYoutubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT)

  return new Promise<NonNullable<typeof window.YT>>((resolve) => {
    const previousReady = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      previousReady?.()
      if (window.YT) resolve(window.YT)
    }

    if (!document.querySelector(`script[src="${YOUTUBE_API_SRC}"]`)) {
      const script = document.createElement("script")
      script.src = YOUTUBE_API_SRC
      script.async = true
      document.head.appendChild(script)
    }
  })
}

function YoutubeCrop({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={YOUTUBE_CROP_CLASSNAME}
      data-testid="featured-work-youtube-crop"
    >
      <div
        className="absolute left-1/2 top-1/2 aspect-video w-full origin-center"
        data-testid="featured-work-youtube-frame"
        style={YOUTUBE_FRAME_STYLE}
      >
        {children}
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-white/45 to-transparent" />
    </div>
  )
}

function PreviewFallback({ title }: { title: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-white/50 px-4 text-center">
      <span className="text-xs font-semibold leading-relaxed text-hp md:text-sm">
        {title}
      </span>
    </div>
  )
}

function RegularYoutubePreview({ videoId, title }: { videoId: string; title: string }) {
  const playerId = useId().replaceAll(":", "")
  const playerContainerRef = useRef<HTMLDivElement | null>(null)
  const playerRef = useRef<YoutubePlayer | null>(null)
  const [failed, setFailed] = useState(false)
  const targetId = `regular-youtube-${playerId}`

  useEffect(() => {
    let cancelled = false
    const container = playerContainerRef.current
    if (!container) return

    const target = document.createElement("div")
    target.id = targetId
    target.className = "h-full w-full"
    container.replaceChildren(target)

    ensureYoutubeApi().then((YT) => {
      if (cancelled) return

      playerRef.current = new YT.Player(targetId, {
        width: "100%",
        height: "100%",
        host: "https://www.youtube-nocookie.com",
        videoId,
        playerVars: {
          ...regularPlayerVars,
          playlist: videoId,
        },
        events: {
          onReady: () => {
            playerRef.current?.mute()
          },
          onStateChange: () => {},
          onError: () => {
            setFailed(true)
          },
        },
      })
    })

    return () => {
      cancelled = true
      playerRef.current?.destroy()
      playerRef.current = null
      container.replaceChildren()
    }
  }, [targetId, videoId])

  return (
    <YoutubeCrop>
      <div
        ref={playerContainerRef}
        className="h-full w-full pointer-events-none"
        aria-label={`${title} preview`}
        data-testid="regular-youtube-player"
      />
      {failed ? (
        <div className="absolute inset-0">
          <PreviewFallback title={title} />
        </div>
      ) : null}
    </YoutubeCrop>
  )
}

function LiveYoutubePreview({ videoIds, title }: { videoIds: string[]; title: string }) {
  const playerId = useId().replaceAll(":", "")
  const playerContainerRef = useRef<HTMLDivElement | null>(null)
  const playerRef = useRef<YoutubePlayer | null>(null)
  const queueRef = useRef<string[]>([])
  const timerRef = useRef<number | null>(null)
  const currentVideoRef = useRef<string | null>(null)
  const seekedVideoRef = useRef<string | null>(null)

  const targetId = `live-youtube-${playerId}`

  useEffect(() => {
    let cancelled = false
    const container = playerContainerRef.current
    if (!container) return

    const target = document.createElement("div")
    target.id = targetId
    target.className = "h-full w-full"
    container.replaceChildren(target)

    const clearTimer = () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }

    const takeNextVideo = () => {
      if (queueRef.current.length === 0) queueRef.current = shuffle(videoIds)
      return queueRef.current.shift() ?? videoIds[0]
    }

    const playNext = () => {
      const player = playerRef.current
      if (!player) return

      clearTimer()
      const videoId = takeNextVideo()
      currentVideoRef.current = videoId
      seekedVideoRef.current = null
      player.mute()
      player.loadVideoById({ videoId, startSeconds: 0 })
      timerRef.current = window.setTimeout(playNext, LIVE_SEGMENT_SECONDS * 1000)
    }

    ensureYoutubeApi().then((YT) => {
      if (cancelled) return

      playerRef.current = new YT.Player(targetId, {
        width: "100%",
        height: "100%",
        videoId: videoIds[0],
        playerVars,
        events: {
          onReady: () => {
            playerRef.current?.mute()
            playNext()
          },
          onStateChange: (event) => {
            if (event.data === YT.PlayerState.ENDED) {
              playNext()
              return
            }

            if (event.data !== YT.PlayerState.PLAYING) return

            const player = playerRef.current
            const videoId = currentVideoRef.current
            if (!player || !videoId || seekedVideoRef.current === videoId) return

            const duration = player.getDuration()
            const startSeconds =
              duration > LIVE_SEGMENT_SECONDS
                ? Math.floor(Math.random() * (duration - LIVE_SEGMENT_SECONDS))
                : 0

            if (startSeconds > 0) player.seekTo(startSeconds, true)
            seekedVideoRef.current = videoId
          },
          onError: () => {
            playNext()
          },
        },
      })
      window.setTimeout(() => {
        if (!cancelled && playerRef.current && !currentVideoRef.current) playNext()
      }, 1000)
    })

    return () => {
      cancelled = true
      clearTimer()
      playerRef.current?.destroy()
      playerRef.current = null
      container.replaceChildren()
    }
  }, [targetId, videoIds])

  return (
    <YoutubeCrop>
      <div
        ref={playerContainerRef}
        className="h-full w-full"
        aria-label={`${title} preview`}
        data-testid="live-youtube-player"
      />
    </YoutubeCrop>
  )
}

function WorkCard({ work }: { work: FeaturedWork }) {
  const content = (
    <>
      {work.kind === "regular" ? (
        <RegularYoutubePreview videoId={work.videoId} title={work.title} />
      ) : (
        <LiveYoutubePreview videoIds={work.videoIds} title={work.title} />
      )}
      <div className="mt-4 flex min-h-[5.5rem] flex-col">
        <p className="text-sm font-semibold leading-snug text-hp md:text-[0.95rem]">
          {work.title}
        </p>
        <p className="mt-auto pt-3 text-xs text-hp-muted md:text-sm">{work.client}</p>
      </div>
    </>
  )

  const className =
    "flex shrink-0 snap-start flex-col glass-card-sm p-4 md:p-5 transition-transform hover:-translate-y-0.5"
  const style = { width: "min(82vw, 320px)", minHeight: 230 }

  if (work.kind === "regular") {
    return (
      <a
        href={work.officialUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
        style={style}
      >
        {content}
      </a>
    )
  }

  return (
    <div className={className} style={style} aria-label={`${work.title} preview`}>
      {content}
    </div>
  )
}

export function FeaturedWorksCarousel({ works }: { works: FeaturedWork[] }) {
  return (
    <div className="mt-6 -mx-8 overflow-x-auto md:-mx-10 xl:-mx-12">
      <div className="flex snap-x snap-mandatory gap-4 px-8 pb-4 md:gap-5 md:px-10 xl:px-12">
        {works.map((work) => (
          <WorkCard key={work.title} work={work} />
        ))}
      </div>
    </div>
  )
}
