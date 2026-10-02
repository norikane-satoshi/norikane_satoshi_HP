"use client"

import { useEffect, useRef, useState } from "react"

/**
 * v6 動画モジュール: 破綻の代表型 — 色のひっくり返り（実際の絵で起きる 3 例）
 *
 * viewBox 1600×900 (16:9)、モバイル 1000×1490。LOOP = 8s。
 *
 * 本文（カラーコレクションの因数分解「破綻を管理する」）の
 * 「1 つのチャンネルが先に端をまたぐと、比率が崩れて別の色に飛ぶ」を、
 * 現場でよく見る 3 つの絵で見せる。
 *
 *   1. LED の点とグロー: 光が強くなると、中心だけセンサーの B が先に上限で止まる。
 *      R と G だけが増え続け、色を作る足し引き（変換）の比率が崩れて、
 *      中心だけがマゼンタ側へ飛ぶ。周りのグローは青のまま。
 *   2. 黄色のグラデーション: 一番明るいところで G が先に上限で止まり、
 *      R と B だけが増えて鮮やかなピンク（マゼンタ）に飛ぶ。
 *   3. 黒とグレイン: 光が弱くなると、ノイズで 0 の前後に散ったセンサーの値のうち
 *      0 未満が 0 で切られる。G が切られて R と B だけが残った点は、ホワイトバランスで
 *      R と B が持ち上がるため、マゼンタ寄りの点になる（暗部のマゼンタかぶり）。
 *
 * 信号の流れ（3 例共通、RAW 現像の簡略モデル）:
 *   センサーの値（黒レベルを引いた後、0〜1 で止まる）→ ホワイトバランス
 *   → 色を作る足し引き（3×3）→ 表示（比率を保って明るさだけ圧縮）
 * ノイズは画素ごと・色ごとに独立。G は 2 画素分あるので R・B より 1/√2 小さくする。
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

const CHAN_COLORS = {
  R: "rgb(214,80,80)",
  G: "rgb(60,150,90)",
  B: "rgb(80,100,200)",
} as const

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
/** 黒の点は、0 を下回ったうえで彩度がここを超えたら「飛んだ」とみなす。 */
export const BLACK_FLIP_SATURATION = 0.85

export function saturation(rgb: Vec3) {
  const max = Math.max(rgb[0], rgb[1], rgb[2])
  if (max <= 0) return 0
  return (max - Math.min(rgb[0], rgb[1], rgb[2])) / max
}

// ---- 3 つの絵 -----------------------------------------------------------------

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
/** 黒の絵の明るさ（変換後の無彩色の値）。光が弱くなって 0 に近づく。 */
export const BLACK_LEVEL_MAX = 0.02
export function blackLevel(u: number) {
  return BLACK_LEVEL_MAX * (1 - u)
}
/** センサーのノイズ（R・B）。G は 2 画素分あるので 1/√2。 */
export const BLACK_NOISE = 0.0015
/** 黒の絵は暗いので、表示のときだけ持ち上げる。 */
export const BLACK_VIEW_LIFT = 14

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

// 再現性のある乱数（mulberry32）
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
function gauss(next: () => number) {
  const u1 = Math.max(next(), 1e-12)
  const u2 = next()
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
}

type BlackField = {
  /** 画素ごと・色ごとのセンサーのノイズ。N*N*3 */
  noise: Float32Array
  /** 場所ごとの明るさの比（中央が少し明るい）。N*N */
  shade: Float32Array
  probe: { ix: number; iy: number }
}

let blackFieldCache: BlackField | null = null

/**
 * 黒とグレイン: 暗いグレーにセンサーのノイズを足す。ノイズは 2×2 画素単位で、
 * 色ごとに独立。黒レベルを引いた後の値は 0 で切られてからホワイトバランスがかかる。
 */
export function blackField(): BlackField {
  if (blackFieldCache) return blackFieldCache
  const next = rng(20261002)
  const G = N / 2
  const coarse = new Float32Array(G * G * 3)
  for (let i = 0; i < G * G; i++) {
    coarse[i * 3] = BLACK_NOISE * gauss(next)
    coarse[i * 3 + 1] = (BLACK_NOISE / Math.SQRT2) * gauss(next)
    coarse[i * 3 + 2] = BLACK_NOISE * gauss(next)
  }
  const noise = new Float32Array(N * N * 3)
  const shade = new Float32Array(N * N)
  for (let iy = 0; iy < N; iy++) {
    for (let ix = 0; ix < N; ix++) {
      const x = (ix / (N - 1)) * 2 - 1
      const y = (iy / (N - 1)) * 2 - 1
      const p = iy * N + ix
      shade[p] = 1 + 0.5 * Math.exp(-((x + 0.1) ** 2) / 0.35 - (y - 0.15) ** 2 / 0.25)
      const c = ((iy >> 1) * G + (ix >> 1)) * 3
      noise[p * 3] = coarse[c]
      noise[p * 3 + 1] = coarse[c + 1]
      noise[p * 3 + 2] = coarse[c + 2]
    }
  }
  // 中央付近で、光が 0 になったときに G だけが 0 で切られ、R と B が残る点を 1 つ選ぶ
  let best = { ix: N / 2, iy: N / 2 }
  let bestScore = -Infinity
  for (let iy = Math.floor(N * 0.3); iy < N * 0.7; iy++) {
    for (let ix = Math.floor(N * 0.3); ix < N * 0.7; ix++) {
      const o = (iy * N + ix) * 3
      const r = noise[o]
      const g = noise[o + 1]
      const b = noise[o + 2]
      if (g >= -0.0004 || r <= 0 || b <= 0) continue
      const score =
        Math.min(r * WB_GAINS[0], b * WB_GAINS[2]) -
        Math.abs(ix - N / 2) * 1e-6 -
        Math.abs(iy - N / 2) * 1e-6
      if (score > bestScore) {
        bestScore = score
        best = { ix, iy }
      }
    }
  }
  blackFieldCache = { noise, shade, probe: best }
  return blackFieldCache
}

/** 黒の絵の 1 画素のセンサーの値（0 で切る前）。 */
export function blackSensorAt(ix: number, iy: number, u: number): Vec3 {
  const f = blackField()
  const p = iy * N + ix
  const level = blackLevel(u) * f.shade[p]
  return [
    level / WB_GAINS[0] + f.noise[p * 3],
    level / WB_GAINS[1] + f.noise[p * 3 + 1],
    level / WB_GAINS[2] + f.noise[p * 3 + 2],
  ]
}

// ---- 調べる 1 点（プローブ） --------------------------------------------------

export type PanelId = "led" | "yellow" | "black"

export type ProbeState = {
  /** バーに出す値。センサーの値（上限や 0 で止まる前）。 */
  values: Vec3
  display: Vec3
  baseDisplay: Vec3
  /** 端で止まった / 0 を下回ったチャンネル */
  limited: Chan[]
  flipped: boolean
}

export function probeState(panel: PanelId, u: number): ProbeState {
  if (panel === "black") {
    const { probe } = blackField()
    const cur = blackSensorAt(probe.ix, probe.iy, u)
    const base = blackSensorAt(probe.ix, probe.iy, 0)
    const display = toDisplay(sensorToWorking(cur), BLACK_VIEW_LIFT)
    const baseDisplay = toDisplay(sensorToWorking(base), BLACK_VIEW_LIFT)
    const limited = CHANS.filter((_, i) => cur[i] < 0)
    // 黒は起点が無彩色に近いので、色相ではなく「0 で切られて鮮やかになったか」で見る
    const flipped = limited.length > 0 && saturation(display) >= BLACK_FLIP_SATURATION
    return { values: cur, display, baseDisplay, limited, flipped }
  }
  const color = panel === "led" ? LED_SENSOR : YELLOW_SENSOR
  const strength = panel === "led" ? ledStrength : yellowStrength
  const prof = panel === "led" ? ledProfile(0, 0) : yellowProfile(0, 0.1)
  const raw = lightSensor(color, strength(u), prof)
  const raw0 = lightSensor(color, strength(0), prof)
  const display = toDisplay(sensorToWorking(raw))
  const baseDisplay = toDisplay(sensorToWorking(raw0))
  const limited = CHANS.filter((_, i) => raw[i] >= SENSOR_CEILING)
  const flipped = hueDistance(hueDeg(display), hueDeg(baseDisplay)) >= FLIP_HUE_DEG
  return { values: raw, display, baseDisplay, limited, flipped }
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
  if (panel === "black") {
    const f = blackField()
    const level = blackLevel(u)
    for (let p = 0; p < N * N; p++) {
      const o = p * 3
      const l = level * f.shade[p]
      const d = toDisplay(
        sensorToWorking([
          l / WB_GAINS[0] + f.noise[o],
          l / WB_GAINS[1] + f.noise[o + 1],
          l / WB_GAINS[2] + f.noise[o + 2],
        ]),
        BLACK_VIEW_LIFT
      )
      data[p * 4] = encode(d[0])
      data[p * 4 + 1] = encode(d[1])
      data[p * 4 + 2] = encode(d[2])
      data[p * 4 + 3] = 255
    }
  } else {
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
  }
  ctx.putImageData(img, 0, 0)
}

// ---- レイアウト ---------------------------------------------------------------

type Rect = { x: number; y: number; size: number }

type PanelLayout = {
  image: Rect
  labelX: number
  labelY: number
  labelAnchor: "start" | "middle"
  opY: number
  barsX: number
  barsY: number
  barW: number
  barH: number
  barGap: number
  captionY: number
  badgeX: number
  badgeY: number
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
  opFont: number
  opNoteOwnLine: boolean
  captionFont: number
  chanFont: number
  badgeW: number
  badgeH: number
  badgeFont: number
  panels: Record<PanelId, PanelLayout>
}

const PANEL_ORDER: PanelId[] = ["led", "yellow", "black"]

function desktopLayout(): Layout {
  const colW = 460
  const gap = 50
  const x0 = (1600 - (colW * 3 + gap * 2)) / 2
  const size = 380
  const panels = {} as Record<PanelId, PanelLayout>
  PANEL_ORDER.forEach((id, i) => {
    const cx = x0 + i * (colW + gap)
    const imgX = cx + (colW - size) / 2
    panels[id] = {
      image: { x: imgX, y: 196, size },
      labelX: cx + colW / 2,
      labelY: 150,
      labelAnchor: "middle",
      opY: 180,
      barsX: imgX + 30,
      barsY: 628,
      barW: size - 60,
      barH: 20,
      barGap: 9,
      captionY: 614,
      badgeX: cx + colW / 2,
      badgeY: 784,
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
    subFont: 20,
    labelFont: 23,
    opFont: 17,
    opNoteOwnLine: false,
    captionFont: 15,
    chanFont: 16,
    badgeW: 170,
    badgeH: 38,
    badgeFont: 17,
    panels,
  }
}

function mobileLayout(): Layout {
  const size = 380
  const panels = {} as Record<PanelId, PanelLayout>
  PANEL_ORDER.forEach((id, i) => {
    const y0 = 170 + i * 440
    panels[id] = {
      image: { x: 36, y: y0, size },
      labelX: 456,
      labelY: y0 + 40,
      labelAnchor: "start",
      opY: y0 + 82,
      barsX: 490,
      barsY: y0 + 172,
      barW: 440,
      barH: 28,
      barGap: 14,
      captionY: y0 + 156,
      badgeX: 456 + 254,
      badgeY: y0 + 352,
    }
  })
  return {
    w: 1000,
    h: 1490,
    inset: 10,
    titleX: 36,
    titleY: 82,
    titleFont: 44,
    subX: 36,
    subY: 130,
    subFont: 24,
    labelFont: 32,
    opFont: 24,
    opNoteOwnLine: true,
    captionFont: 22,
    chanFont: 24,
    badgeW: 230,
    badgeH: 50,
    badgeFont: 24,
    panels,
  }
}

const DESKTOP = desktopLayout()
const MOBILE = mobileLayout()

export const FAILURE_MODES_MOBILE_ASPECT = `${MOBILE.w} / ${MOBILE.h}`

const PANEL_TEXT: Record<
  PanelId,
  {
    label: string
    op: string
    opNote?: string
    caption: string
    flipLabel: string
    limitLabel: (c: Chan[]) => string
  }
> = {
  led: {
    label: "LED の点とグロー",
    op: "光が強くなる",
    caption: "中心のセンサーの値",
    flipLabel: "中心だけ飛ぶ",
    limitLabel: (c) => `${c.join("・")} が上限で止まる`,
  },
  yellow: {
    label: "黄色のグラデーション",
    op: "光が強くなる",
    caption: "一番明るいところのセンサーの値",
    flipLabel: "マゼンタに飛ぶ",
    limitLabel: (c) => `${c.join("・")} が上限で止まる`,
  },
  black: {
    label: "黒とグレイン",
    op: "光が弱くなる",
    opNote: "（暗部を持ち上げて表示）",
    caption: "丸で囲んだ点のセンサーの値",
    flipLabel: "マゼンタの点が出る",
    limitLabel: (c) => `${c.join("・")} が 0 で切られる`,
  },
}

function Badge({ x, y, layout, label }: { x: number; y: number; layout: Layout; label: string }) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      <rect
        x={-layout.badgeW / 2}
        y={-layout.badgeH / 2}
        width={layout.badgeW}
        height={layout.badgeH}
        rx={layout.badgeH / 2}
        fill="rgba(180,60,80,0.16)"
        stroke="rgba(180,60,80,0.65)"
        strokeWidth={1.4}
      />
      <text
        x={0}
        y={layout.badgeFont * 0.36}
        textAnchor="middle"
        fontSize={layout.badgeFont}
        fontWeight={700}
        fill={ALERT}
      >
        {label}
      </text>
    </g>
  )
}

function probePoint(panel: PanelId): { px: number; py: number } {
  if (panel === "led") return { px: 0.5, py: 0.5 }
  if (panel === "yellow") return { px: 0.5, py: 0.55 }
  const { probe } = blackField()
  return { px: (probe.ix + 0.5) / N, py: (probe.iy + 0.5) / N }
}

function Bars({ layout, p, panel, state }: { layout: Layout; p: PanelLayout; panel: PanelId; state: ProbeState }) {
  const signed = panel === "black"
  // LED / 黄色: 0〜1.6（上限 1 の線）。黒: -0.006〜0.03（0 の線）。
  const lo = signed ? -0.006 : 0
  const hi = signed ? 0.03 : 1.6
  const xOf = (v: number) => p.barsX + ((Math.min(Math.max(v, lo), hi) - lo) / (hi - lo)) * p.barW
  const markX = signed ? xOf(0) : xOf(SENSOR_CEILING)
  const top = p.barsY - 6
  const bottom = p.barsY + 3 * p.barH + 2 * p.barGap + 6
  return (
    <g>
      <text x={p.barsX - 22} y={p.captionY} fontSize={layout.captionFont} fill={TEXT_MUTED}>
        {PANEL_TEXT[panel].caption}
      </text>
      {CHANS.map((ch, i) => {
        const v = state.values[i]
        const y = p.barsY + i * (p.barH + p.barGap)
        const limited = state.limited.includes(ch)
        const zeroX = xOf(0)
        // 記録される値（上限と 0 で止まる）
        const shown = Math.max(0, Math.min(v, SENSOR_CEILING))
        const endX = xOf(shown)
        return (
          <g key={ch}>
            <text
              x={p.barsX - 10}
              y={y + p.barH * 0.78}
              textAnchor="end"
              fontSize={layout.chanFont}
              fontWeight={700}
              fill={CHAN_COLORS[ch]}
              fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
            >
              {ch}
            </text>
            <rect
              x={p.barsX}
              y={y}
              width={p.barW}
              height={p.barH}
              rx={4}
              fill="rgba(255,255,255,0.7)"
              stroke="rgba(28,15,110,0.16)"
            />
            {!signed && v > SENSOR_CEILING ? (
              // 上限を超えて入ってきた光（記録されない分）
              <rect
                x={markX}
                y={y + p.barH * 0.3}
                width={xOf(v) - markX}
                height={p.barH * 0.4}
                fill={CHAN_COLORS[ch]}
                fillOpacity={0.18}
              />
            ) : null}
            {signed && v < 0 ? (
              // 0 を下回って切り捨てられる分
              <rect
                x={xOf(v)}
                y={y + p.barH * 0.3}
                width={zeroX - xOf(v)}
                height={p.barH * 0.4}
                fill={CHAN_COLORS[ch]}
                fillOpacity={0.3}
              />
            ) : null}
            <rect
              x={Math.min(zeroX, endX)}
              y={y}
              width={Math.abs(endX - zeroX)}
              height={p.barH}
              fill={CHAN_COLORS[ch]}
              fillOpacity={limited ? 0.95 : 0.7}
            />
          </g>
        )
      })}
      <line x1={markX} y1={top} x2={markX} y2={bottom} stroke={ALERT} strokeOpacity={0.8} strokeWidth={2} />
      <text
        x={markX}
        y={bottom + layout.captionFont * 1.2}
        textAnchor="middle"
        fontSize={layout.captionFont}
        fill={ALERT}
      >
        {signed ? "0" : "上限"}
      </text>
    </g>
  )
}

function Panel({ layout, panel, u }: { layout: Layout; panel: PanelId; u: number }) {
  const p = layout.panels[panel]
  const state = probeState(panel, u)
  const text = PANEL_TEXT[panel]
  return (
    <g>
      <text
        x={p.labelX}
        y={p.labelY}
        textAnchor={p.labelAnchor}
        fontSize={layout.labelFont}
        fontWeight={700}
        fill={TEXT_PRIMARY}
      >
        {text.label}
      </text>
      <text x={p.labelX} y={p.opY} textAnchor={p.labelAnchor} fontSize={layout.opFont} fill={TEXT_MUTED}>
        {text.op}
        {text.opNote && !layout.opNoteOwnLine ? text.opNote : null}
      </text>
      {text.opNote && layout.opNoteOwnLine ? (
        <text
          x={p.labelX}
          y={p.opY + layout.opFont * 1.3}
          textAnchor={p.labelAnchor}
          fontSize={layout.opFont * 0.85}
          fill={TEXT_MUTED}
        >
          {text.opNote}
        </text>
      ) : null}
      <rect
        x={p.image.x - 1}
        y={p.image.y - 1}
        width={p.image.size + 2}
        height={p.image.size + 2}
        rx={10}
        fill="none"
        stroke={state.flipped ? "rgba(180,60,80,0.8)" : "rgba(28,15,110,0.2)"}
        strokeWidth={state.flipped ? 3 : 1.5}
      />
      <Bars layout={layout} p={p} panel={panel} state={state} />
      {state.flipped ? (
        <Badge x={p.badgeX} y={p.badgeY} layout={layout} label={text.flipLabel} />
      ) : state.limited.length > 0 ? (
        <Badge x={p.badgeX} y={p.badgeY} layout={layout} label={text.limitLabel(state.limited)} />
      ) : null}
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
    black: null,
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
          センサーの 1 チャンネルが先に上限や 0 で止まると、比率が崩れて色が飛ぶ
        </text>
        {PANEL_ORDER.map((id) => (
          <Panel key={id} layout={layout} panel={id} u={u} />
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
              imageRendering: id === "black" ? "pixelated" : "auto",
            }}
          />
        )
      })}
      {/* プローブの丸は canvas の上に重ねる */}
      <svg
        viewBox={`0 0 ${layout.w} ${layout.h}`}
        className="pointer-events-none absolute inset-0 h-full w-full"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
      >
        {PANEL_ORDER.map((id) => {
          const p = layout.panels[id]
          const { px, py } = probePoint(id)
          const ringR = id === "black" ? p.image.size * 0.05 : p.image.size * 0.12
          return (
            <circle
              key={id}
              cx={p.image.x + px * p.image.size}
              cy={p.image.y + py * p.image.size}
              r={ringR}
              fill="none"
              stroke="rgba(255,255,255,0.9)"
              strokeWidth={2}
              strokeDasharray="6 5"
            />
          )
        })}
      </svg>
    </div>
  )
}
