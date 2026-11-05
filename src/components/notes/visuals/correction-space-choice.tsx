"use client"

import { useEffect, useRef, useState } from "react"

/**
 * v5 動画モジュール: 作業空間の選択 (Log / Linear / Gamma) — 横一列 3 セル
 *
 * viewBox 1600×500 (16:5) を 3 セル横並びに分け、
 * 同じ強さのパラメータ揺れを各空間の自然な操作で当てたときの
 * トーンカーブの応答を 6.5 秒ループで比較する。correction-control-math.tsx の
 * 16:5 比と外形サイズに揃えている。
 *
 * 各セルは縦 3 層構造:
 *   上段 — 空間名 (Log / Linear / Gamma) と当てる操作 (＋ オフセット / × ゲイン / ゲイン ×)
 *   中段 — トーンカーブの plot (x, y ∈ [0, 1.4] × [0, 1.5])。0..1 を超えた領域は
 *          薄い赤帯で「out of range」を示す。識別線として y=x を点線。
 *   下段 — 物理 / レンジ ピル + 数値 readout を同じ Y に並べた 1 行レイアウト
 *
 *   Log:    y = log2(7x + 1) / 3 + b,  b(t) = 0.30 · sin(2π t / 6.5)         ∈ [-0.30, 0.30]
 *   Linear: y = a · x,                  a(t) = 1.25 + 0.75 · sin(2π t / 6.5)   ∈ [ 0.50, 2.00]
 *   Gamma:  y = a · x^2.4,              a(t) = 1.25 + 0.75 · sin(2π t / 6.5)   ∈ [ 0.50, 2.00]
 *
 * Gamma セルは γ=2.4 を固定し、そこへ掛けるゲイン a だけを時間揺らしする。
 * γ 固定の下膨らみを維持しながら、ゲイン操作が光物理に乗ることを示す。
 *
 * Log セルの「物理 △」ピル右にアテンションバッジ ("i") を置く。クリックで
 * 注意書きを展開: 「ACEScは物理 ○、ACEScct のときは ○△」。○△ は ○ の中に
 * △ が入った専用シンボルとして SVG で組む。useState のみで初期 render は
 * 閉じた状態。SSR safe / curve 描画の純関数性は維持。
 *
 * 動き (2026-11-05 リッチ化): 登場時にセルが左から浮かび上がり、3 空間で同じノブを
 * 「上げて止め、下げて止め、中立へ戻す」。止まる位置でわずかに行き過ぎる。
 * 1 を超えた部分の曲線だけ赤く光らせ、はみ出した瞬間を目立たせる。
 *
 * reducedMotion 時はパラメータを range 中央値で固定して静止画化する
 * (Log: b=0 / Linear: a=1.25 / Gamma: a=1.25)。
 */

const LOOP = 8
const ENTRANCE_DUR = 1.4
const W = 1600
const H = 500
const CELL_W = W / 3
const CELL_H = H

// セル内レイアウト (セル相対座標)
const HEADER_X = 30
const HEADER_Y = 50
const SUB_Y = 78

const PLOT_X = 30
const PLOT_Y = 100
const PLOT_W = CELL_W - PLOT_X * 2
const PLOT_H = 280
const PLOT_X_MAX = 1.4
const PLOT_Y_MAX = 1.5

const TICK_LABEL_Y = PLOT_Y + PLOT_H + 18 // 398

const PILL_W = 104
const PILL_H = 36
const PILL_GAP = 12
const VERDICT_Y = 422
// 値 readout は pill 行の中心ベースラインに揃える
const VALUE_Y = VERDICT_Y + PILL_H / 2 + 8 // 448

const TEXT_PRIMARY = "rgba(236,230,220,0.95)"
const TEXT_MUTED = "rgba(236,230,220,0.55)"
const GRID = "rgba(127,176,255,0.18)"
const REF_LINE = "rgba(236,230,220,0.30)"
const OUT_OF_RANGE_FILL = "rgba(214,95,95,0.10)"
const OUT_OF_RANGE_STROKE = "rgba(214,95,95,0.45)"

// 配色 (前作 4 マーカーの TINT パレットと重複しない 3 色)
const TINT_LOG = {
  border: "rgba(205,162,131,0.85)",
  bg: "rgba(205,162,131,0.10)",
  curve: "rgb(220,160,117)",
}
const TINT_LINEAR = {
  border: "rgba(118,146,219,0.85)",
  bg: "rgba(118,146,219,0.10)",
  curve: "rgb(114,139,222)",
}
const TINT_GAMMA = {
  border: "rgba(60,150,110,0.85)",
  bg: "rgba(60,150,110,0.10)",
  curve: "rgb(116,221,171)",
}

type Tint = typeof TINT_LOG
type Verdict = "ok" | "warn" | "ng"

const VERDICT_GLYPH: Record<Verdict, string> = {
  ok: "○",
  warn: "△",
  ng: "✗",
}
const VERDICT_COLOR: Record<Verdict, string> = {
  ok: "rgb(116,221,171)",
  warn: "rgb(205,162,131)",
  ng: "rgb(216,121,137)",
}

function easeInOutCubic(x: number) {
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2
}
// 止まる位置でわずかに行き過ぎて戻る (手で回したノブの感触)。
function easeOutBack(x: number) {
  const c1 = 1.2
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2)
}
/**
 * 3 つの空間で同じノブを同時に回す。0..1 の「回し量」を返す
 * (0 = 中立、+1 = 上げきり、−1 = 下げきり)。上げて止め、下げて止め、中立へ戻る。
 */
function knobAmount(t: number) {
  if (t < 1.4) return easeOutBack(t / 1.4)
  if (t < 3.0) return 1
  if (t < 4.6) return 1 - 2 * easeOutBack((t - 3.0) / 1.6)
  if (t < 6.2) return -1
  if (t < 7.6) return -1 + easeInOutCubic((t - 6.2) / 1.4)
  return 0
}
function paramA(t: number) {
  const k = knobAmount(t)
  return k >= 0 ? 1 + 0.9 * k : 1 + 0.5 * k
}
function paramB(t: number) {
  return 0.28 * knobAmount(t)
}
const GAMMA_FIXED = 2.4

function curveLinear(x: number, a: number) {
  return a * x
}
function curveLog(x: number, b: number) {
  return Math.log2(7 * Math.max(0, x) + 1) / 3 + b
}
function curveGammaGain(x: number, a: number) {
  return a * Math.pow(Math.max(0, x), GAMMA_FIXED)
}

type CellSpec = {
  cellX: number
  spaceLabel: string
  operationLabel: string
  paramSymbol: string
  param: (t: number) => number
  curve: (x: number, p: number) => number
  reducedValue: number
  formatValue: (p: number) => string
  tint: Tint
  verdictPhysics: Verdict
  verdictRange: Verdict
  clipId: string
  hasPhysicsTooltip?: boolean
}

const CELLS: CellSpec[] = [
  {
    cellX: 0,
    spaceLabel: "Log",
    operationLabel: "＋ オフセット",
    paramSymbol: "b",
    param: paramB,
    curve: curveLog,
    reducedValue: 0,
    formatValue: (b) => `${b >= 0 ? "+" : "−"}${Math.abs(b).toFixed(2)}`,
    tint: TINT_LOG,
    verdictPhysics: "warn",
    verdictRange: "ok",
    clipId: "csc-clip-log",
    hasPhysicsTooltip: true,
  },
  {
    cellX: CELL_W,
    spaceLabel: "Linear",
    operationLabel: "× ゲイン",
    paramSymbol: "a",
    param: paramA,
    curve: curveLinear,
    reducedValue: 1.25,
    formatValue: (a) => a.toFixed(2),
    tint: TINT_LINEAR,
    verdictPhysics: "ok",
    verdictRange: "ng",
    clipId: "csc-clip-linear",
  },
  {
    cellX: CELL_W * 2,
    spaceLabel: "Gamma",
    operationLabel: "ゲイン ×",
    paramSymbol: "a",
    param: paramA,
    curve: curveGammaGain,
    reducedValue: 1.25,
    formatValue: (a) => a.toFixed(2),
    tint: TINT_GAMMA,
    verdictPhysics: "ok",
    verdictRange: "ok",
    clipId: "csc-clip-gamma",
  },
]

const SAMPLES = 96

function buildPolyline(
  curve: (x: number, p: number) => number,
  p: number,
  plotX: number,
  plotY: number
) {
  const points: string[] = []
  for (let i = 0; i <= SAMPLES; i++) {
    const x = (i / SAMPLES) * PLOT_X_MAX
    const y = curve(x, p)
    const sx = plotX + (x / PLOT_X_MAX) * PLOT_W
    const sy = plotY + PLOT_H - (y / PLOT_Y_MAX) * PLOT_H
    points.push(`${sx.toFixed(2)},${sy.toFixed(2)}`)
  }
  return points.join(" ")
}

function VerdictPill({
  label,
  verdict,
  x,
}: {
  label: string
  verdict: Verdict
  x: number
}) {
  return (
    <g transform={`translate(${x}, 0)`}>
      <rect
        x={0}
        y={0}
        width={PILL_W}
        height={PILL_H}
        rx={PILL_H / 2}
        ry={PILL_H / 2}
        fill="rgba(13,12,11,0.78)"
        stroke="rgba(236,230,220,0.18)"
        strokeWidth={1.2}
      />
      <text
        x={14}
        y={PILL_H / 2 + 5}
        fontSize={15}
        fontWeight={600}
        fill={TEXT_MUTED}
      >
        {label}
      </text>
      <text
        x={PILL_W - 22}
        y={PILL_H / 2 + 9}
        textAnchor="middle"
        fontSize={22}
        fontWeight={700}
        fill={VERDICT_COLOR[verdict]}
      >
        {VERDICT_GLYPH[verdict]}
      </text>
    </g>
  )
}

/**
 * 「○△」記号 — 円の中に三角を内接させた専用シンボル。
 * VERDICT_GLYPH の単一文字流用は不可なので SVG で組む。
 */
function CircleTriangleGlyph({
  cx,
  cy,
  r,
  color,
}: {
  cx: number
  cy: number
  r: number
  color: string
}) {
  const tr = r * 0.62
  const p1 = `${cx},${(cy - tr).toFixed(2)}`
  const p2 = `${(cx - tr * Math.sin(Math.PI / 3)).toFixed(2)},${(cy + tr / 2).toFixed(2)}`
  const p3 = `${(cx + tr * Math.sin(Math.PI / 3)).toFixed(2)},${(cy + tr / 2).toFixed(2)}`
  return (
    <g>
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={1.6}
      />
      <polygon
        points={`${p1} ${p2} ${p3}`}
        fill="none"
        stroke={color}
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
    </g>
  )
}

const PHYSICS_TOOLTIP_W = 372
const PHYSICS_TOOLTIP_H = 64
const PHYSICS_TOOLTIP_GAP = 14
const BADGE_OFFSET = 32 // レンジ pill を物理 pill から右に押し出す量 (バッジを置けるだけのスペース)

function PhysicsAttentionBadge({
  cellX,
  pillsAnchorX,
  open,
  onToggle,
}: {
  cellX: number
  pillsAnchorX: number
  open: boolean
  onToggle: () => void
}) {
  // バッジは「物理」ピル直右の重畳位置 (ピル右端 + 6) に配置
  const badgeR = 12
  const badgeCx = cellX + pillsAnchorX + PILL_W + 6 + badgeR
  const badgeCy = VERDICT_Y + PILL_H / 2
  const badgeFill = TINT_LOG.curve
  const badgeText = "rgba(13,12,11,0.96)"

  // ツールチップは verdict 行の上に展開 (下に寄せると VALUE_Y と被る)
  const tipX = Math.min(
    Math.max(cellX + 18, badgeCx - PHYSICS_TOOLTIP_W / 2),
    cellX + CELL_W - 18 - PHYSICS_TOOLTIP_W
  )
  const tipY = VERDICT_Y - PHYSICS_TOOLTIP_GAP - PHYSICS_TOOLTIP_H

  return (
    <g>
      {/* バッジ本体 (クリッカブル) */}
      <g
        role="button"
        tabIndex={0}
        aria-expanded={open}
        aria-label="物理判定の補足"
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            onToggle()
          }
        }}
        style={{ cursor: "pointer" }}
      >
        <circle
          cx={badgeCx}
          cy={badgeCy}
          r={badgeR}
          fill={badgeFill}
          stroke="rgba(13,12,11,0.85)"
          strokeWidth={1.4}
        />
        <text
          x={badgeCx}
          y={badgeCy + 5}
          textAnchor="middle"
          fontSize={14}
          fontWeight={700}
          fill={badgeText}
          fontFamily="ui-serif, Georgia, 'Times New Roman', serif"
          fontStyle="italic"
          style={{ pointerEvents: "none" }}
        >
          i
        </text>
      </g>

      {/* ツールチップ (open のときだけ描画) */}
      {open ? (
        <g style={{ pointerEvents: "none" }}>
          <rect
            x={tipX}
            y={tipY}
            width={PHYSICS_TOOLTIP_W}
            height={PHYSICS_TOOLTIP_H}
            rx={10}
            ry={10}
            fill="rgba(13,12,11,0.97)"
            stroke={TINT_LOG.border}
            strokeWidth={1.2}
          />
          {/* 下向きポインター */}
          <polygon
            points={`${badgeCx - 8},${tipY + PHYSICS_TOOLTIP_H} ${badgeCx + 8},${tipY + PHYSICS_TOOLTIP_H} ${badgeCx},${tipY + PHYSICS_TOOLTIP_H + 8}`}
            fill="rgba(13,12,11,0.97)"
            stroke={TINT_LOG.border}
            strokeWidth={1.2}
          />
          <line
            x1={badgeCx - 8}
            y1={tipY + PHYSICS_TOOLTIP_H}
            x2={badgeCx + 8}
            y2={tipY + PHYSICS_TOOLTIP_H}
            stroke="rgba(13,12,11,0.97)"
            strokeWidth={1.6}
          />
          {/* 1 行目: ACEScは物理 ○ */}
          <text
            x={tipX + 18}
            y={tipY + 26}
            fontSize={14}
            fontWeight={500}
            fill={TEXT_PRIMARY}
          >
            ACEScは物理
          </text>
          <text
            x={tipX + 110}
            y={tipY + 26}
            fontSize={16}
            fontWeight={700}
            fill={VERDICT_COLOR.ok}
          >
            ○
          </text>
          {/* 2 行目: ACEScct のときは ○△ */}
          <text
            x={tipX + 18}
            y={tipY + 50}
            fontSize={14}
            fontWeight={500}
            fill={TEXT_PRIMARY}
          >
            ACEScct のときは
          </text>
          <CircleTriangleGlyph
            cx={tipX + 162}
            cy={tipY + 45}
            r={9}
            color={VERDICT_COLOR.warn}
          />
        </g>
      ) : null}
    </g>
  )
}

function Cell({
  spec,
  t,
  reducedMotion,
  enter,
}: {
  spec: CellSpec
  t: number
  reducedMotion: boolean
  enter: number
}) {
  const p = reducedMotion ? spec.reducedValue : spec.param(t)
  const cellX = spec.cellX
  const plotX = cellX + PLOT_X
  const plotY = PLOT_Y
  const polyPoints = buildPolyline(spec.curve, p, plotX, plotY)

  const ySignalTop = plotY + PLOT_H - (1.0 / PLOT_Y_MAX) * PLOT_H
  const refEndNorm = Math.min(PLOT_X_MAX, PLOT_Y_MAX)
  const refStartX = plotX
  const refStartY = plotY + PLOT_H
  const refEndX = plotX + (refEndNorm / PLOT_X_MAX) * PLOT_W
  const refEndY = plotY + PLOT_H - (refEndNorm / PLOT_Y_MAX) * PLOT_H
  const xOneScreen = plotX + (1.0 / PLOT_X_MAX) * PLOT_W
  const overRangeId = `${spec.clipId}-over`

  return (
    <g opacity={enter} transform={`translate(0 ${((1 - enter) * 24).toFixed(2)})`}>
      <defs>
        <clipPath id={overRangeId}>
          <rect x={plotX} y={plotY} width={PLOT_W} height={ySignalTop - plotY} />
        </clipPath>
      </defs>
      {/* セル背景 */}
      <rect
        x={cellX + 18}
        y={18}
        width={CELL_W - 36}
        height={CELL_H - 36}
        rx={20}
        ry={20}
        fill={spec.tint.bg}
        stroke={spec.tint.border}
        strokeOpacity={0.55}
        strokeWidth={1.4}
      />
      <rect
        x={cellX + 18}
        y={18}
        width={CELL_W - 36}
        height={CELL_H - 36}
        rx={20}
        ry={20}
        fill="rgba(13,12,11,0.55)"
      />

      {/* Header */}
      <text
        x={cellX + HEADER_X}
        y={HEADER_Y}
        fontSize={32}
        fontWeight={700}
        fill={spec.tint.curve}
      >
        {spec.spaceLabel}
      </text>
      <text
        x={cellX + HEADER_X}
        y={SUB_Y}
        fontSize={17}
        fontWeight={600}
        fill={TEXT_PRIMARY}
        fontStyle="italic"
      >
        {spec.operationLabel} {spec.paramSymbol}
      </text>

      {/* plot 枠 */}
      <rect
        x={plotX}
        y={plotY}
        width={PLOT_W}
        height={PLOT_H}
        rx={6}
        ry={6}
        fill="rgba(13,12,11,0.45)"
        stroke={GRID}
        strokeWidth={1}
      />

      {/* y > 1 の out-of-range 帯 */}
      <rect
        x={plotX}
        y={plotY}
        width={PLOT_W}
        height={ySignalTop - plotY}
        fill={OUT_OF_RANGE_FILL}
      />
      <line
        x1={plotX}
        y1={ySignalTop}
        x2={plotX + PLOT_W}
        y2={ySignalTop}
        stroke={OUT_OF_RANGE_STROKE}
        strokeWidth={1.4}
        strokeDasharray="6 6"
      />
      <text
        x={plotX + PLOT_W - 10}
        y={plotY + 22}
        textAnchor="end"
        fontSize={12}
        fill="rgba(216,121,137,0.88)"
        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
      >
        out of range
      </text>
      <text
        x={plotX + PLOT_W - 10}
        y={ySignalTop + 18}
        textAnchor="end"
        fontSize={11}
        fill={TEXT_MUTED}
        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
      >
        y = 1
      </text>

      {/* 識別線 y = x */}
      <line
        x1={refStartX}
        y1={refStartY}
        x2={refEndX}
        y2={refEndY}
        stroke={REF_LINE}
        strokeWidth={1.2}
        strokeDasharray="4 6"
      />

      {/* 入出力カーブ */}
      <g clipPath={`url(#${spec.clipId})`}>
        {/* 発光 (暗い地の上で線が光って見えるよう、ぼかした太線を下に敷く) */}
        <polyline
          points={polyPoints}
          fill="none"
          stroke={spec.tint.curve}
          strokeOpacity={0.4}
          strokeWidth={10}
          strokeLinecap="round"
          strokeLinejoin="round"
          filter="url(#csc-glow)"
        />
        <polyline
          points={polyPoints}
          fill="none"
          stroke={spec.tint.curve}
          strokeWidth={3.6}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
      {/* 1 を超えた部分だけ赤く光らせ、はみ出した瞬間を目立たせる */}
      <g clipPath={`url(#${overRangeId})`}>
        <polyline
          points={polyPoints}
          fill="none"
          stroke="rgb(236,110,110)"
          strokeOpacity={0.55}
          strokeWidth={12}
          strokeLinecap="round"
          strokeLinejoin="round"
          filter="url(#csc-glow)"
        />
        <polyline
          points={polyPoints}
          fill="none"
          stroke="rgb(240,140,140)"
          strokeWidth={3.6}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>

      {/* x = 1 tick */}
      <line
        x1={xOneScreen}
        y1={plotY + PLOT_H}
        x2={xOneScreen}
        y2={plotY + PLOT_H + 6}
        stroke={TEXT_MUTED}
        strokeWidth={1}
      />
      <text
        x={xOneScreen}
        y={TICK_LABEL_Y}
        textAnchor="middle"
        fontSize={11}
        fill={TEXT_MUTED}
        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
      >
        x = 1
      </text>

      {/* Verdict 二判定 + 値 readout を同 Y で並べる */}
      <g transform={`translate(${cellX + HEADER_X}, ${VERDICT_Y})`}>
        <VerdictPill label="物理" verdict={spec.verdictPhysics} x={0} />
        <VerdictPill
          label="レンジ"
          verdict={spec.verdictRange}
          x={PILL_W + PILL_GAP + (spec.hasPhysicsTooltip ? BADGE_OFFSET : 0)}
        />
      </g>
      <text
        x={cellX + CELL_W - HEADER_X}
        y={VALUE_Y}
        textAnchor="end"
        fill={TEXT_PRIMARY}
        fontSize={20}
        fontWeight={600}
        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
      >
        {spec.paramSymbol} = {spec.formatValue(p)}
      </text>
    </g>
  )
}

export default function CorrectionSpaceChoice({
  isPlaying,
  reducedMotion,
}: {
  isPlaying: boolean
  reducedMotion: boolean
}) {
  const [animT, setAnimT] = useState(0)
  // 図が初めて画面に入ってからの時間 (登場アニメーション用)。登場中はノブを中立のまま待つ
  const [shown, setShown] = useState(0)
  const shownRef = useRef(0)
  const [physicsTooltipOpen, setPhysicsTooltipOpen] = useState(false)
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
      if (shownRef.current < ENTRANCE_DUR) {
        shownRef.current = Math.min(ENTRANCE_DUR, shownRef.current + dt)
        setShown(shownRef.current)
      } else {
        setAnimT((a) => (a + dt) % LOOP)
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [isPlaying, reducedMotion])

  const t = animT
  const enterOf = (i: number) =>
    reducedMotion ? 1 : 1 - Math.pow(1 - Math.min(1, Math.max(0, (shown - i * 0.15) / 0.7)), 3)
  const logCell = CELLS.find((c) => c.hasPhysicsTooltip)

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="absolute inset-0 h-full w-full"
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <filter id="csc-glow" x="-10%" y="-10%" width="120%" height="120%">
          <feGaussianBlur stdDeviation={6} />
        </filter>
        {CELLS.map((spec) => {
          const plotX = spec.cellX + PLOT_X
          return (
            <clipPath key={spec.clipId} id={spec.clipId}>
              <rect x={plotX} y={PLOT_Y} width={PLOT_W} height={PLOT_H} />
            </clipPath>
          )
        })}
      </defs>

      {/* セル境界線 (横並び 2 本、薄め) */}
      {[1, 2].map((i) => (
        <line
          key={`sep-${i}`}
          x1={CELL_W * i}
          y1={28}
          x2={CELL_W * i}
          y2={H - 28}
          stroke={GRID}
          strokeWidth={1}
          strokeDasharray="6 8"
        />
      ))}

      {CELLS.map((spec, i) => (
        <Cell
          key={spec.clipId}
          spec={spec}
          t={t}
          reducedMotion={reducedMotion}
          enter={enterOf(i)}
        />
      ))}

      {/* Log セルの物理アテンションバッジ + ツールチップ */}
      {logCell ? (
        <PhysicsAttentionBadge
          cellX={logCell.cellX}
          pillsAnchorX={HEADER_X}
          open={physicsTooltipOpen}
          onToggle={() => setPhysicsTooltipOpen((v) => !v)}
        />
      ) : null}
    </svg>
  )
}
