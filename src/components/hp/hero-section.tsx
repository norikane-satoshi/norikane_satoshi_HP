"use client"

import { useEffect, useRef, useState } from "react"
import Image from "next/image"
import {
  HERO_CLIPS,
  HERO_CLIP_SECONDS,
  HERO_DEFAULT_ZOOM,
  HERO_EXTRA_CLIPS,
  shuffleVideoIds,
  type HeroClip,
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
/** YouTube が再生の始めに画面中央へ一時停止ボタンを出している時間。この間は映像を見せない。 */
const HERO_BUTTON_MS = 4000
/** 次の場面は、見せる時刻より「ボタンの時間 + この時間」前に読み込みを始める（読み込みにかかる時間の見込み）。 */
const HERO_LOAD_LEAD_MS = 1500
/** 読み込んでからこの時間たっても再生が始まらない場面は飛ばす。回線や端末の制限で止まったままにしない。 */
const HERO_STALL_MS = 8000
const HERO_CLIP_MS = HERO_CLIP_SECONDS * 1000

/** 1 巡分の順番。優先の場面を並べた順に流し、そのあと作品カードの動画を混ぜて流す。 */
function getHeroRound(): HeroClip[] {
  return [...HERO_CLIPS, ...shuffleVideoIds(HERO_EXTRA_CLIPS)]
}

type Slot = {
  player: YouTubePlayer | null
  isReady: boolean
  clip: HeroClip | null
  /** 読み込んだ場面の再生が始まった時刻。始まるまでは null。 */
  playingAt: number | null
  /** この時刻より前には見せない（前の場面が消え終わる時刻）。 */
  dueAt: number
  pending: HeroClip | null
}

/**
 * 作品から選んだ場面を 10 秒ずつ順に流す。再生枠を 2 つ持ち、見せている場面の裏で次の場面を
 * 読み込んで再生しておき、一時停止ボタンが消えたところで切り替える。見えていないとき
 * （画面外・別タブ）は止め、戻ったら次の場面から再開する。
 */
function useHeroReel() {
  const rootRef = useRef<HTMLElement | null>(null)
  const hostRefs = [useRef<HTMLDivElement | null>(null), useRef<HTMLDivElement | null>(null)]
  const [slotClips, setSlotClips] = useState<(HeroClip | null)[]>([HERO_CLIPS[0], null])
  const [playing, setPlaying] = useState([false, false])
  const [shown, setShown] = useState<number | null>(null)
  /** 右上に出す作品名。消えていく間も文字を残すため、見せた場面の作品を持ち続ける。 */
  const [caption, setCaption] = useState<HeroClip | null>(null)
  const [hasStarted, setHasStarted] = useState(false)

  useEffect(() => {
    const root = rootRef.current
    const hosts = hostRefs.map((ref) => ref.current)
    if (!root || !hosts[0] || !hosts[1]) return

    let cancelled = false
    let isActive = true
    let visible = -1
    let round = getHeroRound()
    let index = 0
    const slots: Slot[] = [0, 1].map(() => ({
      player: null,
      isReady: false,
      clip: null,
      playingAt: null,
      dueAt: 0,
      pending: null,
    }))
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
    const nextClip = () => {
      const clip = round[index]
      index += 1
      if (index >= round.length) {
        round = getHeroRound()
        index = 0
      }
      return clip
    }
    const setSlotPlaying = (i: number, value: boolean) =>
      setPlaying((current) => (current[i] === value ? current : current.map((v, j) => (j === i ? value : v))))

    const load = (i: number, clip: HeroClip) => {
      const slot = slots[i]
      slot.clip = clip
      slot.playingAt = null
      setSlotClips((current) => current.map((c, j) => (j === i ? clip : c)))
      if (!slot.isReady) {
        slot.pending = clip
        return
      }
      callReadyPlayerMethod(slot.player, true, "loadVideoById", {
        videoId: clip.videoId,
        startSeconds: Math.max(0, clip.startSeconds - HERO_BUTTON_MS / 1000),
        endSeconds: clip.startSeconds + HERO_CLIP_SECONDS + 2,
      })
      later(() => {
        if (slot.clip === clip && slot.playingAt === null && isActive) load(i, nextClip())
      }, HERO_STALL_MS)
    }

    const reveal = (i: number) => {
      const other = 1 - i
      visible = i
      setShown(i)
      setCaption(slots[i].clip)
      setHasStarted(true)
      slots[other].dueAt = performance.now() + HERO_CLIP_MS + HERO_FADE_MS
      later(() => load(other, nextClip()), Math.max(0, HERO_CLIP_MS + HERO_FADE_MS - HERO_BUTTON_MS - HERO_LOAD_LEAD_MS))
      later(() => {
        if (visible !== i) return
        visible = -1
        setShown(null)
      }, HERO_CLIP_MS)
      later(() => tryReveal(other), HERO_CLIP_MS + HERO_FADE_MS)
    }

    /** 前の場面が消え終わり、かつ一時停止ボタンが消えていれば見せる。 */
    const tryReveal = (i: number) => {
      const slot = slots[i]
      if (!isActive || visible === i || slot.playingAt === null) return
      const now = performance.now()
      if (now < slot.dueAt || now - slot.playingAt < HERO_BUTTON_MS) return
      reveal(i)
    }

    const handleStateChange = (i: number, state: number, target: YouTubePlayer) => {
      if (!window.YT) return
      const isPlaying = state === window.YT.PlayerState.PLAYING
      setSlotPlaying(i, isPlaying)
      if (!isPlaying || slots[i].playingAt !== null) return
      slots[i].playingAt = performance.now()
      // 字幕は視聴者の設定で自動で出ることがあるので、場面ごとに外す。
      callReadyPlayerMethod(target, true, "unloadModule", "captions")
      callReadyPlayerMethod(target, true, "unloadModule", "cc")
      later(() => tryReveal(i), HERO_BUTTON_MS + 50)
    }

    const start = () => {
      slots[0].dueAt = 0
      load(0, nextClip())
    }

    const setActive = (nextActive: boolean) => {
      if (nextActive === isActive) return
      isActive = nextActive
      clearTimers()
      if (!nextActive) {
        visible = -1
        setShown(null)
        // 戻ったときは次の場面の準備ができるまで静止画を見せる。
        setHasStarted(false)
        slots.forEach((slot) => {
          slot.clip = null
          slot.playingAt = null
          callReadyPlayerMethod(slot.player, slot.isReady, "pauseVideo")
        })
        return
      }
      if (slots[0].player) start()
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
      slots.forEach((slot, i) => {
        slot.player = new window.YT!.Player(hosts[i]!, {
          playerVars: getBackgroundPlayerVars(),
          events: {
            onReady: (event) => {
              slot.isReady = true
              callReadyPlayerMethod(event.target, true, "mute")
              const pending = slot.pending
              slot.pending = null
              if (pending && isActive) load(i, pending)
            },
            onStateChange: (event) => handleStateChange(i, event.data, event.target),
            onError: () => {
              if (isActive && visible !== i) load(i, nextClip())
            },
          },
        })
      })
      if (isActive) start()
    })

    return () => {
      cancelled = true
      clearTimers()
      observer?.disconnect()
      document.removeEventListener("visibilitychange", handleVisibility)
      slots.forEach((slot) => callReadyPlayerMethod(slot.player, slot.isReady, "destroy"))
    }
    // hostRefs は毎回作り直されるが、指す要素は変わらない。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { rootRef, hostRefs, slotClips, playing, shown, caption, hasStarted }
}

export function HeroSection() {
  const { rootRef, hostRefs, slotClips, playing, shown, caption, hasStarted } = useHeroReel()

  return (
    <section
      id="home"
      ref={rootRef}
      className="hp-hero relative -mt-24 w-full overflow-hidden bg-black text-[var(--hp-color-on-media)] md:-mt-28"
      data-hp-hero-clip={caption?.videoId ?? ""}
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
        {hostRefs.map((hostRef, i) => (
          <div
            key={i}
            className="hp-hero-video hp-motion-keep pointer-events-none absolute left-1/2 top-1/2 transition-opacity ease-out"
            style={{
              opacity: shown === i ? 1 : 0,
              visibility: playing[i] ? "visible" : "hidden",
              transform: `translate(-50%, -50%) scale(${slotClips[i]?.zoom ?? HERO_DEFAULT_ZOOM})`,
              transitionDuration: `${HERO_FADE_MS}ms`,
            }}
            data-hp-hero-video={shown === i ? "visible" : "hidden"}
          >
            <div ref={hostRef} className="h-full w-full" />
          </div>
        ))}
        <div className="hp-hero-scrim absolute inset-0" />
      </div>

      <div className="hp-section-shell relative z-10 flex h-full flex-col justify-end pb-[clamp(2rem,5vw,4.5rem)]">
        <h1 className="sr-only">
          {hpPublicContent.hero.name} {hpPublicContent.hero.title}
        </h1>
        <div className="absolute left-[var(--hp-section-padding-x)] top-[calc(69px+1.5rem)] flex flex-col gap-2 text-[var(--hp-color-on-media-muted)] md:left-auto md:right-[var(--hp-section-padding-x)] md:items-end">
          <p className="text-sm tracking-[0.16em]">{hpPublicContent.hero.locationLine}</p>
          <p
            className="hp-motion-keep font-[var(--font-inter)] text-xs tracking-[0.12em] transition-opacity duration-700"
            style={{ opacity: shown === null ? 0 : 1 }}
          >
            {caption?.title}
            {caption?.client ? ` / ${caption.client}` : ""}
          </p>
        </div>
      </div>
    </section>
  )
}
