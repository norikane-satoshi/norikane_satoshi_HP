"use client"

import { useEffect, useRef, useState } from "react"
import type { VideoVisualProps } from "@/components/notes/note-visual"

const LOOP = 10
const W = 1600
const H = 500

const PREVIEW_X = 426.5
const PREVIEW_Y = 40
const PREVIEW_W = 747
const PREVIEW_H = 420
const PREVIEW_CX = PREVIEW_X + PREVIEW_W / 2

const GRID = "rgba(139,127,255,0.16)"

const MAGENTA = "rgb(192,74,142)"
const NAVY = "rgb(42,79,143)"
const AMBER = "rgb(200,146,58)"
const TEAL = "rgb(46,140,132)"

type AxisId = 1 | 2 | 3 | 4

type Bottle = {
  id: AxisId
  label: string
  color: string
  x: number
  y: number
  mirror: boolean
}

type BottlePose = {
  x: number
  y: number
  slideRotate: number
  bottleRotate: number
  capRotate: number
  liquidLevel: number
}

const BOTTLES: Bottle[] = [
  { id: 1, label: "Gamut", color: MAGENTA, x: 138, y: 84, mirror: true },
  { id: 2, label: "Lum", color: NAVY, x: 138, y: 306, mirror: true },
  { id: 3, label: "Curve", color: AMBER, x: 1350, y: 84, mirror: false },
  { id: 4, label: "RGB", color: TEAL, x: 1350, y: 306, mirror: false },
]

function clamp01(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v
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

function axisStart(id: AxisId) {
  return (id - 1) * 2.5
}

function layerOpacity(id: AxisId, t: number, reducedMotion: boolean) {
  if (reducedMotion) return 1
  const fadeStart = axisStart(id) + 0.7
  if (t < fadeStart) return 0
  const reset = t >= 9.5 ? 1 - easeInOutCubic((t - 9.5) / 0.5) : 1
  if (t >= fadeStart + 0.8) return reset
  return easeInOutCubic((t - fadeStart) / 0.8) * reset
}

function baseOpacity(t: number, reducedMotion: boolean) {
  if (reducedMotion) return 1
  if (t < 9.5) return 1
  return easeInOutCubic((t - 9.5) / 0.5)
}

function bottlePose(bottle: Bottle, t: number, reducedMotion: boolean): BottlePose {
  if (reducedMotion) {
    return {
      x: bottle.x,
      y: bottle.y,
      slideRotate: 0,
      bottleRotate: 0,
      capRotate: 0,
      liquidLevel: 0,
    }
  }

  const sign = bottle.mirror ? -1 : 1
  const hoverX = PREVIEW_CX + (bottle.mirror ? 35 : -35)
  const hoverY = PREVIEW_Y - 30
  const start = axisStart(bottle.id)

  if (t >= 9.5) {
    return {
      x: bottle.x,
      y: bottle.y,
      slideRotate: 0,
      bottleRotate: 0,
      capRotate: 0,
      liquidLevel: easeInOutCubic((t - 9.5) / 0.5),
    }
  }

  if (t < start) {
    return {
      x: bottle.x,
      y: bottle.y,
      slideRotate: 0,
      bottleRotate: 0,
      capRotate: 0,
      liquidLevel: 1,
    }
  }

  const localT = t - start

  if (localT < 0.3) {
    const p = easeInOutCubic(localT / 0.3)
    return {
      x: lerp(bottle.x, hoverX, p),
      y: lerp(bottle.y, hoverY, p),
      slideRotate: lerp(-8, 0, p),
      bottleRotate: 0,
      capRotate: 0,
      liquidLevel: 1,
    }
  }

  if (localT < 0.5) {
    const p = easeInOutCubic((localT - 0.3) / 0.2)
    return {
      x: hoverX,
      y: hoverY,
      slideRotate: 0,
      bottleRotate: lerp(0, sign * -22, p),
      capRotate: lerp(0, sign * 60, p),
      liquidLevel: 1,
    }
  }

  if (localT < 1.4) {
    const p = easeInOutCubic((localT - 0.5) / 0.9)
    return {
      x: hoverX,
      y: hoverY,
      slideRotate: 0,
      bottleRotate: lerp(sign * -22, sign * -180, p),
      capRotate: sign * 60,
      liquidLevel: lerp(1.0, 0.0, p),
    }
  }

  if (localT < 1.6) {
    return {
      x: hoverX,
      y: hoverY,
      slideRotate: 0,
      bottleRotate: sign * -180,
      capRotate: sign * 60,
      liquidLevel: 0,
    }
  }

  if (localT < 2.1) {
    const p = easeInOutCubic((localT - 1.6) / 0.5)
    return {
      x: hoverX,
      y: hoverY,
      slideRotate: 0,
      bottleRotate: lerp(sign * -180, 0, p),
      capRotate: lerp(sign * 60, 0, p),
      liquidLevel: 0,
    }
  }

  if (localT < 2.4) {
    const p = easeInOutCubic((localT - 2.1) / 0.3)
    return {
      x: lerp(hoverX, bottle.x, p),
      y: lerp(hoverY, bottle.y, p),
      slideRotate: 0,
      bottleRotate: 0,
      capRotate: 0,
      liquidLevel: 0,
    }
  }

  return {
    x: bottle.x,
    y: bottle.y,
    slideRotate: 0,
    bottleRotate: 0,
    capRotate: 0,
    liquidLevel: 0,
  }
}

function pourOpacity(bottle: Bottle, t: number) {
  const localT = t - axisStart(bottle.id)
  if (localT < 0.5 || localT >= 1.6 || t >= 9.5) return 0
  return clamp01(Math.min((localT - 0.5) / 0.1, (1.6 - localT) / 0.1))
}

function pourLip(pose: BottlePose, _mirror: boolean) {
  return { x: pose.x + 70, y: pose.y + 18 }
}

function pourPath(pose: BottlePose, mirror: boolean) {
  const lip = pourLip(pose, mirror)
  const x0 = lip.x
  const y0 = lip.y
  const x1 = PREVIEW_CX
  const y1 = PREVIEW_Y + 60
  const cx = lerp(x0, x1, 0.55)
  const cy = Math.max(y0, y1) + 60
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} Q ${cx.toFixed(2)} ${cy.toFixed(2)}, ${x1.toFixed(2)} ${y1.toFixed(2)}`
}

function PreviewLayers({
  t,
  reducedMotion,
}: {
  t: number
  reducedMotion: boolean
}) {
  return (
    <g>
      <rect
        id="sp-step-0"
        x={PREVIEW_X}
        y={PREVIEW_Y}
        width={PREVIEW_W}
        height={PREVIEW_H}
        rx={20}
        fill="url(#sp-step-0-fill)"
        opacity={baseOpacity(t, reducedMotion)}
      />
      <rect
        id="sp-step-1"
        x={PREVIEW_X}
        y={PREVIEW_Y}
        width={PREVIEW_W}
        height={PREVIEW_H}
        rx={20}
        fill="url(#sp-step-1-fill)"
        opacity={layerOpacity(1, t, reducedMotion)}
      />
      <rect
        id="sp-step-2"
        x={PREVIEW_X}
        y={PREVIEW_Y}
        width={PREVIEW_W}
        height={PREVIEW_H}
        rx={20}
        fill="url(#sp-step-2-fill)"
        opacity={layerOpacity(2, t, reducedMotion)}
      />
      <rect
        id="sp-step-3"
        x={PREVIEW_X}
        y={PREVIEW_Y}
        width={PREVIEW_W}
        height={PREVIEW_H}
        rx={20}
        fill="url(#sp-step-3-fill)"
        opacity={layerOpacity(3, t, reducedMotion)}
      />
      <rect
        id="sp-step-4"
        x={PREVIEW_X}
        y={PREVIEW_Y}
        width={PREVIEW_W}
        height={PREVIEW_H}
        rx={20}
        fill="url(#sp-step-4-fill)"
        opacity={layerOpacity(4, t, reducedMotion)}
      />
    </g>
  )
}

function Shelf({ side }: { side: "left" | "right" }) {
  const x = side === "left" ? 20 : 1200
  return (
    <g>
      <line x1={x + 10} y1={230} x2={x + 370} y2={230} stroke={GRID} />
      <line x1={x + 10} y1={452} x2={x + 370} y2={452} stroke={GRID} />
    </g>
  )
}

function BottleShape({ bottle, pose }: { bottle: Bottle; pose: BottlePose }) {
  const capPivotX = bottle.mirror ? 48 : 92
  return (
    <g
      transform={`translate(${pose.x.toFixed(2)} ${pose.y.toFixed(2)}) rotate(${pose.slideRotate.toFixed(2)} 70 70)`}
    >
      <g transform={`rotate(${pose.bottleRotate.toFixed(2)} 70 18)`}>
        <rect
          x={32}
          y={9}
          width={76}
          height={133 * pose.liquidLevel}
          fill={bottle.color}
          opacity={0.76}
          clipPath="url(#sp-bottle-clip)"
        />
        <path
          d="M 28 52 C 28 36, 44 31, 54 24 L 54 9 L 86 9 L 86 24 C 96 31, 112 36, 112 52 L 112 118 C 112 132, 99 142, 70 142 C 41 142, 28 132, 28 118 Z"
          fill="rgba(255,255,255,0.42)"
          stroke={bottle.color}
          strokeOpacity={0.62}
          strokeWidth={3}
        />
        <g transform={`rotate(${pose.capRotate.toFixed(2)} ${capPivotX} 9)`}>
          <rect x={48} y={0} width={44} height={18} rx={5} fill={bottle.color} />
        </g>
        <rect x={34} y={68} width={72} height={34} rx={8} fill={bottle.color} />
        <text
          x={70}
          y={91}
          textAnchor="middle"
          fontFamily="var(--font-geist-mono), 'Notion Mono Editorial', monospace"
          fontSize={bottle.label.length > 4 ? 18 : 21}
          fontWeight={760}
          fill="white"
        >
          {bottle.label}
        </text>
      </g>
    </g>
  )
}

export default function GradingSecretPantry({
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

  const t = reducedMotion ? 9.25 : animT
  const bottleStates = BOTTLES.map((bottle) => ({
    bottle,
    pose: bottlePose(bottle, t, reducedMotion),
    pourOpacity: reducedMotion ? 0 : pourOpacity(bottle, t),
  }))

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="absolute inset-0 h-full w-full"
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <clipPath id="sp-bottle-clip">
          <path d="M 28 52 C 28 36, 44 31, 54 24 L 54 9 L 86 9 L 86 24 C 96 31, 112 36, 112 52 L 112 118 C 112 132, 99 142, 70 142 C 41 142, 28 132, 28 118 Z" />
        </clipPath>
        <linearGradient id="sp-step-0-fill" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="rgb(176,182,187)" />
          <stop offset="52%" stopColor="rgb(128,136,143)" />
          <stop offset="100%" stopColor="rgb(92,99,108)" />
        </linearGradient>
        <linearGradient id="sp-step-1-fill" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="rgb(196,176,190)" />
          <stop offset="48%" stopColor="rgb(145,119,151)" />
          <stop offset="100%" stopColor="rgb(96,78,118)" />
        </linearGradient>
        <linearGradient id="sp-step-2-fill" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="rgb(161,136,158)" />
          <stop offset="48%" stopColor="rgb(111,91,126)" />
          <stop offset="100%" stopColor="rgb(65,58,86)" />
        </linearGradient>
        <linearGradient id="sp-step-3-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgb(202,181,167)" />
          <stop offset="45%" stopColor="rgb(104,88,111)" />
          <stop offset="100%" stopColor="rgb(40,46,70)" />
        </linearGradient>
        <linearGradient id="sp-step-4-fill" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="rgb(220,186,166)" />
          <stop offset="45%" stopColor="rgb(132,92,126)" />
          <stop offset="100%" stopColor="rgb(52,63,106)" />
        </linearGradient>
        <linearGradient id="sp-pour-1" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={MAGENTA} stopOpacity="0.45" />
          <stop offset="100%" stopColor={MAGENTA} stopOpacity="1.0" />
        </linearGradient>
        <linearGradient id="sp-pour-2" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={NAVY} stopOpacity="0.45" />
          <stop offset="100%" stopColor={NAVY} stopOpacity="1.0" />
        </linearGradient>
        <linearGradient id="sp-pour-3" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={AMBER} stopOpacity="0.45" />
          <stop offset="100%" stopColor={AMBER} stopOpacity="1.0" />
        </linearGradient>
        <linearGradient id="sp-pour-4" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={TEAL} stopOpacity="0.45" />
          <stop offset="100%" stopColor={TEAL} stopOpacity="1.0" />
        </linearGradient>
      </defs>

      <rect x={0} y={0} width={W} height={H} fill="rgba(255,255,255,0.16)" />

      <g>
        <Shelf side="left" />
        <Shelf side="right" />
        <rect
          x={PREVIEW_X - 18}
          y={PREVIEW_Y - 18}
          width={PREVIEW_W + 36}
          height={PREVIEW_H + 36}
          rx={26}
          fill="none"
          stroke="rgba(255,255,255,0.62)"
        />
        <PreviewLayers t={t} reducedMotion={reducedMotion} />
        <rect
          x={PREVIEW_X}
          y={PREVIEW_Y}
          width={PREVIEW_W}
          height={PREVIEW_H}
          rx={20}
          fill="none"
          stroke="rgba(255,255,255,0.78)"
          strokeWidth={2}
        />
        {bottleStates.map(({ bottle, pose, pourOpacity }) => {
          const path = pourPath(pose, bottle.mirror)
          const tiltScale = clamp01(Math.abs(pose.bottleRotate) / 90)
          return pourOpacity > 0 ? (
            <g key={`pour-${bottle.id}`} opacity={pourOpacity}>
              <path
                d={path}
                fill="none"
                stroke={`url(#sp-pour-${bottle.id})`}
                strokeWidth={20 * tiltScale}
                strokeLinecap="round"
                opacity={0.35}
              />
              <path
                d={path}
                fill="none"
                stroke={`url(#sp-pour-${bottle.id})`}
                strokeWidth={14 * tiltScale}
                strokeLinecap="round"
                opacity={0.7}
              />
              <path
                d={path}
                fill="none"
                stroke={`url(#sp-pour-${bottle.id})`}
                strokeWidth={6 * tiltScale}
                strokeLinecap="round"
                opacity={1.0}
              />
            </g>
          ) : null
        })}
        {bottleStates.map(({ bottle, pose }) => (
          <BottleShape key={bottle.id} bottle={bottle} pose={pose} />
        ))}
      </g>
    </svg>
  )
}
