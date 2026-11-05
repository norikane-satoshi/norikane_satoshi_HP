"use client"

import { useEffect, useRef, useState } from "react"
import Image from "next/image"
import {
  HERO_CLIPS,
  HERO_CLIP_SECONDS,
  HERO_DEFAULT_ZOOM,
} from "@/components/hp/featured-works-data"
import {
  callReadyPlayerMethod,
  getBackgroundPlayerVars,
  loadYouTubeIframeApi,
  type YouTubePlayer,
} from "@/components/hp/youtube-iframe"
import { hpPublicContent } from "@/lib/hp/public-content"

/** 場面の切り替えで暗転させる時間。 */
const HERO_FADE_MS = 700
/** 再生が始まってから映像を見せるまでの待ち時間。読み込み直後の YouTube 表示を隠す。 */
const HERO_REVEAL_DELAY_MS = 900

function getClipLoadArg(index: number) {
  const clip = HERO_CLIPS[index]
  return {
    videoId: clip.videoId,
    startSeconds: clip.startSeconds,
    endSeconds: clip.startSeconds + HERO_CLIP_SECONDS + 2,
  }
}

/**
 * 作品の予告編から選んだ場面を 10 秒ずつ順に流す。見えていないとき（画面外・別タブ）は止め、
 * 戻ったら次の場面から再開する。
 */
function useHeroReel() {
  const rootRef = useRef<HTMLElement | null>(null)
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [clipIndex, setClipIndex] = useState(0)
  const [isVideoVisible, setIsVideoVisible] = useState(false)
  const [hasStarted, setHasStarted] = useState(false)

  useEffect(() => {
    const root = rootRef.current
    const host = hostRef.current
    if (!root || !host) return

    let cancelled = false
    let player: YouTubePlayer | null = null
    let isReady = false
    let isActive = true
    let index = 0
    let revealedIndex = -1
    const timers = new Set<number>()

    const later = (callback: () => void, ms: number) => {
      const id = window.setTimeout(() => {
        timers.delete(id)
        callback()
      }, ms)
      timers.add(id)
    }
    const clearTimers = () => {
      timers.forEach((id) => window.clearTimeout(id))
      timers.clear()
    }

    const advance = () => {
      clearTimers()
      setIsVideoVisible(false)
      later(() => {
        index = (index + 1) % HERO_CLIPS.length
        revealedIndex = -1
        setClipIndex(index)
        callReadyPlayerMethod(player, isReady, "loadVideoById", getClipLoadArg(index))
      }, HERO_FADE_MS)
    }

    const handlePlaying = () => {
      if (revealedIndex === index || !isActive) return
      revealedIndex = index
      later(() => {
        setIsVideoVisible(true)
        setHasStarted(true)
      }, HERO_REVEAL_DELAY_MS)
      later(advance, HERO_CLIP_SECONDS * 1000)
    }

    const setActive = (nextActive: boolean) => {
      if (nextActive === isActive) return
      isActive = nextActive
      if (!nextActive) {
        clearTimers()
        setIsVideoVisible(false)
        callReadyPlayerMethod(player, isReady, "pauseVideo")
        return
      }
      advance()
    }

    const observer =
      "IntersectionObserver" in window
        ? new IntersectionObserver(([entry]) => setActive(entry.isIntersecting), {
            threshold: 0.1,
          })
        : null
    observer?.observe(root)
    const handleVisibility = () => setActive(document.visibilityState === "visible")
    document.addEventListener("visibilitychange", handleVisibility)

    loadYouTubeIframeApi().then(() => {
      if (cancelled || !window.YT) return
      const first = HERO_CLIPS[0]
      player = new window.YT.Player(host, {
        videoId: first.videoId,
        playerVars: {
          ...getBackgroundPlayerVars(),
          start: first.startSeconds,
          end: first.startSeconds + HERO_CLIP_SECONDS + 2,
        },
        events: {
          onReady: (event) => {
            isReady = true
            callReadyPlayerMethod(event.target, true, "mute")
            if (isActive) callReadyPlayerMethod(event.target, true, "playVideo")
          },
          onStateChange: (event) => {
            if (!window.YT) return
            if (event.data === window.YT.PlayerState.PLAYING) handlePlaying()
            if (event.data === window.YT.PlayerState.ENDED && isActive) advance()
          },
          onError: () => {
            if (isActive) advance()
          },
        },
      })
    })

    return () => {
      cancelled = true
      clearTimers()
      observer?.disconnect()
      document.removeEventListener("visibilitychange", handleVisibility)
      callReadyPlayerMethod(player, isReady, "destroy")
    }
  }, [])

  return { rootRef, hostRef, clipIndex, isVideoVisible, hasStarted }
}

export function HeroSection() {
  const { rootRef, hostRef, clipIndex, isVideoVisible, hasStarted } = useHeroReel()
  const clip = HERO_CLIPS[clipIndex]
  const zoom = clip.zoom ?? HERO_DEFAULT_ZOOM

  return (
    <section
      id="home"
      ref={rootRef}
      className="hp-hero relative -mt-24 w-full overflow-hidden bg-black text-[var(--hp-color-on-media)] md:-mt-28"
      data-hp-hero-clip={clip.videoId}
    >
      <div className="absolute inset-0" aria-hidden="true">
        <Image
          src="/hp/hero-poster-mars.jpg"
          alt=""
          fill
          priority
          sizes="100vw"
          className={`hp-motion-keep object-cover transition-opacity duration-[1200ms] ${hasStarted ? "opacity-0" : "opacity-100"}`}
          style={{ objectPosition: "78% 50%" }}
        />
        <div
          className="hp-hero-video hp-motion-keep pointer-events-none absolute left-1/2 top-1/2 transition-opacity ease-out"
          style={{
            opacity: isVideoVisible ? 1 : 0,
            transform: `translate(-50%, -50%) scale(${zoom})`,
            transitionDuration: `${HERO_FADE_MS}ms`,
          }}
          data-hp-hero-video={isVideoVisible ? "visible" : "hidden"}
        >
          <div ref={hostRef} className="h-full w-full" />
        </div>
        <div className="hp-hero-scrim absolute inset-0" />
      </div>

      <div className="hp-section-shell relative z-10 flex h-full flex-col justify-end pb-[clamp(2rem,5vw,4.5rem)]">
        <div className="flex flex-col gap-4 md:gap-5">
          <p className="hp-latin-italic text-lg text-[var(--hp-color-on-media-muted)] md:text-2xl">
            Norikane Film Design Office
          </p>
          <h1 className="hp-display-heading text-[clamp(3.5rem,9.6vw,9.5rem)] font-medium tracking-[0.08em]">
            {hpPublicContent.hero.name}
            <span className="mt-4 block text-[clamp(1.125rem,1.7vw,1.625rem)] font-normal tracking-[0.3em] text-[var(--hp-color-on-media-muted)] md:mt-6">
              {hpPublicContent.hero.title}
            </span>
          </h1>
        </div>
        <div className="absolute left-[var(--hp-section-padding-x)] top-[calc(69px+1.5rem)] flex flex-col gap-2 text-[var(--hp-color-on-media-muted)] md:left-auto md:right-[var(--hp-section-padding-x)] md:items-end">
          <p className="text-sm tracking-[0.16em]">{hpPublicContent.hero.locationLine}</p>
          <p
            className="hp-motion-keep font-[var(--font-inter)] text-xs tracking-[0.12em] transition-opacity duration-700"
            style={{ opacity: isVideoVisible ? 1 : 0 }}
          >
            {clip.title}
            {clip.client ? ` / ${clip.client}` : ""}
          </p>
        </div>
      </div>
    </section>
  )
}
