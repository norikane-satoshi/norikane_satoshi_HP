"use client"

import { useEffect, useRef, useState } from "react"

/**
 * v5 動画モジュール: 操作の数学 (オペとノブの対応) — 横一列 4 セル帯レイアウト
 *
 * viewBox 1600×500 (16:5) を 4 セル横並び (各 400×500) に分け、
 * ゲイン / ガンマ / オフセット / リフト の 4 ミニ図を並べる。
 *
 * 動きの構成 (2026-11-05 リッチ化):
 *   1. 登場 (ENTRANCE 秒): 図が画面に入ったとき、セルが左から順に浮かび上がり、
 *      曲線が左下から線を引くように描かれる。
 *   2. ループ (LOOP 秒): ノブを 1 つずつ順番に回す。回しているセルだけが明るくなり、
 *      値は「動かす → 少し止める → 反対へ動かす → 戻す」の順で、止まる位置で
 *      わずかに行き過ぎてから落ち着く (手でノブを回した感触)。
 *      曲線と基準線 (y = x) の間を薄く塗り、操作が効いている量を面で見せる。
 *
 * 各セルは縦 3 層構造:
 *   上段 — 「原因名（カテゴリ） 数式」を 1 行見出し
 *   中段 — 入出力トーンカーブ
 *   下段 — スライダーバー + 数値カウンター 1 行
 *
 * reducedMotion 時は登場を省き、各パラメータを中立値から少し動かした値で静止する。
 */

const ENTRANCE = 1.6
const SLOT = 2.8
const LOOP = SLOT * 4
const W = 1600
const H = 500
const CELL_W = 400
const CELL_H = 500

// セル内レイアウト (セル相対座標)
const HEADER_X = 28
const HEADER_Y = 52
const PLOT_X = 28
const PLOT_Y = 84
const PLOT_W = 344
const PLOT_H = 328
const TRACK_X = 28
const TRACK_Y = 452
const TRACK_W = 244
const TRACK_H = 10
const VALUE_X = 372
const VALUE_Y = 460

const TEXT_PRIMARY = "rgba(236,230,220,0.92)"
const TEXT_MUTED = "rgba(236,230,220,0.38)"
const GRID = "rgba(236,230,220,0.12)"

const TINT_GAIN = {
  border: "rgba(222,133,149,0.85)",
  bg: "rgba(222,133,149,0.10)",
  curve: "rgb(236,128,146)",
}
const TINT_GAMMA = {
  border: "rgba(120,204,190,0.85)",
  bg: "rgba(120,204,190,0.10)",
  curve: "rgb(112,204,184)",
}
const TINT_OFFSET = {
  border: "rgba(222,174,116,0.85)",
  bg: "rgba(222,174,116,0.10)",
  curve: "rgb(226,176,104)",
}
const TINT_LIFT = {
  border: "rgba(132,172,236,0.85)",
  bg: "rgba(132,172,236,0.10)",
  curve: "rgb(132,172,236)",
}

type Tint = typeof TINT_GAIN

type CellSpec = {
  index: number
  cellX: number
  opLabel: string
  formula: string
  paramSymbol: "a" | "γ" | "b" | "L"
  tint: Tint
  curve: (x: number, p: number) => number
  range: [number, number]
  neutral: number
  /** ノブを回す順に通る 2 つの値 (中立 → first → second → 中立) */
  first: number
  second: number
  clipId: string
  glowId: string
}

function curveGain(x: number, a: number) {
  return a * x
}
function curveGamma(x: number, g: number) {
  return Math.pow(Math.max(0, x), g)
}
function curveOffset(x: number, b: number) {
  return x + b
}
// Resolve 系: y = x + L · (1 − x)。L が大きいほど暗部だけ持ち上がる。
function curveLift(x: number, l: number) {
  return x + l * (1 - x)
}

const CELLS: CellSpec[] = [
  {
    index: 0,
    cellX: 0,
    opLabel: "ゲイン（乗算）",
    formula: "y = a · x",
    paramSymbol: "a",
    tint: TINT_GAIN,
    curve: curveGain,
    range: [0.5, 2.0],
    neutral: 1,
    first: 1.8,
    second: 0.6,
    clipId: "ccm-clip-gain",
    glowId: "ccm-glow-gain",
  },
  {
    index: 1,
    cellX: CELL_W,
    opLabel: "ガンマ（べき乗）",
    formula: "y = x^γ",
    paramSymbol: "γ",
    tint: TINT_GAMMA,
    curve: curveGamma,
    range: [0.5, 2.0],
    neutral: 1,
    first: 0.55,
    second: 1.9,
    clipId: "ccm-clip-gamma",
    glowId: "ccm-glow-gamma",
  },
  {
    index: 2,
    cellX: CELL_W * 2,
    opLabel: "オフセット（加算）",
    formula: "y = x + b",
    paramSymbol: "b",
    tint: TINT_OFFSET,
    curve: curveOffset,
    range: [-0.3, 0.3],
    neutral: 0,
    first: 0.24,
    second: -0.24,
    clipId: "ccm-clip-offset",
    glowId: "ccm-glow-offset",
  },
  {
    index: 3,
    cellX: CELL_W * 3,
    opLabel: "リフト（合成）",
    formula: "y = x + L · (1 − x)",
    paramSymbol: "L",
    tint: TINT_LIFT,
    curve: curveLift,
    range: [0, 0.5],
    neutral: 0,
    first: 0.42,
    second: 0.18,
    clipId: "ccm-clip-lift",
    glowId: "ccm-glow-lift",
  },
]

const SAMPLES = 96

function clamp01(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

function easeInOutCubic(x: number) {
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2
}

function easeOutCubic(x: number) {
  return 1 - Math.pow(1 - x, 3)
}

// 止まる位置でわずかに行き過ぎて戻る (手で回したノブの感触)。
function easeOutBack(x: number) {
  const c1 = 1.2
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2)
}

/** スロット内の進行 (0..SLOT) からパラメータ値を返す。 */
function slotValue(spec: CellSpec, u: number) {
  const { neutral, first, second } = spec
  // 0.00–0.70 neutral→first / 0.70–0.95 hold / 0.95–1.75 first→second / 1.75–2.05 hold / 2.05–2.65 second→neutral
  if (u < 0.7) return neutral + (first - neutral) * easeOutBack(u / 0.7)
  if (u < 0.95) return first
  if (u < 1.75) return first + (second - first) * easeOutBack((u - 0.95) / 0.8)
  if (u < 2.05) return second
  if (u < 2.65) return second + (neutral - second) * easeInOutCubic((u - 2.05) / 0.6)
  return neutral
}

type CellState = {
  p: number
  /** 0..1 — 回しているセルほど 1 */
  focus: number
  /** 0..1 — 登場アニメーションの進み (セルの浮き上がり) */
  enter: number
  /** 0..1 — 曲線を描き終えた割合 */
  draw: number
}

function cellState(spec: CellSpec, elapsed: number, reducedMotion: boolean): CellState {
  if (reducedMotion) {
    return { p: spec.first, focus: 1, enter: 1, draw: 1 }
  }
  const delay = spec.index * 0.14
  const enter = easeOutCubic(clamp01((elapsed - delay) / 0.7))
  const draw = easeInOutCubic(clamp01((elapsed - delay - 0.35) / 0.9))
  if (elapsed < ENTRANCE) {
    return { p: spec.neutral, focus: 0.75, enter, draw }
  }
  const t = (elapsed - ENTRANCE) % LOOP
  const slotStart = spec.index * SLOT
  const u = t - slotStart
  const active = u >= 0 && u < SLOT
  const p = active ? slotValue(spec, u) : spec.neutral
  // フォーカスはスロットの前後 0.3 秒で滑らかに切り替える
  const fadeIn = clamp01((u + 0.3) / 0.3)
  const fadeOut = clamp01((SLOT - u) / 0.3)
  const focus = u > -0.3 && u < SLOT ? Math.min(fadeIn, fadeOut) : 0
  return { p, focus, enter, draw }
}

function curvePoints(spec: CellSpec, p: number, plotX: number, draw: number) {
  const points: [number, number][] = []
  const last = Math.max(1, Math.round(SAMPLES * draw))
  for (let i = 0; i <= last; i++) {
    const x = i / SAMPLES
    const y = spec.curve(x, p)
    points.push([plotX + x * PLOT_W, PLOT_Y + PLOT_H - y * PLOT_H])
  }
  return points
}

function toPolyline(points: [number, number][]) {
  return points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ")
}

/** 曲線と基準線 y = x の間の面 (操作が効いている量)。 */
function toEffectArea(points: [number, number][], plotX: number) {
  if (points.length < 2) return ""
  const forward = points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`)
  const back = [...points].reverse().map(([x]) => {
    const nx = (x - plotX) / PLOT_W
    const ny = PLOT_Y + PLOT_H - nx * PLOT_H
    return `${x.toFixed(2)},${ny.toFixed(2)}`
  })
  return `M ${forward.join(" L ")} L ${back.join(" L ")} Z`
}

function knobScreenX(p: number, range: [number, number], cellX: number) {
  const [lo, hi] = range
  const norm = clamp01((p - lo) / (hi - lo))
  return cellX + TRACK_X + norm * TRACK_W
}

function formatParamValue(symbol: CellSpec["paramSymbol"], p: number) {
  // オフセットだけ負値をとるので符号付。それ以外は素の小数 2 桁。
  if (symbol === "b") {
    const sign = p >= 0 ? "+" : "−"
    return `${sign}${Math.abs(p).toFixed(2)}`
  }
  return p.toFixed(2)
}

function Cell({ spec, state }: { spec: CellSpec; state: CellState }) {
  const { p, focus, enter, draw } = state
  const cellX = spec.cellX
  const plotX = cellX + PLOT_X
  const points = curvePoints(spec, p, plotX, draw)
  const poly = toPolyline(points)
  const area = toEffectArea(points, plotX)
  const knobCX = knobScreenX(p, spec.range, cellX)
  const knobCY = TRACK_Y + TRACK_H / 2
  const neutralX = knobScreenX(spec.neutral, spec.range, cellX)
  const lit = 0.55 + 0.45 * focus
  const lift = (1 - enter) * 26

  return (
    <g opacity={enter} transform={`translate(0 ${lift.toFixed(2)})`}>
      {/* セル背景 (色カテゴリ識別)。回しているセルだけ縁を明るくする */}
      <rect
        x={cellX + 10}
        y={10}
        width={CELL_W - 20}
        height={CELL_H - 20}
        rx={20}
        ry={20}
        fill={spec.tint.bg}
        fillOpacity={0.6 + 0.4 * focus}
        stroke={spec.tint.border}
        strokeOpacity={0.25 + 0.5 * focus}
        strokeWidth={1.4}
      />
      <rect
        x={cellX + 10}
        y={10}
        width={CELL_W - 20}
        height={CELL_H - 20}
        rx={20}
        ry={20}
        fill="rgba(13,12,11,0.55)"
      />

      <g opacity={lit}>
        {/* 1 行見出し: 原因名（カテゴリ） + 数式 */}
        <text x={cellX + HEADER_X} y={HEADER_Y} fontSize={22} fontWeight={700}>
          <tspan fill={spec.tint.curve}>{spec.opLabel}</tspan>
          <tspan dx={14} fill={TEXT_PRIMARY} fontWeight={600} fontStyle="italic">
            {spec.formula}
          </tspan>
        </text>

        {/* plot 枠と基準線 y = x (何もしないときの直線) */}
        <rect
          x={plotX}
          y={PLOT_Y}
          width={PLOT_W}
          height={PLOT_H}
          rx={4}
          ry={4}
          fill="rgba(255,255,255,0.02)"
          stroke={GRID}
          strokeWidth={1}
        />
        <line
          x1={plotX}
          y1={PLOT_Y + PLOT_H}
          x2={plotX + PLOT_W}
          y2={PLOT_Y}
          stroke={TEXT_MUTED}
          strokeWidth={1}
          strokeDasharray="4 7"
        />

        <g clipPath={`url(#${spec.clipId})`}>
          {/* 操作が効いている量 (曲線と基準線の間) */}
          <path d={area} fill={spec.tint.curve} fillOpacity={0.1 + 0.08 * focus} />
          {/* 発光 (暗い地の上で線が光って見えるよう、ぼかした太線を下に敷く) */}
          <polyline
            points={poly}
            fill="none"
            stroke={spec.tint.curve}
            strokeOpacity={0.35 * focus + 0.1}
            strokeWidth={10}
            strokeLinecap="round"
            strokeLinejoin="round"
            filter={`url(#${spec.glowId})`}
          />
          {/* 入出力カーブ */}
          <polyline
            points={poly}
            fill="none"
            stroke={spec.tint.curve}
            strokeWidth={3.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>

        {/* スライダーバー (下段左)。中立位置に目盛りを置き、動いた量を帯で見せる */}
        <rect
          x={cellX + TRACK_X}
          y={TRACK_Y}
          width={TRACK_W}
          height={TRACK_H}
          rx={TRACK_H / 2}
          ry={TRACK_H / 2}
          fill="rgba(255,255,255,0.06)"
          stroke={spec.tint.border}
          strokeOpacity={0.45}
          strokeWidth={1.2}
        />
        <rect
          x={Math.min(neutralX, knobCX)}
          y={TRACK_Y}
          width={Math.abs(knobCX - neutralX)}
          height={TRACK_H}
          fill={spec.tint.curve}
          fillOpacity={0.45}
        />
        <line
          x1={neutralX}
          y1={TRACK_Y - 4}
          x2={neutralX}
          y2={TRACK_Y + TRACK_H + 4}
          stroke={TEXT_MUTED}
          strokeWidth={1.2}
        />
        <circle
          cx={knobCX}
          cy={knobCY}
          r={12 + 3 * focus}
          fill={spec.tint.curve}
          fillOpacity={0.18 * focus}
        />
        <circle
          cx={knobCX}
          cy={knobCY}
          r={12}
          fill={spec.tint.curve}
          stroke="rgba(13,12,11,0.95)"
          strokeWidth={2}
        />

        {/* 数値カウンター (下段右、ラベル無し) */}
        <text
          x={cellX + VALUE_X}
          y={VALUE_Y}
          textAnchor="end"
          fill={TEXT_PRIMARY}
          fontSize={22}
          fontWeight={600}
          fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
        >
          {formatParamValue(spec.paramSymbol, p)}
        </text>
      </g>
    </g>
  )
}

export default function CorrectionControlMath({
  isPlaying,
  reducedMotion,
}: {
  isPlaying: boolean
  reducedMotion: boolean
}) {
  // 登場から数えた経過時間。初めて再生されたときに 0 から始まる。
  const [elapsed, setElapsed] = useState(0)
  const lastRef = useRef<number | null>(null)
  const rafRef = useRef<number | null>(null)

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
      const dt = Math.min(0.1, (now - lastRef.current) / 1000)
      lastRef.current = now
      setElapsed((prev) => {
        const next = prev + dt
        // 登場が済んだあとはループ内で回し続ける (数値が大きくなり続けないように)
        return next >= ENTRANCE + LOOP ? next - LOOP : next
      })
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [isPlaying, reducedMotion])

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="absolute inset-0 h-full w-full"
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        {CELLS.map((spec) => {
          const plotX = spec.cellX + PLOT_X
          return (
            <clipPath key={spec.clipId} id={spec.clipId}>
              <rect x={plotX} y={PLOT_Y} width={PLOT_W} height={PLOT_H} />
            </clipPath>
          )
        })}
        {CELLS.map((spec) => (
          <filter
            key={spec.glowId}
            id={spec.glowId}
            x="-10%"
            y="-10%"
            width="120%"
            height="120%"
          >
            <feGaussianBlur stdDeviation={6} />
          </filter>
        ))}
      </defs>

      {/* セル境界線 (横並び 3 本、薄め) */}
      {[1, 2, 3].map((i) => (
        <line
          key={`sep-${i}`}
          x1={CELL_W * i}
          y1={20}
          x2={CELL_W * i}
          y2={H - 20}
          stroke={GRID}
          strokeWidth={1}
          strokeDasharray="6 8"
        />
      ))}

      {CELLS.map((spec) => (
        <Cell key={spec.clipId} spec={spec} state={cellState(spec, elapsed, reducedMotion)} />
      ))}
    </svg>
  )
}
