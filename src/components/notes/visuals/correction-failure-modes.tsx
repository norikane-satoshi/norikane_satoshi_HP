"use client"

import { useEffect, useRef, useState } from "react"

/**
 * v8 動画モジュール: 破綻の代表型 — 色のひっくり返り（0〜100% の外に出た値）
 *
 * viewBox 1600×900 (16:9)、モバイル 1000×1060。LOOP = 8s。
 *
 * 本文（「破綻を管理する」）の「100% を超えた側はクリップ、0 を下回った側は後ろの処理で
 * 予期しない挙動」に合わせて、2 つの側を 1 枚ずつ見せる。
 *
 *   1. 100% を超える側（オレンジの光、露出を上げる）:
 *      0〜1 を前提にした表示でチャンネルごとにクリップされる。R が先に止まり、
 *      一番明るいところが平らになって、色味が黄色から白へ寄る。
 *   2. 0 を下回る側（青い LED、彩度を上げる）:
 *      彩度は RGB の平均を軸に上げる（明るさを保たない方式）。鮮やかな中心ほど
 *      小さいチャンネルが先に 0 を下回り、輝度（Rec.709 の重み）も 0 以下になる。
 *      後ろの「輝度を基準にする処理」（輝度で割ってトーンを付け、輝度が 0 以下なら 0 にする）
 *      がそこを黒として扱い、中心から黒く抜ける。周りのグローは青のまま。
 *
 * 資料で確認できた崩れ方（黒く抜ける、合成の不具合など）に合わせた簡略モデルで、
 * 特定のソフトの処理を再現したものではない。
 *
 * SSR 設計: SVG は t=0 の純関数。canvas の描画は useEffect 内のみ。
 * reducedMotion 時は u を REDUCED_MOTION_U で固定して静止画化する。
 */

const LOOP = 8.0
const REDUCED_MOTION_U = 0.85
const N = 128

const TEXT_PRIMARY = "rgba(28,15,110,0.95)"
const TEXT_MUTED = "rgba(28,15,110,0.58)"
const ALERT = "rgb(180,60,80)"

const TINT_FLIP = {
  border: "rgba(190,100,100,0.85)",
  bg: "rgba(190,100,100,0.10)",
  curve: "rgb(160,70,70)",
}

export type Vec3 = [number, number, number]

/** Rec.709 の輝度の重み。 */
export const LUMA_WEIGHTS: Vec3 = [0.2126, 0.7152, 0.0722]

export function luminance(c: Vec3) {
  return LUMA_WEIGHTS[0] * c[0] + LUMA_WEIGHTS[1] * c[1] + LUMA_WEIGHTS[2] * c[2]
}

/** 色相（度）。無彩色に近いときは null。 */
export function hueDeg(rgb: Vec3): number | null {
  const [r, g, b] = rgb
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  if (max <= 0 || max - min < 0.04 * max) return null
  return ((Math.atan2(Math.sqrt(3) * (g - b), 2 * r - g - b) * 180) / Math.PI + 360) % 360
}

function clip01(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

const AMBIENT: Vec3 = [0.05, 0.05, 0.05]

function gauss2(x: number, y: number, cx: number, cy: number, s: number) {
  const dx = x - cx
  const dy = y - cy
  return Math.exp(-(dx * dx + dy * dy) / (s * s))
}

// ---- 1. 100% を超える側 ------------------------------------------------------

/** オレンジの光（作業用の値）。 */
export const ORANGE: Vec3 = [1.0, 0.38, 0.07]

export function clipExposure(u: number) {
  return 0.55 + 2.6 * u
}

/** 座標は -1..1。 */
export function orangeProfile(x: number, y: number) {
  return 0.75 * gauss2(x, y, 0, 0.05, 0.3) + 0.35 * gauss2(x, y, 0, 0.05, 0.75)
}

export function clipLinear(profile: number, u: number): Vec3 {
  const k = clipExposure(u) * profile
  return [AMBIENT[0] + k * ORANGE[0], AMBIENT[1] + k * ORANGE[1], AMBIENT[2] + k * ORANGE[2]]
}

/** 0〜1 を前提にした表示: チャンネルごとにクリップする。 */
export function clipDisplay(lin: Vec3): Vec3 {
  return [clip01(lin[0]), clip01(lin[1]), clip01(lin[2])]
}

// ---- 2. 0 を下回る側 ---------------------------------------------------------

/** 青い LED の芯（色域の外寄りで、小さいチャンネルがほぼ 0）と、周りのグロー。 */
export const LED_CORE: Vec3 = [0.02, 0.05, 1.0]
export const LED_GLOW: Vec3 = [0.12, 0.2, 0.62]

export function ledSaturation(u: number) {
  return 1 + 1.3 * u
}

export function ledLinear(x: number, y: number): Vec3 {
  const c = 1.2 * gauss2(x, y, 0, 0, 0.16)
  const g = 0.5 * gauss2(x, y, 0, 0, 0.6)
  return [
    AMBIENT[0] + c * LED_CORE[0] + g * LED_GLOW[0],
    AMBIENT[1] + c * LED_CORE[1] + g * LED_GLOW[1],
    AMBIENT[2] + c * LED_CORE[2] + g * LED_GLOW[2],
  ]
}

/** 彩度を上げる（RGB の平均を軸にする方式。明るさは保たれない）。 */
export function saturateAroundMean(c: Vec3, s: number): Vec3 {
  const p = (c[0] + c[1] + c[2]) / 3
  return [p + s * (c[0] - p), p + s * (c[1] - p), p + s * (c[2] - p)]
}

/**
 * 後ろの「輝度を基準にする処理」: 輝度でトーンを付けて色の比率を保つ。
 * 輝度が 0 以下なら 0（黒）として扱う。
 */
export function lumaBasedDisplay(c: Vec3): Vec3 {
  const y = luminance(c)
  if (y <= 0) return [0, 0, 0]
  const t = (y * (1 + y / 4)) / (1 + y)
  const k = t / y
  return [clip01(c[0] * k), clip01(c[1] * k), clip01(c[2] * k)]
}

// ---- 状態（図の枠と説明文の強調、テスト用） ----------------------------------

export type PanelId = "clip" | "negative"

export type PanelState = {
  /** 図の中心の値（作業用の値、加工後） */
  center: Vec3
  display: Vec3
  /** 崩れが起きているか（クリップ: 中心のどれかのチャンネルが 1 を超える／負: 中心の輝度が 0 以下） */
  broken: boolean
}

export function panelState(panel: PanelId, u: number): PanelState {
  if (panel === "clip") {
    const center = clipLinear(orangeProfile(0, 0.05), u)
    return { center, display: clipDisplay(center), broken: Math.max(...center) > 1 }
  }
  const center = saturateAroundMean(ledLinear(0, 0), ledSaturation(u))
  return { center, display: lumaBasedDisplay(center), broken: luminance(center) <= 0 }
}

export function negativePixel(x: number, y: number, u: number) {
  const c = saturateAroundMean(ledLinear(x, y), ledSaturation(u))
  return { value: c, display: lumaBasedDisplay(c) }
}

// ---- canvas 描画 ---------------------------------------------------------------

const SRGB_LUT = (() => {
  const lut = new Uint8ClampedArray(4096)
  for (let i = 0; i < 4096; i++) {
    const v = i / 4095
    const e = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055
    lut[i] = Math.round(e * 255)
  }
  return lut
})()

function encode(v: number) {
  return SRGB_LUT[Math.max(0, Math.min(4095, Math.round(v * 4095)))]
}

let fieldCache: { orange: Float32Array; led: Float32Array } | null = null
function fields() {
  if (fieldCache) return fieldCache
  const orange = new Float32Array(N * N)
  const led = new Float32Array(N * N * 3)
  for (let iy = 0; iy < N; iy++) {
    for (let ix = 0; ix < N; ix++) {
      const x = (ix / (N - 1)) * 2 - 1
      const y = (iy / (N - 1)) * 2 - 1
      const p = iy * N + ix
      orange[p] = orangeProfile(x, y)
      const c = ledLinear(x, y)
      led[p * 3] = c[0]
      led[p * 3 + 1] = c[1]
      led[p * 3 + 2] = c[2]
    }
  }
  fieldCache = { orange, led }
  return fieldCache
}

function paintPanel(ctx: CanvasRenderingContext2D, img: ImageData, panel: PanelId, u: number) {
  const data = img.data
  const f = fields()
  const s = ledSaturation(u)
  for (let p = 0; p < N * N; p++) {
    const d =
      panel === "clip"
        ? clipDisplay(clipLinear(f.orange[p], u))
        : lumaBasedDisplay(saturateAroundMean([f.led[p * 3], f.led[p * 3 + 1], f.led[p * 3 + 2]], s))
    data[p * 4] = encode(d[0])
    data[p * 4 + 1] = encode(d[1])
    data[p * 4 + 2] = encode(d[2])
    data[p * 4 + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
}

// ---- レイアウト ---------------------------------------------------------------
// 図は「絵」と「一行の説明」だけにする。仕組みの数値（バー）は出さず、説明は本文に任せる。

type Rect = { x: number; y: number; size: number }

type PanelLayout = {
  image: Rect
  textX: number
  textAnchor: "start" | "middle"
  labelY: number
  captionY: number
}

type Layout = {
  w: number
  h: number
  inset: number
  titleX: number
  titleY: number
  titleFont: number
  subX: number
  subY: number
  subFont: number
  labelFont: number
  captionFont: number
  lineGap: number
  panels: Record<PanelId, PanelLayout>
}

const PANEL_ORDER: PanelId[] = ["clip", "negative"]

function desktopLayout(): Layout {
  const size = 540
  const gap = 100
  const x0 = (1600 - (size * 2 + gap)) / 2
  const panels = {} as Record<PanelId, PanelLayout>
  PANEL_ORDER.forEach((id, i) => {
    const x = x0 + i * (size + gap)
    panels[id] = {
      image: { x, y: 176, size },
      textX: x + size / 2,
      textAnchor: "middle",
      labelY: 156,
      captionY: 772,
    }
  })
  return {
    w: 1600,
    h: 900,
    inset: 12,
    titleX: 56,
    titleY: 84,
    titleFont: 38,
    subX: 392,
    subY: 84,
    subFont: 21,
    labelFont: 24,
    captionFont: 22,
    lineGap: 32,
    panels,
  }
}

function mobileLayout(): Layout {
  const size = 400
  const panels = {} as Record<PanelId, PanelLayout>
  PANEL_ORDER.forEach((id, i) => {
    const y0 = 172 + i * 430
    panels[id] = {
      image: { x: 36, y: y0, size },
      textX: 470,
      textAnchor: "start",
      labelY: y0 + 150,
      captionY: y0 + 205,
    }
  })
  return {
    w: 1000,
    h: 1060,
    inset: 10,
    titleX: 36,
    titleY: 82,
    titleFont: 44,
    subX: 36,
    subY: 132,
    subFont: 25,
    labelFont: 30,
    captionFont: 28,
    lineGap: 40,
    panels,
  }
}

const DESKTOP = desktopLayout()
const MOBILE = mobileLayout()

export const FAILURE_MODES_MOBILE_ASPECT = `${MOBILE.w} / ${MOBILE.h}`

/** 見出しと説明。モバイルでは lines で折り返す。 */
const PANEL_TEXT: Record<PanelId, { label: string; caption: string; lines: string[] }> = {
  clip: {
    label: "100% を超える側：露出を上げる",
    caption: "一番明るいところが平らになり、黄色から白へ寄る",
    lines: ["一番明るいところが平らになり、", "黄色から白へ寄る"],
  },
  negative: {
    label: "0 を下回る側：彩度を上げる",
    caption: "鮮やかな中心から黒く抜ける。周りのグローは青のまま",
    lines: ["鮮やかな中心から黒く抜ける。", "周りのグローは青のまま"],
  },
}

function Panel({ layout, panel, u, isMobile }: { layout: Layout; panel: PanelId; u: number; isMobile: boolean }) {
  const p = layout.panels[panel]
  const flipped = panelState(panel, u).broken
  const text = PANEL_TEXT[panel]
  const captionLines = isMobile ? text.lines : [text.caption]
  return (
    <g>
      <text
        x={p.textX}
        y={p.labelY}
        textAnchor={p.textAnchor}
        fontSize={layout.labelFont}
        fontWeight={700}
        fill={TEXT_PRIMARY}
      >
        {text.label}
      </text>
      <rect
        x={p.image.x - 2}
        y={p.image.y - 2}
        width={p.image.size + 4}
        height={p.image.size + 4}
        rx={10}
        fill="none"
        stroke={flipped ? "rgba(180,60,80,0.85)" : "rgba(28,15,110,0.2)"}
        strokeWidth={flipped ? 3 : 1.5}
      />
      <text
        x={p.textX}
        y={p.captionY}
        textAnchor={p.textAnchor}
        fontSize={layout.captionFont}
        fontWeight={600}
        fill={flipped ? ALERT : TEXT_MUTED}
      >
        {captionLines.map((line, k) => (
          <tspan key={k} x={p.textX} dy={k === 0 ? 0 : layout.lineGap}>
            {line}
          </tspan>
        ))}
      </text>
    </g>
  )
}

function umphase(t: number) {
  return 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / LOOP)
}

export default function CorrectionFailureModes({
  isPlaying,
  isMobile,
  reducedMotion,
}: {
  isPlaying: boolean
  isMobile?: boolean
  reducedMotion: boolean
}) {
  const [animT, setAnimT] = useState(0)
  const lastRef = useRef<number | null>(null)
  const rafRef = useRef<number | null>(null)
  const canvasRefs = useRef<Record<PanelId, HTMLCanvasElement | null>>({
    clip: null,
    negative: null,
  })
  const imageRefs = useRef<Partial<Record<PanelId, ImageData>>>({})

  useEffect(() => {
    if (reducedMotion || !isPlaying) {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      lastRef.current = null
      return
    }
    const tick = (now: number) => {
      if (lastRef.current == null) lastRef.current = now
      const dt = (now - lastRef.current) / 1000
      lastRef.current = now
      setAnimT((prev) => (prev + dt) % LOOP)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [isPlaying, reducedMotion])

  const u = reducedMotion ? REDUCED_MOTION_U : umphase(animT)
  const layout = isMobile ? MOBILE : DESKTOP

  useEffect(() => {
    for (const id of PANEL_ORDER) {
      const canvas = canvasRefs.current[id]
      if (!canvas) continue
      const ctx = canvas.getContext("2d")
      if (!ctx) continue
      let img = imageRefs.current[id]
      if (!img) {
        img = ctx.createImageData(N, N)
        imageRefs.current[id] = img
      }
      paintPanel(ctx, img, id, u)
    }
  }, [u, isMobile])

  return (
    <div className="absolute inset-0">
      <svg
        viewBox={`0 0 ${layout.w} ${layout.h}`}
        className="absolute inset-0 h-full w-full"
        preserveAspectRatio="xMidYMid meet"
      >
        <rect
          x={layout.inset}
          y={layout.inset}
          width={layout.w - layout.inset * 2}
          height={layout.h - layout.inset * 2}
          rx={24}
          fill={TINT_FLIP.bg}
          stroke={TINT_FLIP.border}
          strokeOpacity={0.55}
          strokeWidth={1.4}
        />
        <rect
          x={layout.inset}
          y={layout.inset}
          width={layout.w - layout.inset * 2}
          height={layout.h - layout.inset * 2}
          rx={24}
          fill="rgba(255,255,255,0.55)"
        />
        <text x={layout.titleX} y={layout.titleY} fontSize={layout.titleFont} fontWeight={700} fill={TINT_FLIP.curve}>
          色のひっくり返り
        </text>
        <text x={layout.subX} y={layout.subY} fontSize={layout.subFont} fontWeight={500} fill={TEXT_MUTED}>
          0〜100% の外に出た値が、後ろの処理で崩れる
        </text>
        {PANEL_ORDER.map((id) => (
          <Panel key={id} layout={layout} panel={id} u={u} isMobile={Boolean(isMobile)} />
        ))}
      </svg>
      {PANEL_ORDER.map((id) => {
        const r = layout.panels[id].image
        return (
          <canvas
            key={`${id}-${isMobile ? "m" : "d"}`}
            ref={(el) => {
              canvasRefs.current[id] = el
              if (!el) delete imageRefs.current[id]
            }}
            width={N}
            height={N}
            aria-hidden="true"
            className="absolute rounded-[8px]"
            style={{
              position: "absolute",
              left: `${(r.x / layout.w) * 100}%`,
              top: `${(r.y / layout.h) * 100}%`,
              width: `${(r.size / layout.w) * 100}%`,
              height: `${(r.size / layout.h) * 100}%`,
            }}
          />
        )
      })}
    </div>
  )
}
