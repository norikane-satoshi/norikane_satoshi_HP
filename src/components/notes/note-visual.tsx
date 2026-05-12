"use client"

import dynamic from "next/dynamic"
import { useEffect, useRef, useState, type ComponentType } from "react"
import { getVisualConfig, type VisualConfig } from "@/lib/notes/visuals"

/**
 * v5 説明ビジュアル基盤の共通入口。
 *
 * 役割:
 *   - slug から種別 (video / static / placeholder) を判定し、
 *     対応する描画モジュールを dynamic import で読み込む。
 *   - 動画モジュールには再生制御 (在画判定 / タブ可視性 / reduced-motion) を
 *     付与した状態で `isPlaying` を渡す。各モジュールは isPlaying=false の間
 *     アニメーションを停止し、初期フレームを表示する。
 *   - 静止画モジュールは常時表示。視界連動も reduced-motion も対象外。
 *
 * Notion 本文は [[diagram:<slug>]] という旧記法を流用する (新記法は導入しない)。
 * RenderBlocks が paragraph を marker と判定したとき、まずこの NoteVisual に
 * 渡す。v5 registry に登録がなければ NoteVisual は null を返し、上流が
 * v3 NoteDiagram にフォールバックする。
 */

export type VideoVisualProps = {
  isPlaying: boolean
  /** prefers-reduced-motion: reduce が有効な環境では true。アニメ層を mount しない判断に使う */
  reducedMotion: boolean
}

// 各 slug を静的に列挙して dynamic import に渡す。これにより Next が
// バンドル時に code-split を行う。新しい slug を足すときは v5 registry の
// エントリ追加と合わせてここにも 1 行追加する。
//
// SSR について: 動画モジュールは render が「t=0 / isPlaying=false の純関数」で、
// IntersectionObserver / matchMedia / requestAnimationFrame は全て useEffect 内。
// よって ssr: false は不要 (むしろ BAILOUT_TO_CLIENT_SIDE_RENDERING の dev overlay
// 雑音を呼ぶ)。SSR 時は初期フレーム (透明) を吐き、hydration 後にアニメ開始。
const VIDEO_MODULES: Record<string, ComponentType<VideoVisualProps>> = {
  "correction-labyrinth-to-factor": dynamic(
    () =>
      import(
        "@/components/notes/visuals/correction-labyrinth-to-factor"
      ),
    { loading: () => <VisualSkeleton /> }
  ),
  "correction-control-math": dynamic(
    () => import("@/components/notes/visuals/correction-control-math"),
    { loading: () => <VisualSkeleton /> }
  ),
  "correction-reversibility": dynamic(
    () => import("@/components/notes/visuals/correction-reversibility"),
    { loading: () => <VisualSkeleton /> }
  ),
  "correction-space-choice": dynamic(
    () => import("@/components/notes/visuals/correction-space-choice"),
    { loading: () => <VisualSkeleton /> }
  ),
  "correction-failure-modes": dynamic(
    () => import("@/components/notes/visuals/correction-failure-modes"),
    { loading: () => <VisualSkeleton /> }
  ),
  "grading-look-decomposition": dynamic(
    () => import("@/components/notes/visuals/grading-look-decomposition"),
    { loading: () => <VisualSkeleton /> }
  ),
  "grading-secret-pantry": dynamic(
    () => import("@/components/notes/visuals/grading-secret-pantry"),
    { loading: () => <VisualSkeleton /> }
  ),
  "grading-mix-vs-split": dynamic(
    () => import("@/components/notes/visuals/grading-mix-vs-split"),
    { loading: () => <VisualSkeleton /> }
  ),
}

const STATIC_MODULES: Record<string, ComponentType<unknown>> = {
  "grading-natural-vs-normal": dynamic(
    () => import("@/components/notes/visuals/grading-natural-vs-normal"),
    { loading: () => <VisualSkeleton /> }
  ),
  "grading-visible-vs-hidden": dynamic(
    () => import("@/components/notes/visuals/grading-visible-vs-hidden"),
    { loading: () => <VisualSkeleton /> }
  ),
}

export function NoteVisual({ slug }: { slug: string }) {
  const config = getVisualConfig(slug)
  if (!config) return null
  // 動画は SVG 内 4 種類のテキスト (粒度バー / 軸 / 列ヘッダ / chip ラベル) のみで
  // 説明を完結させる方針。caption / intro / "Visual / Motion" / "5SEC" は描画しない。
  // alt は SR 用に figure の aria-label として保持する。
  if (config.kind === "video") {
    return (
      <figure
        data-diagram-slug={config.slug}
        data-diagram-kind={config.kind}
        aria-label={config.alt}
        className="mx-auto my-12 max-w-[58rem] overflow-hidden rounded-[16px] border border-white/55 bg-white/35 md:my-16"
      >
        <VisualBody config={config} />
      </figure>
    )
  }
  if (config.slug === "grading-natural-vs-normal") {
    return (
      <figure
        data-diagram-kind={config.kind}
        className="mx-auto my-12 max-w-[58rem] overflow-hidden rounded-[16px] border border-white/55 bg-white/35 md:my-16"
      >
        <VisualBody config={config} />
      </figure>
    )
  }
  if (config.slug === "grading-visible-vs-hidden") {
    return (
      <figure
        data-diagram-kind={config.kind}
        className="mx-auto my-6 max-w-[64rem] overflow-hidden rounded-[16px] border border-white/55 bg-white/35 md:my-8"
      >
        <VisualBody config={config} />
      </figure>
    )
  }
  return (
    <figure
      data-diagram-kind={config.kind}
      className="mx-auto my-12 max-w-[58rem] overflow-hidden rounded-[16px] border border-white/55 bg-white/35 md:my-16"
    >
      <VisualBody config={config} />
      <figcaption className="px-5 py-5 md:px-7 md:py-6">
        <p className="text-xs uppercase tracking-[0.22em] text-hp-muted">
          Visual
        </p>
        <h4 className="mt-1 text-base font-semibold text-hp md:text-lg">
          {config.title}
        </h4>
        <p className="mt-2 text-sm leading-relaxed text-hp-muted md:text-[0.95rem]">
          {config.caption}
        </p>
        {config.intro ? (
          <p className="mt-3 rounded-[12px] border border-white/55 bg-white/35 px-3 py-2 text-[12px] leading-relaxed text-hp md:text-[0.85rem]">
            <span className="mr-1.5 inline-flex items-center rounded-full bg-[var(--accent-primary,#8B7FFF)]/15 px-1.5 py-0.5 font-[var(--font-geist-mono)] text-[10px] tracking-[0.2em] text-[var(--accent-primary,#8B7FFF)]">
              5SEC
            </span>
            {config.intro}
          </p>
        ) : null}
      </figcaption>
    </figure>
  )
}

function VisualBody({ config }: { config: VisualConfig }) {
  const aspect = `${config.aspect.width} / ${config.aspect.height}`
  if (config.kind === "video") {
    const Module = VIDEO_MODULES[config.slug]
    if (!Module) {
      return <PlaceholderBox aspect={aspect} label={config.slug} />
    }
    return (
      <VideoStage aspect={aspect} alt={config.alt}>
        {(state) => <Module {...state} />}
      </VideoStage>
    )
  }
  if (config.kind === "static") {
    const Module = STATIC_MODULES[config.slug]
    if (!Module) {
      return <PlaceholderBox aspect={aspect} label={config.slug} />
    }
    return (
      <div
        role="img"
        aria-label={config.alt}
        className="relative w-full"
        style={{ aspectRatio: aspect }}
      >
        <Module />
      </div>
    )
  }
  // placeholder
  return <PlaceholderBox aspect={aspect} label={config.slug} />
}

function VisualSkeleton() {
  return (
    <div className="h-full w-full animate-pulse bg-white/30" aria-hidden="true" />
  )
}

function PlaceholderBox({ aspect, label }: { aspect: string; label: string }) {
  return (
    <div
      className="relative flex w-full items-center justify-center bg-white/30"
      style={{ aspectRatio: aspect }}
      role="img"
      aria-label={`${label} (準備中)`}
    >
      <p className="font-[var(--font-geist-mono)] text-[11px] uppercase tracking-[0.22em] text-hp-muted">
        {label}
      </p>
    </div>
  )
}

/**
 * 動画ビジュアル用の再生制御ラッパー。
 *
 * isPlaying = inView (≥25% 可視) ∧ documentVisible ∧ ¬reducedMotion
 *
 * reduced-motion: 各モジュールはアニメ層を mount せず、初期フレームの
 * 静止画として描画する責任を持つ (= isPlaying=false の状態をそのまま使う)。
 * VisualSkeleton はサーバ側からは出ない (ssr:false) ため初期表示は空白になるが、
 * VisualSkeleton の loading で隙間を埋めて、hydration 後に Module が差し替わる。
 */
function VideoStage({
  aspect,
  alt,
  children,
}: {
  aspect: string
  alt: string
  children: (state: VideoVisualProps) => React.ReactNode
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [inView, setInView] = useState(false)
  const [docVisible, setDocVisible] = useState(true)
  const [reducedMotion, setReducedMotion] = useState(false)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          setInView(entry.isIntersecting && entry.intersectionRatio >= 0.25)
        }
      },
      { threshold: [0, 0.25, 0.5, 1] }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    const update = () => setDocVisible(document.visibilityState !== "hidden")
    update()
    document.addEventListener("visibilitychange", update)
    return () => document.removeEventListener("visibilitychange", update)
  }, [])

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
    const update = () => setReducedMotion(mq.matches)
    update()
    mq.addEventListener("change", update)
    return () => mq.removeEventListener("change", update)
  }, [])

  const isPlaying = inView && docVisible && !reducedMotion

  return (
    <div
      ref={wrapRef}
      role="img"
      aria-label={alt}
      className="relative w-full"
      style={{ aspectRatio: aspect }}
    >
      {children({ isPlaying, reducedMotion })}
    </div>
  )
}
