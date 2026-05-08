"use client"

import { useEffect, useRef, useState } from "react"
import type { VideoVisualProps } from "@/components/notes/note-visual"

const LOOP = 9.6
const W = 1600
const H = 500

const TEXT_PRIMARY = "rgba(28,15,110,0.95)"
const TEXT_MUTED = "rgba(107,95,168,0.82)"
const PANEL = "rgba(255,255,255,0.46)"
const PANEL_STRONG = "rgba(255,255,255,0.66)"
const STROKE = "rgba(255,255,255,0.72)"
const ACCENT = "rgb(139,127,255)"
const ACCENT_SOFT = "rgba(139,127,255,0.16)"
const PINK = "rgb(255,143,171)"
const SKY = "rgb(125,211,252)"
const LAVENDER = "rgb(196,181,253)"

type AxisId = 0 | 1 | 2 | 3

type Axis = {
  id: AxisId
  label: string
  sub: string
  color: string
}

type Order = {
  text: string
  axis: AxisId
}

const AXES: Axis[] = [
  { id: 0, label: "色の広がり・転がり", sub: "hue / saturation", color: PINK },
  { id: 1, label: "濃度", sub: "density", color: ACCENT },
  { id: 2, label: "カーブ", sub: "curve", color: SKY },
  { id: 3, label: "RGB バランス", sub: "balance", color: LAVENDER },
]

const ORDERS: Order[] = [
  { text: "もう少し暖かく", axis: 0 },
  { text: "青だけ少し深く", axis: 1 },
  { text: "もう少し抜けを", axis: 2 },
  { text: "全体を少し寒色に", axis: 3 },
]

const PHASE = LOOP / ORDERS.length

function clamp01(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

function easeInOutCubic(v: number) {
  return v < 0.5 ? 4 * v * v * v : 1 - Math.pow(-2 * v + 2, 3) / 2
}

function pulse(localT: number) {
  const p = clamp01((localT - 0.18) / 0.68)
  return Math.sin(Math.PI * easeInOutCubic(p))
}

function axisById(id: AxisId) {
  return AXES.find((axis) => axis.id === id)!
}

function unintendedAmp(activeAxis: AxisId, axis: AxisId, strength: number) {
  if (axis === activeAxis) return strength
  const distance = Math.abs(axis - activeAxis)
  return strength * (distance === 1 ? 0.48 : 0.28)
}

function splitAmp(activeAxis: AxisId, axis: AxisId, strength: number) {
  return axis === activeAxis ? strength : 0
}

function valueFromAmp(axis: AxisId, amp: number) {
  const signs = [1, -1, 1, -1] as const
  return amp * signs[axis] * 0.42
}

function knobX(x: number, width: number, axis: AxisId, amp: number) {
  return x + width / 2 + valueFromAmp(axis, amp) * width
}

function OrderPill({
  x,
  y,
  width,
  order,
}: {
  x: number
  y: number
  width: number
  order: Order
}) {
  const axis = axisById(order.axis)
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={54}
        rx={18}
        fill={PANEL_STRONG}
        stroke={axis.color}
        strokeOpacity={0.7}
      />
      <circle cx={x + 32} cy={y + 27} r={9} fill={axis.color} />
      <text
        x={x + width / 2 + 10}
        y={y + 35}
        textAnchor="middle"
        fontSize={25}
        fontWeight={760}
        fill={TEXT_PRIMARY}
      >
        {order.text}
      </text>
    </g>
  )
}

function AxisRail({
  x,
  y,
  width,
  axis,
  amp,
  muted,
}: {
  x: number
  y: number
  width: number
  axis: Axis
  amp: number
  muted?: boolean
}) {
  const railY = y + 44
  const cx = knobX(x + 210, width - 250, axis.id, amp)
  const active = Math.abs(amp) > 0.02
  return (
    <g opacity={muted && !active ? 0.62 : 1}>
      <text x={x} y={y + 20} fontSize={18} fontWeight={720} fill={TEXT_PRIMARY}>
        {axis.label}
      </text>
      <text x={x} y={y + 42} fontSize={12} fill={TEXT_MUTED}>
        {axis.sub}
      </text>
      <line
        x1={x + 210}
        y1={railY}
        x2={x + width - 40}
        y2={railY}
        stroke="rgba(28,15,110,0.17)"
        strokeWidth={10}
        strokeLinecap="round"
      />
      <line
        x1={x + width / 2 + 85}
        y1={railY - 16}
        x2={x + width / 2 + 85}
        y2={railY + 16}
        stroke="rgba(28,15,110,0.22)"
        strokeWidth={1.5}
      />
      <circle
        cx={cx}
        cy={railY}
        r={active ? 16 : 12}
        fill={active ? axis.color : "rgba(107,95,168,0.45)"}
        stroke="rgba(255,255,255,0.95)"
        strokeWidth={3}
      />
      <rect
        x={x + width - 24}
        y={railY - 10}
        width={20}
        height={20}
        rx={6}
        fill={active ? axis.color : "rgba(107,95,168,0.18)"}
        opacity={active ? 0.24 : 1}
      />
    </g>
  )
}

function MixedNode({
  x,
  y,
  width,
  strength,
}: {
  x: number
  y: number
  width: number
  strength: number
}) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={66}
        rx={20}
        fill={`rgba(139,127,255,${0.14 + strength * 0.1})`}
        stroke={ACCENT}
        strokeOpacity={0.72}
      />
      <text
        x={x + width / 2}
        y={y + 41}
        textAnchor="middle"
        fontSize={23}
        fontWeight={760}
        fill={TEXT_PRIMARY}
      >
        1 つの LUT / 1 つのカーブで触る
      </text>
      {[0, 1, 2, 3].map((i) => (
        <path
          key={i}
          d={`M ${x + width / 2} ${y + 66} C ${x + 120 + i * 135} ${y + 88}, ${
            x + 72 + i * 135
          } ${y + 92}, ${x + 70 + i * 135} ${y + 118}`}
          fill="none"
          stroke={ACCENT}
          strokeOpacity={0.24 + strength * 0.42}
          strokeWidth={2}
        />
      ))}
    </g>
  )
}

function SectionTitle({
  x,
  y,
  label,
  sub,
}: {
  x: number
  y: number
  label: string
  sub: string
}) {
  return (
    <g>
      <text x={x} y={y} fontSize={27} fontWeight={780} fill={TEXT_PRIMARY}>
        {label}
      </text>
      <text x={x} y={y + 25} fontSize={14} fill={TEXT_MUTED}>
        {sub}
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

  const t = reducedMotion ? PHASE * 0.4 : animT
  const phaseIndex = Math.floor(t / PHASE) % ORDERS.length
  const localT = (t % PHASE) / PHASE
  const order = ORDERS[phaseIndex]
  const strength = pulse(localT)

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="absolute inset-0 h-full w-full"
      preserveAspectRatio="xMidYMid meet"
    >
      <rect x={0} y={0} width={W} height={H} fill="rgba(255,255,255,0.16)" />

      <rect x={44} y={34} width={720} height={420} rx={24} fill={PANEL} stroke={STROKE} />
      <rect x={836} y={34} width={720} height={420} rx={24} fill={PANEL} stroke={STROKE} />

      <SectionTitle
        x={74}
        y={72}
        label="混ぜたまま触る"
        sub="一手で複数軸が連鎖し、直した場所も一緒に動く"
      />
      <SectionTitle
        x={866}
        y={72}
        label="分けて触る"
        sub="オーダーを軸に落として、該当する因数だけを動かす"
      />

      <OrderPill x={156} y={96} width={498} order={order} />
      <OrderPill x={948} y={96} width={498} order={order} />

      <MixedNode x={124} y={172} width={560} strength={strength} />

      <g transform="translate(94, 306)">
        {AXES.map((axis, index) => (
          <AxisRail
            key={axis.id}
            x={0}
            y={index * 34}
            width={620}
            axis={axis}
            amp={unintendedAmp(order.axis, axis.id, strength)}
          />
        ))}
      </g>

      <g transform="translate(886, 176)">
        {AXES.map((axis, index) => (
          <AxisRail
            key={axis.id}
            x={0}
            y={index * 65}
            width={610}
            axis={axis}
            amp={splitAmp(order.axis, axis.id, strength)}
            muted
          />
        ))}
      </g>

      <rect
        x={178}
        y={410}
        width={452}
        height={34}
        rx={17}
        fill={`rgba(255,143,171,${0.12 + strength * 0.18})`}
        stroke={PINK}
        strokeOpacity={0.4 + strength * 0.34}
      />
      <text
        x={404}
        y={433}
        textAnchor="middle"
        fontSize={16}
        fontWeight={720}
        fill={TEXT_PRIMARY}
      >
        触った軸以外にも変化が漏れる
      </text>

      <rect
        x={974}
        y={410}
        width={452}
        height={34}
        rx={17}
        fill={ACCENT_SOFT}
        stroke={ACCENT}
        strokeOpacity={0.42}
      />
      <text
        x={1200}
        y={433}
        textAnchor="middle"
        fontSize={16}
        fontWeight={720}
        fill={TEXT_PRIMARY}
      >
        分ければ、手は動く
      </text>
    </svg>
  )
}
