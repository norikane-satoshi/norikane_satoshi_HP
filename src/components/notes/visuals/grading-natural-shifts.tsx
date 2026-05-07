"use client"

import { useEffect, useRef, useState } from "react"
import type { VideoVisualProps } from "@/components/notes/note-visual"

const W = 1600
const H = 500
const LOOP = 11

const DWELL = 2.15
const FADE = 0.6
const ERA_DURATION = DWELL + FADE

const BG_BASE = "#F8F6FF"
const ACCENT = "#8B7FFF"
const TEXT_PRIMARY = "#1C0F6E"
const GLASS_FILL = "rgba(255,255,255,0.65)"
const GLASS_STROKE = "rgba(255,255,255,0.78)"
const AXIS_STROKE = "rgba(139,127,255,0.4)"

const PREVIEW_X = 586
const PREVIEW_Y = 60
const PREVIEW_W = 428
const PREVIEW_H = 240

const Y_AXIS_X = 80
const Y_AXIS_TOP = 80
const Y_AXIS_BOTTOM = 420

const X_AXIS_Y = 460
const X_AXIS_LEFT = 200
const X_AXIS_RIGHT = 1400

const THUMB_W = 132
const THUMB_H = 74

type EraId = 0 | 1 | 2 | 3

type Era = {
  id: EraId
  label: string
  cx: number
  cy: number
  fillId: string
  imageHref: string
}

const ERAS: Era[] = [
  {
    id: 0,
    label: "フィルム",
    cx: 300,
    cy: 380,
    fillId: "gns-era-film",
    imageHref: "/notes-assets/grading/natural-shifts/era-film.jpg",
  },
  {
    id: 1,
    label: "Rec.709",
    cx: 650,
    cy: 350,
    fillId: "gns-era-rec709",
    imageHref: "/notes-assets/grading/natural-shifts/era-rec709.jpg",
  },
  {
    id: 2,
    label: "VR 普及",
    cx: 1050,
    cy: 220,
    fillId: "gns-era-vr",
    imageHref: "/notes-assets/grading/natural-shifts/era-vr.jpg",
  },
  {
    id: 3,
    label: "高刺激未来",
    cx: 1350,
    cy: 110,
    fillId: "gns-era-future",
    imageHref: "/notes-assets/grading/natural-shifts/era-future.jpg",
  },
]

function clamp01(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

function lerp(a: number, b: number, p: number) {
  return a + (b - a) * p
}

function easeInOutCubic(v: number) {
  return v < 0.5 ? 4 * v * v * v : 1 - Math.pow(-2 * v + 2, 3) / 2
}

type EraState = {
  active: EraId
  next: EraId
  fade: number
}

function eraState(t: number): EraState {
  const stage = Math.floor(t / ERA_DURATION) % ERAS.length
  const localT = t - stage * ERA_DURATION
  let fade = 0
  if (localT >= DWELL) {
    fade = clamp01((localT - DWELL) / FADE)
  }
  return {
    active: stage as EraId,
    next: ((stage + 1) % ERAS.length) as EraId,
    fade: easeInOutCubic(fade),
  }
}

function dotPosition(t: number) {
  const { active, next, fade } = eraState(t)
  const a = ERAS[active]
  const b = ERAS[next]
  return { x: lerp(a.cx, b.cx, fade), y: lerp(a.cy, b.cy, fade) }
}

function PreviewSlot({
  era,
  opacity,
}: {
  era: Era
  opacity: number
}) {
  if (opacity <= 0) return null
  return (
    <g opacity={opacity}>
      {/* 差し替えポイント:
          実素材到着後はこの <rect> を <image href={era.imageHref} ... preserveAspectRatio="xMidYMid slice" />
          へ差し替える。座標と大きさはそのまま使い、<g> ラッパは保持する。 */}
      <rect
        x={PREVIEW_X}
        y={PREVIEW_Y}
        width={PREVIEW_W}
        height={PREVIEW_H}
        fill={`url(#${era.fillId})`}
      />
    </g>
  )
}

function AxisPill({
  cx,
  cy,
  text,
  width,
}: {
  cx: number
  cy: number
  text: string
  width: number
}) {
  const height = 36
  return (
    <g>
      <rect
        x={cx - width / 2}
        y={cy - height / 2}
        width={width}
        height={height}
        rx={height / 2}
        fill={GLASS_FILL}
        stroke={GLASS_STROKE}
        strokeWidth={1}
        filter="url(#gns-badge-shadow)"
      />
      <text
        x={cx}
        y={cy + 6}
        textAnchor="middle"
        fill={ACCENT}
        fontSize={18}
        fontWeight={600}
      >
        {text}
      </text>
    </g>
  )
}

function Thumb({
  era,
  state,
  reducedMotion,
}: {
  era: Era
  state: EraState
  reducedMotion: boolean
}) {
  let activeAmt = 0
  if (reducedMotion) {
    activeAmt = era.id === 3 ? 1 : 0
  } else if (state.active === era.id) {
    activeAmt = 1 - state.fade
  } else if (state.next === era.id) {
    activeAmt = state.fade
  }
  const x = era.cx - THUMB_W / 2
  const y = era.cy - THUMB_H / 2
  return (
    <g transform={`translate(${x.toFixed(2)} ${y.toFixed(2)})`}>
      <g clipPath="url(#gns-cell-clip)">
        {/* 差し替えポイント:
            実素材到着後は <image href={era.imageHref} ... preserveAspectRatio="xMidYMid slice" />
            へ差し替える。<g clipPath> は保持し、サイズは THUMB_W × THUMB_H をそのまま使う。 */}
        <rect x={0} y={0} width={THUMB_W} height={THUMB_H} fill={`url(#${era.fillId})`} />
      </g>
      <rect
        x={0}
        y={0}
        width={THUMB_W}
        height={THUMB_H}
        rx={12}
        fill="none"
        stroke="rgba(255,255,255,0.16)"
        strokeWidth={1.5}
      />
      <rect
        x={0}
        y={0}
        width={THUMB_W}
        height={THUMB_H}
        rx={12}
        fill="none"
        stroke={ACCENT}
        strokeWidth={3}
        opacity={activeAmt}
        filter="url(#gns-card-shadow)"
      />
      <text
        x={THUMB_W / 2}
        y={THUMB_H + 22}
        textAnchor="middle"
        fill={TEXT_PRIMARY}
        fontSize={15}
        fontWeight={600}
      >
        {era.label}
      </text>
    </g>
  )
}

function TrajectoryLine({ reducedMotion }: { reducedMotion: boolean }) {
  const path = ERAS.map((era, i) =>
    `${i === 0 ? "M" : "L"} ${era.cx} ${era.cy}`
  ).join(" ")
  return (
    <path
      d={path}
      fill="none"
      stroke={ACCENT}
      strokeOpacity={reducedMotion ? 0.7 : 0.32}
      strokeWidth={reducedMotion ? 3 : 2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  )
}

function DotTail({ t }: { t: number }) {
  const samples = 6
  const tailDur = 0.2
  const points: { x: number; y: number; op: number }[] = []
  for (let i = 0; i < samples; i++) {
    const dt = (i / (samples - 1)) * tailDur
    const tt = Math.max(t - dt, 0)
    const p = dotPosition(tt)
    const op = lerp(0.45, 0, i / (samples - 1))
    points.push({ x: p.x, y: p.y, op })
  }
  const segs: React.ReactNode[] = []
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]
    const b = points[i + 1]
    if (a.x === b.x && a.y === b.y) continue
    segs.push(
      <line
        key={i}
        x1={a.x}
        y1={a.y}
        x2={b.x}
        y2={b.y}
        stroke={ACCENT}
        strokeOpacity={a.op}
        strokeWidth={6}
        strokeLinecap="round"
      />
    )
  }
  if (segs.length === 0) return null
  return <g>{segs}</g>
}

export default function GradingNaturalShifts({
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

  const t = reducedMotion ? 10.5 : animT
  const rawState = eraState(t)
  const state: EraState = reducedMotion
    ? { active: 3, next: 3, fade: 0 }
    : rawState
  const dot = reducedMotion
    ? { x: ERAS[3].cx, y: ERAS[3].cy }
    : dotPosition(t)

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="absolute inset-0 h-full w-full"
      preserveAspectRatio="xMidYMid meet"
      fontFamily="var(--font-noto-sans-jp), sans-serif"
    >
      <defs>
        <radialGradient id="gns-aurora-purple" cx="14%" cy="14%" r="48%">
          <stop offset="0%" stopColor="#8B7FFF" stopOpacity={0.18} />
          <stop offset="72%" stopColor="#8B7FFF" stopOpacity={0} />
        </radialGradient>
        <radialGradient id="gns-aurora-pink" cx="86%" cy="10%" r="42%">
          <stop offset="0%" stopColor="#FF8FAB" stopOpacity={0.12} />
          <stop offset="72%" stopColor="#FF8FAB" stopOpacity={0} />
        </radialGradient>
        <radialGradient id="gns-aurora-sky" cx="55%" cy="92%" r="46%">
          <stop offset="0%" stopColor="#7DD3FC" stopOpacity={0.12} />
          <stop offset="72%" stopColor="#7DD3FC" stopOpacity={0} />
        </radialGradient>
        <filter id="gns-card-shadow" x="-8%" y="-8%" width="116%" height="122%">
          <feDropShadow dx={0} dy={8} stdDeviation={16} floodColor="#8B7FFF" floodOpacity={0.15} />
        </filter>
        <filter id="gns-badge-shadow" x="-12%" y="-40%" width="124%" height="190%">
          <feDropShadow dx={0} dy={4} stdDeviation={10} floodColor="#8B7FFF" floodOpacity={0.12} />
        </filter>
        <clipPath id="gns-cell-clip">
          <rect x={0} y={0} width={THUMB_W} height={THUMB_H} rx={12} />
        </clipPath>
        <clipPath id="gns-preview-clip">
          <rect x={PREVIEW_X} y={PREVIEW_Y} width={PREVIEW_W} height={PREVIEW_H} rx={20} />
        </clipPath>
        <marker
          id="gns-axis-arrow"
          viewBox="0 0 10 10"
          refX={8}
          refY={5}
          markerWidth={8}
          markerHeight={8}
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill={AXIS_STROKE} />
        </marker>

        <linearGradient id="gns-era-film" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#E1BD8E" />
          <stop offset="55%" stopColor="#A8794D" />
          <stop offset="100%" stopColor="#5A3B22" />
        </linearGradient>
        <linearGradient id="gns-era-rec709" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#9AA8B6" />
          <stop offset="55%" stopColor="#5F6E80" />
          <stop offset="100%" stopColor="#374253" />
        </linearGradient>
        <linearGradient id="gns-era-vr" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#E14BD9" />
          <stop offset="50%" stopColor="#7C3AED" />
          <stop offset="100%" stopColor="#16C8DC" />
        </linearGradient>
        <linearGradient id="gns-era-future" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FF1FA0" />
          <stop offset="50%" stopColor="#A50AFF" />
          <stop offset="100%" stopColor="#18EFE7" />
        </linearGradient>
      </defs>

      <rect x={0} y={0} width={W} height={H} fill={BG_BASE} />
      <rect x={0} y={0} width={W} height={H} fill="url(#gns-aurora-purple)" />
      <rect x={0} y={0} width={W} height={H} fill="url(#gns-aurora-pink)" />
      <rect x={0} y={0} width={W} height={H} fill="url(#gns-aurora-sky)" />
      <rect x={0} y={0} width={W} height={H} fill="rgba(28,15,110,0.025)" />

      <g clipPath="url(#gns-preview-clip)">
        <PreviewSlot era={ERAS[state.active]} opacity={1 - state.fade} />
        {state.active !== state.next ? (
          <PreviewSlot era={ERAS[state.next]} opacity={state.fade} />
        ) : null}
      </g>
      <rect
        x={PREVIEW_X}
        y={PREVIEW_Y}
        width={PREVIEW_W}
        height={PREVIEW_H}
        rx={20}
        fill="none"
        stroke={GLASS_STROKE}
        strokeWidth={2}
        filter="url(#gns-card-shadow)"
      />

      <line
        x1={Y_AXIS_X}
        y1={Y_AXIS_TOP}
        x2={Y_AXIS_X}
        y2={Y_AXIS_BOTTOM}
        stroke={AXIS_STROKE}
        strokeWidth={1.5}
        strokeDasharray="6 8"
        strokeLinecap="round"
        markerStart="url(#gns-axis-arrow)"
        markerEnd="url(#gns-axis-arrow)"
      />
      <AxisPill cx={Y_AXIS_X} cy={Y_AXIS_TOP - 32} text="高" width={70} />
      <AxisPill cx={Y_AXIS_X} cy={Y_AXIS_BOTTOM + 32} text="低" width={70} />
      <text
        x={36}
        y={(Y_AXIS_TOP + Y_AXIS_BOTTOM) / 2}
        transform={`rotate(-90 36 ${(Y_AXIS_TOP + Y_AXIS_BOTTOM) / 2})`}
        textAnchor="middle"
        fill={TEXT_PRIMARY}
        fontSize={20}
        fontWeight={600}
      >
        刺激の強さ
      </text>

      <line
        x1={X_AXIS_LEFT}
        y1={X_AXIS_Y}
        x2={X_AXIS_RIGHT}
        y2={X_AXIS_Y}
        stroke={AXIS_STROKE}
        strokeWidth={1.5}
        strokeDasharray="6 8"
        strokeLinecap="round"
        markerStart="url(#gns-axis-arrow)"
        markerEnd="url(#gns-axis-arrow)"
      />
      <AxisPill cx={X_AXIS_LEFT - 60} cy={X_AXIS_Y} text="過去" width={88} />
      <AxisPill cx={X_AXIS_RIGHT + 60} cy={X_AXIS_Y} text="未来" width={88} />

      <TrajectoryLine reducedMotion={reducedMotion} />

      {ERAS.map((era) => (
        <Thumb key={era.id} era={era} state={state} reducedMotion={reducedMotion} />
      ))}

      {!reducedMotion ? <DotTail t={t} /> : null}

      <g filter="url(#gns-badge-shadow)">
        <circle
          cx={dot.x}
          cy={dot.y}
          r={20}
          fill="none"
          stroke={GLASS_STROKE}
          strokeWidth={2}
        />
        <circle cx={dot.x} cy={dot.y} r={14} fill={ACCENT} />
      </g>
    </svg>
  )
}
