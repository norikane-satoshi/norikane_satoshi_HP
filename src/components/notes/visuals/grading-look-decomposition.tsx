"use client"

import { useEffect, useRef, useState } from "react"
import type { VideoVisualProps } from "@/components/notes/note-visual"

const LOOP = 18
const W = 1600
const H = 500

const TEXT_PRIMARY = "rgba(28,15,110,0.94)"
const TEXT_MUTED = "rgba(107,95,168,0.84)"
const CARD = "rgba(255,255,255,0.54)"

const MAGENTA = "rgb(192,74,142)"
const NAVY = "rgb(42,79,143)"
const AMBER = "rgb(200,146,58)"
const TEAL = "rgb(46,140,132)"

const CARD_X = 40
const CARD_Y = 40
const CARD_W = 374
const CARD_H = 300
const CARD_GAP = 8
const KNOB_Y = 80
const PATTERN_Y = 112
const PATTERN_H = 178
const SLIDER_Y = 314
const WORD_X = 560
const WORD_Y = 380
const WORD_W = 480
const WORD_H = 84
const WORD_PERIOD = 4.5

type AxisId = 1 | 2 | 3 | 4
type ChipKind = "color" | "gray" | "skin"
type Rgb = { r: number; g: number; b: number }

type Axis = {
  id: AxisId
  name: string
  sub: string
  color: string
}

type Word = {
  text: string
  axis: AxisId
}

type Chip = {
  kind: ChipKind
  rgb: Rgb
}

const AXES: Axis[] = [
  { id: 1, name: "色の広がり・転がり", sub: "hue / saturation", color: MAGENTA },
  { id: 2, name: "濃度", sub: "color density", color: NAVY },
  { id: 3, name: "カーブ", sub: "tone curve", color: AMBER },
  { id: 4, name: "RGB カラーバランス", sub: "gray balance", color: TEAL },
]

const WORDS: Word[] = [
  { text: "もう少し暖かく", axis: 4 },
  { text: "もっと色に立体感が欲しい", axis: 2 },
  { text: "もう少し抜けを", axis: 3 },
  { text: "肌の転がりをリッチに", axis: 1 },
]

const TEST_CHIPS: Chip[] = [
  { kind: "color", rgb: { r: 224, g: 44, b: 58 } },
  { kind: "color", rgb: { r: 235, g: 126, b: 28 } },
  { kind: "color", rgb: { r: 36, g: 94, b: 224 } },
  { kind: "color", rgb: { r: 34, g: 172, b: 82 } },
  { kind: "gray", rgb: gray(0.12) },
  { kind: "gray", rgb: gray(0.38) },
  { kind: "gray", rgb: gray(0.64) },
  { kind: "gray", rgb: gray(0.86) },
  { kind: "skin", rgb: { r: 105, g: 62, b: 44 } },
  { kind: "skin", rgb: { r: 139, g: 83, b: 58 } },
  { kind: "skin", rgb: { r: 204, g: 142, b: 102 } },
  { kind: "skin", rgb: { r: 230, g: 180, b: 136 } },
]

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

function easeOutCubic(v: number) {
  return 1 - Math.pow(1 - v, 3)
}

function lerp(a: number, b: number, p: number) {
  return a + (b - a) * p
}

function axisX(axisId: AxisId) {
  return CARD_X + (axisId - 1) * (CARD_W + CARD_GAP)
}

function axisById(id: AxisId) {
  return AXES.find((axis) => axis.id === id)!
}

function response(localT: number) {
  const p = clamp01((localT - 0.5) / 3.4)
  if (p <= 0 || p >= 1) return 0
  return Math.sin(Math.PI * 2 * easeInOutCubic(p))
}

function wordState(localT: number) {
  const fadeOut = 1 - clamp01((localT - 3.9) / 0.6)
  return {
    x: WORD_X,
    opacity: fadeOut,
  }
}

function sliderBounds(axisId: AxisId) {
  const left = axisX(axisId) + 10
  const right = axisX(axisId) + CARD_W - 10
  const half = (right - left) / 2
  return { left, right, half }
}

function sliderKnobX(axisId: AxisId, amp: number) {
  const { left, half } = sliderBounds(axisId)
  return left + half + amp * half
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
  if (s === 0) return gray(l)
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

function sCurve(l: number, k: number) {
  return clamp01(l + k * 0.5 * Math.sin((l - 0.5) * Math.PI))
}

function sCurveChannel(v: number, k: number) {
  return clamp01(v + k * Math.sin((v - 0.5) * Math.PI))
}

function sCurveRgb({ r, g, b }: Rgb, k: number): Rgb {
  return {
    r: clamp255(sCurveChannel(r / 255, k) * 255),
    g: clamp255(sCurveChannel(g / 255, k) * 255),
    b: clamp255(sCurveChannel(b / 255, k) * 255),
  }
}

function rgbToY({ r, g, b }: Rgb): number {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255
}

function applyLuminanceCurve({ r, g, b }: Rgb, k: number): Rgb {
  const y = rgbToY({ r, g, b })
  if (y < 1e-6) return { r, g, b }
  const yNew = clamp01(y + k * Math.sin((y - 0.5) * Math.PI))
  const scale = yNew / y
  return {
    r: clamp255(r * scale),
    g: clamp255(g * scale),
    b: clamp255(b * scale),
  }
}

function chipColor(axisId: AxisId, chip: Chip, amp: number) {
  let rgb = chip.rgb
  const kindAmp = axisId === 4 && chip.kind !== "gray" ? amp * 0.45 : amp
  if (axisId === 1 && chip.kind !== "gray") {
    const hsl = rgbToHsl(rgb)
    rgb = hslToRgb(hsl.h + amp * 15, clamp01(hsl.s * (1 + amp * 0.3)), hsl.l)
  }
  if (axisId === 2 && chip.kind !== "gray") {
    const hsl = rgbToHsl(rgb)
    rgb = hslToRgb(hsl.h, hsl.s, clamp01(hsl.l + amp * 0.3))
  }
  if (axisId === 3) {
    rgb = applyLuminanceCurve(rgb, amp * 0.5)
  }
  if (axisId === 4) {
    const shift = kindAmp * 0.2 * 255
    rgb = { r: rgb.r + shift, g: rgb.g, b: rgb.b - shift }
  }
  return `rgb(${clamp255(rgb.r)},${clamp255(rgb.g)},${clamp255(rgb.b)})`
}

function TestPattern({ axis, amp }: { axis: Axis; amp: number }) {
  const x = axisX(axis.id) + 10
  const y = PATTERN_Y
  const gap = 4
  const chipW = (CARD_W - 20 - gap * 3) / 4
  const chipH = (PATTERN_H - gap * 2) / 3

  return (
    <g>
      {TEST_CHIPS.map((chip, i) => {
        const col = i % 4
        const row = Math.floor(i / 4)
        return (
          <rect
            key={`${axis.id}-${i}`}
            x={x + col * (chipW + gap)}
            y={y + row * (chipH + gap)}
            width={chipW}
            height={chipH}
            rx={6}
            fill={chipColor(axis.id, chip, amp)}
            stroke="rgba(255,255,255,0.70)"
          />
        )
      })}
    </g>
  )
}

function AxisCard({
  axis,
  amp,
  active,
}: {
  axis: Axis
  amp: number
  active: boolean
}) {
  const x = axisX(axis.id)
  const rail = sliderBounds(axis.id)
  const knob = sliderKnobX(axis.id, amp)

  return (
    <g>
      <rect
        x={x}
        y={CARD_Y}
        width={CARD_W}
        height={CARD_H}
        rx={16}
        fill={active ? axis.color.replace("rgb", "rgba").replace(")", ",0.10)") : CARD}
        stroke={active ? axis.color : "rgba(255,255,255,0.62)"}
        strokeOpacity={active ? 0.72 : 0.48}
      />
      <circle cx={x + 34} cy={KNOB_Y} r={12} fill={axis.color} />
      <text x={x + 56} y={KNOB_Y - 5} fontSize={19} fontWeight={700} fill={TEXT_PRIMARY}>
        {axis.name}
      </text>
      <text x={x + 56} y={KNOB_Y + 18} fontSize={13} fill={TEXT_MUTED}>
        {axis.sub}
      </text>
      <TestPattern axis={axis} amp={amp} />
      <line
        x1={rail.left}
        y1={SLIDER_Y}
        x2={rail.right}
        y2={SLIDER_Y}
        stroke="rgba(28,15,110,0.18)"
        strokeWidth={10}
        strokeLinecap="round"
      />
      <circle
        cx={knob}
        cy={SLIDER_Y}
        r={16}
        fill={axis.color}
        stroke="white"
        strokeWidth={3}
      />
    </g>
  )
}

function ReducedFrame() {
  const cardW = 350
  const cardY = 380
  return (
    <g>
      {WORDS.map((word, i) => {
        const axis = axisById(word.axis)
        const x = 52 + i * 386
        return (
          <g key={word.text}>
            <rect
              x={x}
              y={cardY}
              width={cardW}
              height={68}
              rx={18}
              fill="rgba(255,255,255,0.64)"
              stroke={axis.color}
              strokeOpacity={0.42}
            />
            <text
              x={x + cardW / 2}
              y={cardY + 42}
              textAnchor="middle"
              fontSize={22}
              fontWeight={700}
              fill={TEXT_PRIMARY}
            >
              {word.text}
            </text>
          </g>
        )
      })}
    </g>
  )
}

export default function GradingLookDecomposition({
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

  const wordIndex = Math.floor(animT / WORD_PERIOD) % WORDS.length
  const localT = animT % WORD_PERIOD
  const activeWord = WORDS[wordIndex]
  const activeAxis = activeWord.axis
  const state = wordState(localT)
  const amp = response(localT)

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="absolute inset-0 h-full w-full"
      preserveAspectRatio="xMidYMid meet"
    >
      <rect x={0} y={0} width={W} height={H} fill="rgba(255,255,255,0.16)" />

      {AXES.map((axis) => (
        <AxisCard
          key={axis.id}
          axis={axis}
          active={!reducedMotion && activeAxis === axis.id && Math.abs(amp) > 0}
          amp={!reducedMotion && activeAxis === axis.id ? amp : 0}
        />
      ))}

      {reducedMotion ? (
        <ReducedFrame />
      ) : (
        <g opacity={state.opacity}>
          <rect
            x={state.x}
            y={WORD_Y}
            width={WORD_W}
            height={WORD_H}
            rx={22}
            fill="rgba(255,255,255,0.72)"
            stroke={axisById(activeAxis).color}
            strokeOpacity={0.6}
          />
          <text
            x={state.x + WORD_W / 2}
            y={WORD_Y + 52}
            textAnchor="middle"
            fontSize={31}
            fontWeight={760}
            fill={TEXT_PRIMARY}
          >
            {activeWord.text}
          </text>
        </g>
      )}
    </svg>
  )
}
