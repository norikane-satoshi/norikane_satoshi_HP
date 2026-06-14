"use client"

import { useEffect, useRef, useState } from "react"

/**
 * v5 動画モジュール: 操作の数学 (オペとノブの対応) — 横一列 4 セル帯レイアウト
 *
 * viewBox 1600×500 (16:5) を 4 セル横並び (各 400×500) に分け、
 * ゲイン (赤系) / ガンマ (緑系) / オフセット (黄系) / リフト (青系) の
 * 4 ミニ図を独立位相で 6.5 秒ループさせる。
 *
 * 各セルは縦 3 層構造:
 *   上段 — 「原因名（カテゴリ） 数式」を 1 行見出し
 *   中段 — 入出力トーンカーブ (補助要素は最小化)
 *   下段 — スライダーバー + 数値カウンター 1 行
 *
 *   ゲイン a(t)    = 1.25 + 0.75 · sin(2π t / 6.5)         ∈ [0.5, 2.0]
 *   ガンマ γ(t)    = 1.25 + 0.75 · sin(2π t / 6.5 + π/2)   ∈ [0.5, 2.0]
 *   オフセット b(t) = 0.3  · sin(2π t / 6.5 + π)            ∈ [-0.3, 0.3]
 *   リフト L(t)    = 0.25 + 0.25 · sin(2π t / 6.5 + 3π/2)  ∈ [0, 0.5]
 *
 * reducedMotion 時は各パラメータを range 中央値で固定して静止画化する。
 */

const LOOP = 6.5
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

const TEXT_PRIMARY = "rgba(28,15,110,0.95)"
const GRID = "rgba(139,127,255,0.18)"

// 配色 (前作 correction-labyrinth-to-factor.tsx の TINT パレットと整合)
const TINT_GAIN = {
  border: "rgba(214,127,140,0.85)",
  bg: "rgba(214,127,140,0.10)",
  curve: "rgb(180,60,80)",
}
const TINT_GAMMA = {
  border: "rgba(108,180,170,0.85)",
  bg: "rgba(108,180,170,0.10)",
  curve: "rgb(45,135,120)",
}
const TINT_OFFSET = {
  border: "rgba(214,162,108,0.85)",
  bg: "rgba(214,162,108,0.10)",
  curve: "rgb(170,115,55)",
}
const TINT_LIFT = {
  border: "rgba(120,165,225,0.85)",
  bg: "rgba(120,165,225,0.10)",
  curve: "rgb(55,108,180)",
}

type Tint = typeof TINT_GAIN

type CellSpec = {
  cellX: number
  opLabel: string
  formula: string
  paramSymbol: "a" | "γ" | "b" | "L"
  tint: Tint
  param: (t: number) => number
  curve: (x: number, p: number) => number
  range: [number, number]
  clipId: string
}

function paramGain(t: number) {
  return 1.25 + 0.75 * Math.sin((2 * Math.PI * t) / LOOP)
}
function paramGamma(t: number) {
  return 1.25 + 0.75 * Math.sin((2 * Math.PI * t) / LOOP + Math.PI / 2)
}
function paramOffset(t: number) {
  return 0.3 * Math.sin((2 * Math.PI * t) / LOOP + Math.PI)
}
function paramLift(t: number) {
  return 0.25 + 0.25 * Math.sin((2 * Math.PI * t) / LOOP + (3 * Math.PI) / 2)
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
    cellX: 0,
    opLabel: "ゲイン（乗算）",
    formula: "y = a · x",
    paramSymbol: "a",
    tint: TINT_GAIN,
    param: paramGain,
    curve: curveGain,
    range: [0.5, 2.0],
    clipId: "ccm-clip-gain",
  },
  {
    cellX: CELL_W,
    opLabel: "ガンマ（べき乗）",
    formula: "y = x^γ",
    paramSymbol: "γ",
    tint: TINT_GAMMA,
    param: paramGamma,
    curve: curveGamma,
    range: [0.5, 2.0],
    clipId: "ccm-clip-gamma",
  },
  {
    cellX: CELL_W * 2,
    opLabel: "オフセット（加算）",
    formula: "y = x + b",
    paramSymbol: "b",
    tint: TINT_OFFSET,
    param: paramOffset,
    curve: curveOffset,
    range: [-0.3, 0.3],
    clipId: "ccm-clip-offset",
  },
  {
    cellX: CELL_W * 3,
    opLabel: "リフト（合成）",
    formula: "y = x + L · (1 − x)",
    paramSymbol: "L",
    tint: TINT_LIFT,
    param: paramLift,
    curve: curveLift,
    range: [0, 0.5],
    clipId: "ccm-clip-lift",
  },
]

// 96 サンプルで polyline。極端値でも輪郭がガタつかないよう中庸を取る (仕様: 64〜96)。
const SAMPLES = 96

function buildPolyline(
  curve: (x: number, p: number) => number,
  p: number,
  plotX: number,
  plotY: number
) {
  const points: string[] = []
  for (let i = 0; i <= SAMPLES; i++) {
    const x = i / SAMPLES
    const y = curve(x, p)
    const sx = plotX + x * PLOT_W
    const sy = plotY + PLOT_H - y * PLOT_H
    points.push(`${sx.toFixed(2)},${sy.toFixed(2)}`)
  }
  return points.join(" ")
}

function clamp01(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v
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

function Cell({
  spec,
  t,
  reducedMotion,
}: {
  spec: CellSpec
  t: number
  reducedMotion: boolean
}) {
  // reducedMotion: range の中央値で固定 (a=1.25 / γ=1.25 / b=0 / L=0.25)。
  const p = reducedMotion
    ? (spec.range[0] + spec.range[1]) / 2
    : spec.param(t)
  const cellX = spec.cellX

  const plotX = cellX + PLOT_X
  const plotY = PLOT_Y
  const polyPoints = buildPolyline(spec.curve, p, plotX, plotY)
  const knobCX = knobScreenX(p, spec.range, cellX)
  const knobCY = TRACK_Y + TRACK_H / 2

  return (
    <g>
      {/* セル背景 (色カテゴリ識別) */}
      <rect
        x={cellX + 10}
        y={10}
        width={CELL_W - 20}
        height={CELL_H - 20}
        rx={20}
        ry={20}
        fill={spec.tint.bg}
        stroke={spec.tint.border}
        strokeOpacity={0.55}
        strokeWidth={1.4}
      />
      <rect
        x={cellX + 10}
        y={10}
        width={CELL_W - 20}
        height={CELL_H - 20}
        rx={20}
        ry={20}
        fill="rgba(255,255,255,0.55)"
      />

      {/* 1 行見出し: 原因名（カテゴリ） + 数式 */}
      <text
        x={cellX + HEADER_X}
        y={HEADER_Y}
        fontSize={22}
        fontWeight={700}
      >
        <tspan fill={spec.tint.curve}>{spec.opLabel}</tspan>
        <tspan
          dx={14}
          fill={TEXT_PRIMARY}
          fontWeight={600}
          fontStyle="italic"
        >
          {spec.formula}
        </tspan>
      </text>

      {/* plot 枠 (極めて薄い背景のみ。座標目盛り・軸ラベルは置かない) */}
      <rect
        x={plotX}
        y={plotY}
        width={PLOT_W}
        height={PLOT_H}
        rx={4}
        ry={4}
        fill="rgba(255,255,255,0.4)"
        stroke={GRID}
        strokeWidth={1}
      />

      {/* 入出力カーブ (plot 領域でクリップ) */}
      <g clipPath={`url(#${spec.clipId})`}>
        <polyline
          points={polyPoints}
          fill="none"
          stroke={spec.tint.curve}
          strokeWidth={3.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>

      {/* スライダーバー (下段左) */}
      <rect
        x={cellX + TRACK_X}
        y={TRACK_Y}
        width={TRACK_W}
        height={TRACK_H}
        rx={TRACK_H / 2}
        ry={TRACK_H / 2}
        fill="rgba(255,255,255,0.7)"
        stroke={spec.tint.border}
        strokeOpacity={0.55}
        strokeWidth={1.2}
      />
      <circle
        cx={knobCX}
        cy={knobCY}
        r={12}
        fill={spec.tint.curve}
        stroke="rgba(255,255,255,0.95)"
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
  )
}

export default function CorrectionControlMath({
  isPlaying,
  reducedMotion,
}: {
  isPlaying: boolean
  reducedMotion: boolean
}) {
  const [animT, setAnimT] = useState(0)
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

  const t = animT

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
        <Cell
          key={spec.clipId}
          spec={spec}
          t={t}
          reducedMotion={reducedMotion}
        />
      ))}
    </svg>
  )
}
