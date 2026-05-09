"use client"

import { useEffect, useRef, useState } from "react"
import type { VideoVisualProps } from "@/components/notes/note-visual"

const LOOP = 10
const W = 1600
const H = 500
const CELL_W = 800
const NODE_FILL = "rgba(255,255,255,0.08)"
const NODE_STROKE = "rgba(255,255,255,0.40)"
const CELL_STROKE = "rgba(255,255,255,0.16)"
const AXIS_STROKE = "rgba(139,127,255,0.4)"
const LABEL_BG = "#8B7FFF"
const TEXT_PRIMARY = "rgba(32,24,96,0.94)"
const TEXT_MUTED = "rgba(88,78,150,0.82)"
const MAGENTA = "rgb(192,74,142)"
const NAVY = "rgb(42,79,143)"
const AMBER = "rgb(200,146,58)"
const TEAL = "rgb(46,140,132)"
const RING_RED = "rgb(220,80,80)"
const TICK_GREEN = "rgb(80,180,120)"

type AxisId = 0 | 1 | 2 | 3
type ChipKind = "color" | "gray" | "skin"
type Rgb = { r: number; g: number; b: number }
type Chip = { kind: ChipKind; rgb: Rgb; name: string }
type Axis = {
  id: AxisId
  label: string
  order: string
  sub: string
  color: string
  target: string
}

const AXES: Axis[] = [
  {
    id: 0,
    label: "色の広がり・転がり",
    order: "肌の転がりをリッチに",
    sub: "hue +12° / sat +0.18",
    color: MAGENTA,
    target: "+12°",
  },
  {
    id: 1,
    label: "濃度",
    order: "青を深く落として",
    sub: "blue L -0.22",
    color: NAVY,
    target: "-0.22",
  },
  {
    id: 2,
    label: "カーブ",
    order: "もう少し抜けを",
    sub: "S curve amp 0.35",
    color: AMBER,
    target: "0.35",
  },
  {
    id: 3,
    label: "RGB バランス",
    order: "もう少し暖かく",
    sub: "R +0.12 / B -0.12",
    color: TEAL,
    target: "warm",
  },
]

const TEST_CHIPS: Chip[] = [
  { kind: "color", name: "red", rgb: { r: 224, g: 44, b: 58 } },
  { kind: "color", name: "orange", rgb: { r: 235, g: 126, b: 28 } },
  { kind: "color", name: "blue", rgb: { r: 36, g: 94, b: 224 } },
  { kind: "color", name: "green", rgb: { r: 34, g: 172, b: 82 } },
  { kind: "gray", name: "gray12", rgb: gray(0.12) },
  { kind: "gray", name: "gray38", rgb: gray(0.38) },
  { kind: "gray", name: "gray64", rgb: gray(0.64) },
  { kind: "gray", name: "gray86", rgb: gray(0.86) },
  { kind: "skin", name: "skinDark", rgb: { r: 132, g: 78, b: 54 } },
  { kind: "skin", name: "skinMid", rgb: { r: 204, g: 142, b: 102 } },
  { kind: "skin", name: "skinLight", rgb: { r: 230, g: 180, b: 136 } },
  { kind: "skin", name: "skinPale", rgb: { r: 242, g: 204, b: 168 } },
]

const BROKEN_CHIPS = new Set([2, 9, 10])

function gray(v: number): Rgb {
  const c = Math.round(v * 255)
  return { r: c, g: c, b: c }
}

function clamp01(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

function clamp255(v: number) {
  return Math.max(0, Math.min(255, Math.round(v)))
}

function easeInOutCubic(v: number) {
  return v < 0.5 ? 4 * v * v * v : 1 - Math.pow(-2 * v + 2, 3) / 2
}

function rgb({ r, g, b }: Rgb) {
  return `rgb(${clamp255(r)},${clamp255(g)},${clamp255(b)})`
}

function rgba(rgbValue: string, alpha: number) {
  return rgbValue.replace("rgb(", "rgba(").replace(")", `,${alpha})`)
}

function rgbToHsl({ r, g, b }: Rgb) {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0)
  else if (max === gn) h = (bn - rn) / d + 2
  else h = (rn - gn) / d + 4
  return { h: h * 60, s, l }
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  const hue = (((h % 360) + 360) % 360) / 360
  if (s <= 0) return gray(l)
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const channel = (tIn: number) => {
    let t = tIn
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  return {
    r: clamp255(channel(hue + 1 / 3) * 255),
    g: clamp255(channel(hue) * 255),
    b: clamp255(channel(hue - 1 / 3) * 255),
  }
}

function rgbToY({ r, g, b }: Rgb): number {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255
}

function applyHueSat(input: Rgb, p: number) {
  const hsl = rgbToHsl(input)
  return hslToRgb(hsl.h + 12 * p, clamp01(hsl.s + 0.18 * p), hsl.l)
}

function applyDensity(input: Rgb, chip: Chip, p: number) {
  if (chip.kind === "gray") return input
  const hsl = rgbToHsl(input)
  const blueWeight = chip.name === "blue" ? 1 : input.b > input.r && input.b > input.g ? 0.45 : 0.12
  return hslToRgb(hsl.h, hsl.s, clamp01(hsl.l - 0.22 * p * blueWeight))
}

function applyLuminanceCurve(input: Rgb, p: number) {
  const y = rgbToY(input)
  if (y < 1e-6) return input
  const amp = 0.35 * p
  const yNew = clamp01(y + amp * (y - 0.5) * 1.15)
  const scale = yNew / y
  return {
    r: input.r * scale,
    g: input.g * scale,
    b: input.b * scale,
  }
}

function applyWarmBalance(input: Rgb, p: number) {
  const shift = 255 * 0.12 * p
  return { r: input.r + shift, g: input.g, b: input.b - shift }
}

function applyMixedChip(chip: Chip, progress: number[]) {
  let out = chip.rgb
  out = applyHueSat(out, progress[0] ?? 0)
  out = applyDensity(out, chip, progress[1] ?? 0)
  out = applyLuminanceCurve(out, progress[2] ?? 0)
  out = applyWarmBalance(out, progress[3] ?? 0)

  const hueWarm = (progress[0] ?? 0) * (progress[3] ?? 0)
  const densityCurve = (progress[1] ?? 0) * (progress[2] ?? 0)
  const triple = hueWarm * (progress[2] ?? 0)
  if (chip.name === "skinMid") {
    out = { r: out.r - 56 * hueWarm, g: out.g + 32 * hueWarm, b: out.b - 20 * hueWarm }
  }
  if (chip.name === "blue") {
    out = { r: out.r - 36 * densityCurve, g: out.g - 42 * densityCurve, b: out.b - 92 * densityCurve }
  }
  if (chip.name === "skinLight") {
    out = { r: out.r + 74 * triple, g: out.g + 20 * triple, b: out.b - 72 * triple }
  }
  return rgb(out)
}

function applySplitChip(chip: Chip, progress: number[]) {
  let out = chip.rgb
  const p1 = progress[0] ?? 0
  const p2 = progress[1] ?? 0
  const p3 = progress[2] ?? 0
  const p4 = progress[3] ?? 0
  if (chip.kind !== "gray") out = applyHueSat(out, p1)
  out = applyDensity(out, chip, p2)
  out = applyLuminanceCurve(out, p3 * 0.72)
  out = chip.kind === "gray" ? applyWarmBalance(out, p4) : applyWarmBalance(out, p4 * 0.35)
  return rgb(out)
}

function axisProgress(t: number, axisId: AxisId) {
  const start = axisId * 0.5
  if (t < start) return 0
  if (t < start + 0.5) return easeInOutCubic((t - start) / 0.5)
  if (t < 4.5) return 1
  if (t < 5.5) return 1 - easeInOutCubic(t - 4.5)
  return 0
}

function ringOpacity(t: number) {
  if (t < 2) return 0
  if (t < 2.25) return clamp01((t - 2) / 0.25)
  if (t < 4.5) return 1
  if (t < 5.5) return 1 - easeInOutCubic(t - 4.5)
  return 0
}

function tickOpacity(t: number, axisId: AxisId) {
  const doneAt = axisId * 0.5 + 0.5
  const p = clamp01((t - doneAt) / 0.3)
  if (p <= 0 || p >= 1) return 0
  return Math.sin(Math.PI * p)
}

function prepOpacity(t: number) {
  if (t < 5.5) return 1
  return 0.35 + 0.65 * clamp01((t - 5.5) / 1.2)
}

function CellLabel({ x, text }: { x: number; text: string }) {
  return (
    <g>
      <rect x={x} y={26} width={286} height={38} rx={19} fill={LABEL_BG} />
      <text x={x + 143} y={51} textAnchor="middle" fontSize={19} fontWeight={760} fill="white">
        {text}
      </text>
    </g>
  )
}

function OrderStack({ x, progress }: { x: number; progress: number[] }) {
  return (
    <g>
      {AXES.map((axis, i) => {
        const y = 74 + i * 34
        const p = progress[axis.id] ?? 0
        return (
          <g key={axis.id} opacity={0.44 + p * 0.56}>
            <rect x={x} y={y} width={292} height={25} rx={12.5} fill={rgba(axis.color, 0.12)} />
            <circle cx={x + 16} cy={y + 12.5} r={5.5} fill={axis.color} />
            <text x={x + 30} y={y + 17} fontSize={12.5} fontWeight={720} fill={TEXT_PRIMARY}>
              {axis.order}
            </text>
          </g>
        )
      })}
    </g>
  )
}

function Slider({
  x,
  y,
  width,
  axis,
  progress,
}: {
  x: number
  y: number
  width: number
  axis: Axis
  progress: number
}) {
  const trackX = x + 190
  const trackW = width - 222
  const knobX = trackX + trackW * progress
  return (
    <g>
      <text x={x} y={y + 15} fontSize={13.5} fontWeight={740} fill={TEXT_PRIMARY}>
        {axis.label}
      </text>
      <text x={x} y={y + 34} fontSize={10.5} fill={TEXT_MUTED}>
        {axis.sub}
      </text>
      <line x1={trackX} y1={y + 24} x2={trackX + trackW} y2={y + 24} stroke={AXIS_STROKE} strokeWidth={7} strokeLinecap="round" />
      <line x1={trackX} y1={y + 24} x2={knobX} y2={y + 24} stroke={axis.color} strokeWidth={7} strokeLinecap="round" />
      <circle cx={knobX} cy={y + 24} r={11} fill={axis.color} stroke="white" strokeWidth={2.5} />
      <text x={x + width - 8} y={y + 29} textAnchor="end" fontSize={11} fontWeight={700} fill={axis.color}>
        {axis.target}
      </text>
    </g>
  )
}

function ChipGrid({
  x,
  y,
  progress,
  mode,
  opacity,
  brokenRingOpacity = 0,
}: {
  x: number
  y: number
  progress: number[]
  mode: "mixed" | "split"
  opacity: number
  brokenRingOpacity?: number
}) {
  const chipW = 68
  const chipH = 34
  const gap = 8
  return (
    <g opacity={opacity}>
      {TEST_CHIPS.map((chip, i) => {
        const col = i % 4
        const row = Math.floor(i / 4)
        const cx = x + col * (chipW + gap)
        const cy = y + row * (chipH + gap)
        const fill = mode === "mixed" ? applyMixedChip(chip, progress) : applySplitChip(chip, progress)
        return (
          <g key={`${mode}-${chip.name}`}>
            <rect x={cx} y={cy} width={chipW} height={chipH} rx={7} fill={fill} stroke="rgba(255,255,255,0.68)" />
            {mode === "mixed" && BROKEN_CHIPS.has(i) ? (
              <rect
                x={cx - 3}
                y={cy - 3}
                width={chipW + 6}
                height={chipH + 6}
                rx={10}
                fill="none"
                stroke={RING_RED}
                strokeWidth={3}
                opacity={brokenRingOpacity}
              />
            ) : null}
          </g>
        )
      })}
    </g>
  )
}

function MixedCell({ progress, t }: { progress: number[]; t: number }) {
  const ring = ringOpacity(t)
  const opacity = prepOpacity(t)
  return (
    <g opacity={opacity}>
      <CellLabel x={82} text="混ぜる：1 ノードで全部" />
      <OrderStack x={464} progress={progress} />
      <rect x={74} y={86} width={340} height={356} rx={22} fill={NODE_FILL} stroke={NODE_STROKE} />
      <text x={244} y={119} textAnchor="middle" fontSize={20} fontWeight={760} fill={TEXT_PRIMARY}>
        1 node
      </text>
      {AXES.map((axis, i) => (
        <Slider
          key={axis.id}
          x={104}
          y={142 + i * 54}
          width={282}
          axis={axis}
          progress={progress[axis.id] ?? 0}
        />
      ))}
      <ChipGrid x={466} y={236} progress={progress} mode="mixed" opacity={1} brokenRingOpacity={ring} />
      <g opacity={ring}>
        <rect x={478} y={374} width={258} height={36} rx={18} fill={rgba(RING_RED, 0.12)} stroke={RING_RED} strokeOpacity={0.52} />
        <text x={607} y={397} textAnchor="middle" fontSize={15} fontWeight={760} fill={RING_RED}>
          3 chip が軸間干渉で崩れる
        </text>
      </g>
    </g>
  )
}

function SplitCell({ progress, t }: { progress: number[]; t: number }) {
  const opacity = prepOpacity(t)
  return (
    <g opacity={opacity}>
      <CellLabel x={880} text="分ける：4 ノードに割る" />
      <OrderStack x={1224} progress={progress} />
      {AXES.map((axis, i) => {
        const y = 88 + i * 79
        const tick = tickOpacity(t, axis.id)
        return (
          <g key={axis.id}>
            <rect x={868} y={y} width={314} height={60} rx={18} fill={NODE_FILL} stroke={NODE_STROKE} />
            <circle cx={892} cy={y + 30} r={8} fill={axis.color} />
            <Slider x={910} y={y + 8} width={240} axis={axis} progress={progress[axis.id] ?? 0} />
            <text x={1164} y={y + 40} fontSize={28} fontWeight={800} fill={TICK_GREEN} opacity={tick}>
              ✓
            </text>
          </g>
        )
      })}
      <ChipGrid x={1240} y={244} progress={progress} mode="split" opacity={1} />
      <rect x={1252} y={374} width={236} height={36} rx={18} fill={rgba(TICK_GREEN, 0.12)} stroke={TICK_GREEN} strokeOpacity={0.42} />
      <text x={1370} y={397} textAnchor="middle" fontSize={15} fontWeight={760} fill={TICK_GREEN}>
        12 chip が安定着地
      </text>
    </g>
  )
}

export default function GradingMixVsSplit({
  isPlaying,
  reducedMotion,
}: VideoVisualProps) {
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

  const t = reducedMotion ? 3 : animT
  const progress = AXES.map((axis) => axisProgress(t, axis.id))

  return (
    <svg
      viewBox="0 0 1600 500"
      className="absolute inset-0 h-full w-full"
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <radialGradient id="gmvs-aurora-purple" cx="22%" cy="12%" r="64%">
          <stop offset="0%" stopColor="rgba(139,127,255,0.42)" />
          <stop offset="100%" stopColor="rgba(139,127,255,0)" />
        </radialGradient>
        <radialGradient id="gmvs-aurora-pink" cx="92%" cy="8%" r="58%">
          <stop offset="0%" stopColor="rgba(192,74,142,0.30)" />
          <stop offset="100%" stopColor="rgba(192,74,142,0)" />
        </radialGradient>
        <radialGradient id="gmvs-aurora-sky" cx="58%" cy="100%" r="72%">
          <stop offset="0%" stopColor="rgba(46,140,132,0.28)" />
          <stop offset="100%" stopColor="rgba(46,140,132,0)" />
        </radialGradient>
      </defs>
      <rect x={0} y={0} width={W} height={H} fill="rgba(255,255,255,0.16)" />
      <rect x={0} y={0} width={W} height={H} fill="url(#gmvs-aurora-purple)" />
      <rect x={0} y={0} width={W} height={H} fill="url(#gmvs-aurora-pink)" />
      <rect x={0} y={0} width={W} height={H} fill="url(#gmvs-aurora-sky)" />
      <line x1={CELL_W} y1={24} x2={CELL_W} y2={476} stroke={CELL_STROKE} strokeWidth={1.5} />
      <MixedCell progress={progress} t={t} />
      <SplitCell progress={progress} t={t} />
    </svg>
  )
}
