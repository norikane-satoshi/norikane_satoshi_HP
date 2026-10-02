"use client"

import { useEffect, useRef, useState } from "react"

/**
 * v7 動画モジュール: 破綻の代表型 — 色のひっくり返り（現場でよく見る 2 例）
 *
 * viewBox 1600×900 (16:9)、モバイル 1000×1060。LOOP = 8s。
 *
 * 図は現象だけを見せ、仕組みの説明は本文（「破綻を管理する」）に任せる。
 *   1. LED の点とグロー: 一番鮮やかな中心から先に色がひっくり返る。周りのグローは青のまま。
 *   2. 黄色のグラデーション: 一番明るいところがマゼンタにひっくり返る。
 *
 * 絵の計算（RAW 現像の簡略モデル）:
 *   センサーの値（0〜1 で止まる）→ ホワイトバランス → 色を作る足し引き（3×3）
 *   → 表示（比率を保って明るさだけ圧縮）
 * 係数は一般的なカメラに近い例で、特定の機種の値ではない。
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
type Chan = "R" | "G" | "B"
const CHANS: Chan[] = ["R", "G", "B"]

// ---- 信号の流れ ---------------------------------------------------------------

/** ホワイトバランスのゲイン（センサーの値に掛ける）。 */
export const WB_GAINS: Vec3 = [2.0, 1.0, 1.5]

/** 色を作る足し引き（行の和は 1。グレーはグレーのまま）。 */
export const COLOR_MATRIX: [Vec3, Vec3, Vec3] = [
  [1.95, -0.83, -0.12],
  [-0.18, 1.53, -0.35],
  [0.03, -0.53, 1.5],
]

export const SENSOR_CEILING = 1

function clampSensor(v: number) {
  return v < 0 ? 0 : v > SENSOR_CEILING ? SENSOR_CEILING : v
}

function mix(v: Vec3): Vec3 {
  const a = v[0] * WB_GAINS[0]
  const b = v[1] * WB_GAINS[1]
  const c = v[2] * WB_GAINS[2]
  const m = COLOR_MATRIX
  return [
    m[0][0] * a + m[0][1] * b + m[0][2] * c,
    m[1][0] * a + m[1][1] * b + m[1][2] * c,
    m[2][0] * a + m[2][1] * b + m[2][2] * c,
  ]
}

/** センサーの値（上限と 0 で止まる）→ ホワイトバランス → 足し引き。 */
export function sensorToWorking(raw: Vec3): Vec3 {
  return mix([clampSensor(raw[0]), clampSensor(raw[1]), clampSensor(raw[2])])
}

/** 表示: 一番大きいチャンネルで割った比率を保ち、明るさだけを圧縮する。0 未満は 0。 */
export function toDisplay(lin: Vec3, lift = 1): Vec3 {
  const r = lin[0] * lift
  const g = lin[1] * lift
  const b = lin[2] * lift
  const n = Math.max(r, g, b)
  if (n <= 0) return [0, 0, 0]
  const t = 1 - Math.exp(-1.6 * n)
  const c = (v: number) => (v <= 0 ? 0 : v >= n ? 1 : v / n)
  return [c(r) * t, c(g) * t, c(b) * t]
}

/** 色相（度）。無彩色に近いときは null。 */
export function hueDeg(rgb: Vec3): number | null {
  const [r, g, b] = rgb
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  if (max <= 0 || max - min < 0.04 * max) return null
  return ((Math.atan2(Math.sqrt(3) * (g - b), 2 * r - g - b) * 180) / Math.PI + 360) % 360
}

export function hueDistance(a: number | null, b: number | null) {
  if (a == null || b == null) return 0
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

/** 起点から色相が 60° 以上ずれたら「ひっくり返り」。 */
export const FLIP_HUE_DEG = 60

// ---- 2 つの絵 -----------------------------------------------------------------

/** 光の色ごとのセンサーの値（変換後に狙いの色になるよう逆算し、最大を 1 にしたもの）。 */
export const LED_SENSOR: Vec3 = [0.1921, 0.592, 1.0] // → 青い LED
export const YELLOW_SENSOR: Vec3 = [0.586, 1.0, 0.2199] // → 黄色
/** 周りの暗いグレー（変換後に 0.045 の無彩色）。 */
const AMBIENT_SENSOR: Vec3 = [0.045 / 2.0, 0.045, 0.045 / 1.5]

export function ledStrength(u: number) {
  return 0.6 + 3.9 * u
}
export function yellowStrength(u: number) {
  return 0.7 + 4.3 * u
}
/** 座標は -1..1。 */
export function ledProfile(x: number, y: number) {
  const r2 = x * x + y * y
  return Math.exp(-r2 / (0.16 * 0.16)) + 0.35 * Math.exp(-r2 / (0.55 * 0.55))
}
export function yellowProfile(x: number, y: number) {
  const dy = y - 0.1
  const r2 = x * x + dy * dy
  return 0.8 * Math.exp(-r2 / (0.35 * 0.35)) + 0.45 * Math.exp(-r2 / (0.8 * 0.8))
}

export function lightSensor(color: Vec3, strength: number, profile: number): Vec3 {
  return [
    AMBIENT_SENSOR[0] + strength * profile * color[0],
    AMBIENT_SENSOR[1] + strength * profile * color[1],
    AMBIENT_SENSOR[2] + strength * profile * color[2],
  ]
}

// ---- 調べる 1 点（プローブ） --------------------------------------------------

export type PanelId = "led" | "yellow"

export type ProbeState = {
  /**
   * バーに出す値。センサーの値（上限や 0 で止まる前）にホワイトバランスを掛けたもの。
   * この単位では無彩色が 3 本同じ長さになり、上限は色ごとに WB_GAINS の位置になる。
   */
  values: Vec3
  display: Vec3
  baseDisplay: Vec3
  /** 端で止まった / 0 を下回ったチャンネル */
  limited: Chan[]
  flipped: boolean
}

function withWb(raw: Vec3): Vec3 {
  return [raw[0] * WB_GAINS[0], raw[1] * WB_GAINS[1], raw[2] * WB_GAINS[2]]
}

export function probeState(panel: PanelId, u: number): ProbeState {
  const color = panel === "led" ? LED_SENSOR : YELLOW_SENSOR
  const strength = panel === "led" ? ledStrength : yellowStrength
  const prof = panel === "led" ? ledProfile(0, 0) : yellowProfile(0, 0.1)
  const raw = lightSensor(color, strength(u), prof)
  const raw0 = lightSensor(color, strength(0), prof)
  const display = toDisplay(sensorToWorking(raw))
  const baseDisplay = toDisplay(sensorToWorking(raw0))
  const limited = CHANS.filter((_, i) => raw[i] >= SENSOR_CEILING)
  const flipped = hueDistance(hueDeg(display), hueDeg(baseDisplay)) >= FLIP_HUE_DEG
  return { values: withWb(raw), display, baseDisplay, limited, flipped }
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

let profileCache: { led: Float32Array; yellow: Float32Array } | null = null
function profiles() {
  if (profileCache) return profileCache
  const led = new Float32Array(N * N)
  const yellow = new Float32Array(N * N)
  for (let iy = 0; iy < N; iy++) {
    for (let ix = 0; ix < N; ix++) {
      const x = (ix / (N - 1)) * 2 - 1
      const y = (iy / (N - 1)) * 2 - 1
      led[iy * N + ix] = ledProfile(x, y)
      yellow[iy * N + ix] = yellowProfile(x, y)
    }
  }
  profileCache = { led, yellow }
  return profileCache
}

function paintPanel(ctx: CanvasRenderingContext2D, img: ImageData, panel: PanelId, u: number) {
  const data = img.data
  const prof = profiles()[panel]
  const color = panel === "led" ? LED_SENSOR : YELLOW_SENSOR
  const k = panel === "led" ? ledStrength(u) : yellowStrength(u)
  for (let p = 0; p < N * N; p++) {
    const d = toDisplay(sensorToWorking(lightSensor(color, k, prof[p])))
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

const PANEL_ORDER: PanelId[] = ["led", "yellow"]

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
    labelFont: 34,
    captionFont: 28,
    lineGap: 40,
    panels,
  }
}

const DESKTOP = desktopLayout()
const MOBILE = mobileLayout()

export const FAILURE_MODES_MOBILE_ASPECT = `${MOBILE.w} / ${MOBILE.h}`

/** 一行の説明。モバイルでは lines で折り返す。 */
const PANEL_TEXT: Record<PanelId, { label: string; caption: string; lines: string[] }> = {
  led: {
    label: "LED の点とグロー",
    caption: "中心から先に、色がひっくり返る",
    lines: ["中心から先に、", "色がひっくり返る"],
  },
  yellow: {
    label: "黄色のグラデーション",
    caption: "一番明るいところが、マゼンタにひっくり返る",
    lines: ["一番明るいところが、", "マゼンタにひっくり返る"],
  },
}

function Panel({ layout, panel, u, isMobile }: { layout: Layout; panel: PanelId; u: number; isMobile: boolean }) {
  const p = layout.panels[panel]
  const flipped = probeState(panel, u).flipped
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
    led: null,
    yellow: null,
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
          鮮やかなところから先に、色がひっくり返る
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
