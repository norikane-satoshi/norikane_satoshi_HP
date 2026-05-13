"use client"

import { useEffect, useRef, useState } from "react"
import type { VideoVisualProps } from "@/components/notes/note-visual"

const LOOP = 14
const W = 1600
const H = 500
const PURPLE = "#8B7FFF"
const ACCENT_RED = "rgb(220,80,80)"
const AXIS_STROKE = "rgba(139,127,255,0.4)"
const GRAPH_FILL = "rgba(255,255,255,0.08)"
const GRAPH_STROKE = "rgba(255,255,255,0.4)"

const GRAPH = { x: 100, y: 310, w: 260, h: 150 }
const PREVIEW = { x: 520, y: 70, w: 1000, h: 400 }
const BADGE_AREA = { x: 80, y: 70, w: 400, h: 140 }
const ORDER_PILL = { cx: 800, w: 480, h: 44, y: 14 }
const CONCLUSION_PILL = { cx: 800, w: 760, h: 40, y: 455 }
const BADGE_W = 120
const BADGE_H = 36

const TOOL_CANDIDATES = [
  { label: "コントラスト", key: "contrast" as const },
  { label: "彩度", key: "saturation" as const },
  { label: "シャープ", key: "sharpness" as const },
]

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v))
}

function clamp255(v: number) {
  return Math.max(0, Math.min(255, Math.round(v)))
}

function lerp(a: number, b: number, p: number) {
  return a + (b - a) * p
}

function easeInOutCubic(v: number) {
  return v < 0.5 ? 4 * v * v * v : 1 - Math.pow(-2 * v + 2, 3) / 2
}

function windowProgress(t: number, start: number, end: number) {
  return clamp01((t - start) / (end - start))
}

function fadeIn(t: number, start: number, end: number) {
  return easeInOutCubic(windowProgress(t, start, end))
}

function fadeOut(t: number, start: number, end: number) {
  return 1 - easeInOutCubic(windowProgress(t, start, end))
}

function applyContrast(channel: number, shift: number) {
  const m = 1 + shift * 0.6
  return clamp255(128 + (channel - 128) * m)
}

function contrastRgb(r: number, g: number, b: number, shift: number) {
  return `rgb(${applyContrast(r, shift)},${applyContrast(g, shift)},${applyContrast(b, shift)})`
}

function contrastShiftAt(t: number) {
  if (t < 4.5) return 0
  if (t < 9) return 0.7 * easeInOutCubic(windowProgress(t, 4.5, 9))
  if (t < 11) return 0.7
  if (t < 12.5) return 0.7 * fadeOut(t, 11, 12.5)
  return 0
}

function orderPillPose(t: number) {
  if (t < 1.5) {
    const p = fadeIn(t, 0, 1.5)
    return { y: lerp(-32, ORDER_PILL.y, p), opacity: p }
  }
  if (t < 11) return { y: ORDER_PILL.y, opacity: 1 }
  if (t < 12.5) return { y: ORDER_PILL.y, opacity: fadeOut(t, 11, 12.5) }
  return { y: -32, opacity: 0 }
}

function badgeCenters() {
  const colW = BADGE_AREA.w / TOOL_CANDIDATES.length
  return TOOL_CANDIDATES.map((_, i) => ({
    cx: BADGE_AREA.x + colW * (i + 0.5),
    cy: BADGE_AREA.y + BADGE_AREA.h / 2,
  }))
}

function badgeOffset(t: number, idx: number) {
  if (t < 1.5 || t > 4) return { dx: 0, dy: 0 }
  const period = 3.0 + idx * 0.4
  const phase = ((t - 1.5) / period) * 2 * Math.PI + idx * 1.7
  const dx = 15 * Math.sin(phase)
  const dy = 15 * Math.cos(phase * 0.9)
  return { dx, dy }
}

function badgeOpacity(t: number) {
  if (t < 1.5) return 0
  if (t < 4) return fadeIn(t, 1.5, 2.2)
  if (t < 4.5) return fadeOut(t, 4, 4.5)
  return 0
}

function absorbProgress(t: number) {
  if (t < 4) return 0
  if (t < 4.5) return easeInOutCubic(windowProgress(t, 4, 4.5))
  return 1
}

function graphOpacity(t: number) {
  if (t < 4.5) return 0
  if (t < 5.0) return fadeIn(t, 4.5, 5.0)
  if (t < 11) return 1
  if (t < 12.5) return fadeOut(t, 11, 12.5)
  return 0
}

function selectedBadgeIdx(t: number) {
  if (t < 1.5) return null
  if (t < 4) {
    const within = ((t - 1.5) % 2.4) / 0.8
    return Math.min(2, Math.floor(within))
  }
  if (t < 4.5) return 0
  return null
}

function badgeHighlightAlpha(t: number) {
  const phase = t / 1.5
  const pulse = 0.5 - 0.5 * Math.cos(phase * 2 * Math.PI)
  return 0.6 + 0.4 * pulse
}

function faceOverlayOpacity(t: number) {
  if (t < 4.5 || t > 12.5) return 0
  const fade = t < 5.5 ? fadeIn(t, 4.5, 5.5) : t > 11 ? fadeOut(t, 11, 12.5) : 1
  const phase = (t - 4.5) / 1.5
  const pulse = 0.5 - 0.5 * Math.cos(phase * 2 * Math.PI)
  return fade * 0.6 * pulse
}

function borderOverlayOpacity(t: number) {
  if (t < 4.5 || t > 12.5) return 0
  const fade = t < 5.5 ? fadeIn(t, 4.5, 5.5) : t > 11 ? fadeOut(t, 11, 12.5) : 1
  const phase = (t - 4.5) / 1.7 + 0.4
  const pulse = 0.5 - 0.5 * Math.cos(phase * 2 * Math.PI)
  return fade * 0.55 * pulse
}

function conclusionOpacity(t: number) {
  if (t < 9) return 0
  if (t < 10) return fadeIn(t, 9, 10)
  if (t < 11) return 1
  if (t < 12.5) return fadeOut(t, 11, 12.5)
  return 0
}

function curvePath(shift: number) {
  const pts = [
    { in: 0, out: 0 },
    { in: 64, out: 64 - 32 * shift },
    { in: 128, out: 128 },
    { in: 192, out: 192 + 32 * shift },
    { in: 255, out: 255 },
  ]
  const mapped = pts.map((p) => ({
    x: GRAPH.x + (p.in / 255) * GRAPH.w,
    y: GRAPH.y + GRAPH.h - (p.out / 255) * GRAPH.h,
  }))
  let d = `M ${mapped[0].x.toFixed(2)} ${mapped[0].y.toFixed(2)}`
  for (let i = 0; i < mapped.length - 1; i++) {
    const p0 = mapped[Math.max(0, i - 1)]
    const p1 = mapped[i]
    const p2 = mapped[i + 1]
    const p3 = mapped[Math.min(mapped.length - 1, i + 2)]
    const c1x = p1.x + (p2.x - p0.x) / 6
    const c1y = p1.y + (p2.y - p0.y) / 6
    const c2x = p2.x - (p3.x - p1.x) / 6
    const c2y = p2.y - (p3.y - p1.y) / 6
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)} ${c2x.toFixed(2)} ${c2y.toFixed(2)} ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`
  }
  return d
}

function OrderPill({ t }: { t: number }) {
  const pose = orderPillPose(t)
  return (
    <g opacity={pose.opacity} transform={`translate(${ORDER_PILL.cx - ORDER_PILL.w / 2} ${pose.y})`}>
      <rect x={0} y={0} width={ORDER_PILL.w} height={ORDER_PILL.h} rx={ORDER_PILL.h / 2} fill={PURPLE} />
      <text
        x={ORDER_PILL.w / 2}
        y={ORDER_PILL.h / 2 + 7}
        textAnchor="middle"
        fontSize={20}
        fontWeight={760}
        fill="white"
      >
        もう少し絵に立体感が欲しい
      </text>
    </g>
  )
}

function ToolBadges({ t }: { t: number }) {
  const centers = badgeCenters()
  const absorbTarget = { x: GRAPH.x + GRAPH.w / 2, y: GRAPH.y + GRAPH.h / 2 }
  const selectedIdx = selectedBadgeIdx(t)
  const highlightAlpha = badgeHighlightAlpha(t)
  return (
    <g>
      {TOOL_CANDIDATES.map((cand, idx) => {
        const opacity = badgeOpacity(t)
        if (opacity <= 0) return null
        const center = centers[idx]
        const offset = badgeOffset(t, idx)
        let cx = center.cx + offset.dx
        let cy = center.cy + offset.dy
        if (cand.key === "contrast" && t >= 4) {
          const p = absorbProgress(t)
          cx = lerp(cx, absorbTarget.x, p)
          cy = lerp(cy, absorbTarget.y, p)
        }
        const isSelected = selectedIdx === idx
        return (
          <g key={cand.key} opacity={opacity} transform={`translate(${cx - BADGE_W / 2} ${cy - BADGE_H / 2})`}>
            {isSelected && (
              <rect
                x={-6}
                y={-6}
                width={BADGE_W + 12}
                height={BADGE_H + 12}
                rx={(BADGE_H + 12) / 2}
                fill="none"
                stroke={PURPLE}
                strokeOpacity={highlightAlpha}
                strokeWidth={3}
              />
            )}
            <rect
              x={0}
              y={0}
              width={BADGE_W}
              height={BADGE_H}
              rx={BADGE_H / 2}
              fill="rgba(24,20,56,0.82)"
              stroke={PURPLE}
              strokeOpacity={0.85}
              strokeWidth={2}
            />
            <text
              x={BADGE_W / 2}
              y={BADGE_H / 2 + 6}
              textAnchor="middle"
              fontSize={17}
              fontWeight={720}
              fill="white"
            >
              {cand.label}
            </text>
          </g>
        )
      })}
    </g>
  )
}

function ToneCurveGraph({ shift, opacity }: { shift: number; opacity: number }) {
  if (opacity <= 0) return null
  return (
    <g opacity={opacity}>
      <rect
        x={GRAPH.x - 8}
        y={GRAPH.y - 8}
        width={GRAPH.w + 16}
        height={GRAPH.h + 16}
        rx={14}
        fill="rgba(139,127,255,0.18)"
        stroke={PURPLE}
        strokeOpacity={0.6}
        strokeWidth={1}
      />
      <rect
        x={GRAPH.x}
        y={GRAPH.y}
        width={GRAPH.w}
        height={GRAPH.h}
        rx={10}
        fill={GRAPH_FILL}
        stroke={GRAPH_STROKE}
        strokeWidth={1.5}
      />
      {[0.25, 0.5, 0.75].map((p) => (
        <g key={`grid-${p}`}>
          <line
            x1={GRAPH.x + GRAPH.w * p}
            y1={GRAPH.y}
            x2={GRAPH.x + GRAPH.w * p}
            y2={GRAPH.y + GRAPH.h}
            stroke={AXIS_STROKE}
            strokeOpacity={0.18}
            strokeWidth={1}
          />
          <line
            x1={GRAPH.x}
            y1={GRAPH.y + GRAPH.h * p}
            x2={GRAPH.x + GRAPH.w}
            y2={GRAPH.y + GRAPH.h * p}
            stroke={AXIS_STROKE}
            strokeOpacity={0.18}
            strokeWidth={1}
          />
        </g>
      ))}
      <line
        x1={GRAPH.x}
        y1={GRAPH.y + GRAPH.h}
        x2={GRAPH.x + GRAPH.w}
        y2={GRAPH.y}
        stroke={PURPLE}
        strokeOpacity={0.3}
        strokeWidth={1.2}
      />
      <path d={curvePath(shift)} fill="none" stroke={PURPLE} strokeWidth={2.2} strokeLinecap="round" />
      <text
        x={GRAPH.x + GRAPH.w / 2}
        y={GRAPH.y + GRAPH.h + 22}
        textAnchor="middle"
        fontSize={12}
        fontWeight={620}
        fill="rgba(255,255,255,0.78)"
        letterSpacing="0.2em"
      >
        IN
      </text>
      <text
        x={GRAPH.x - 18}
        y={GRAPH.y + GRAPH.h / 2}
        textAnchor="middle"
        fontSize={12}
        fontWeight={620}
        fill="rgba(255,255,255,0.78)"
        letterSpacing="0.2em"
        transform={`rotate(-90 ${GRAPH.x - 18} ${GRAPH.y + GRAPH.h / 2})`}
      >
        OUT
      </text>
    </g>
  )
}

// TODO: replace placeholder with actual reference image when ready
function ReferenceImage({
  shift,
  faceOverlay,
  borderOverlay,
}: {
  shift: number
  faceOverlay: number
  borderOverlay: number
}) {
  const bgTop = contrastRgb(184, 184, 188, shift)
  const bgMid = contrastRgb(146, 146, 152, shift)
  const bgBot = contrastRgb(112, 114, 122, shift)
  const skin = contrastRgb(204, 142, 102, shift)
  const cloth = contrastRgb(94, 100, 112, shift)
  const hair = contrastRgb(54, 44, 42, shift)

  const faceCx = PREVIEW.x + PREVIEW.w / 2
  const faceCy = PREVIEW.y + 200
  const faceRx = 80
  const faceRy = 104
  const clothLeft = faceCx - 160
  const clothRight = faceCx + 160
  const clothTop = faceCy + 92
  const clothBottom = PREVIEW.y + PREVIEW.h - 8

  return (
    <g>
      <defs>
        <linearGradient
          id="gmvs-ref-bg"
          x1="0"
          y1={PREVIEW.y}
          x2="0"
          y2={PREVIEW.y + PREVIEW.h}
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor={bgTop} />
          <stop offset="55%" stopColor={bgMid} />
          <stop offset="100%" stopColor={bgBot} />
        </linearGradient>
        <clipPath id="gmvs-ref-clip">
          <rect x={PREVIEW.x} y={PREVIEW.y} width={PREVIEW.w} height={PREVIEW.h} rx={20} />
        </clipPath>
      </defs>
      <g clipPath="url(#gmvs-ref-clip)">
        <rect x={PREVIEW.x} y={PREVIEW.y} width={PREVIEW.w} height={PREVIEW.h} fill="url(#gmvs-ref-bg)" />
        <ellipse cx={faceCx} cy={faceCy - 96} rx={92} ry={70} fill={hair} />
        <rect
          x={clothLeft}
          y={clothTop}
          width={clothRight - clothLeft}
          height={clothBottom - clothTop}
          rx={32}
          fill={cloth}
        />
        <ellipse cx={faceCx} cy={faceCy} rx={faceRx} ry={faceRy} fill={skin} />
      </g>
      <rect
        x={PREVIEW.x}
        y={PREVIEW.y}
        width={PREVIEW.w}
        height={PREVIEW.h}
        rx={20}
        fill="none"
        stroke="rgba(255,255,255,0.16)"
        strokeWidth={6}
      />
      <rect
        x={PREVIEW.x}
        y={PREVIEW.y}
        width={PREVIEW.w}
        height={PREVIEW.h}
        rx={20}
        fill="none"
        stroke={PURPLE}
        strokeWidth={2}
      />
      <g opacity={faceOverlay}>
        <ellipse
          cx={faceCx}
          cy={faceCy}
          rx={faceRx + 18}
          ry={faceRy + 20}
          fill="rgba(220,80,80,0.16)"
          stroke={ACCENT_RED}
          strokeWidth={2}
        />
      </g>
      <g opacity={borderOverlay}>
        <line
          x1={clothLeft}
          y1={clothTop}
          x2={clothRight}
          y2={clothTop}
          stroke={ACCENT_RED}
          strokeWidth={2.5}
          strokeDasharray="8 6"
        />
      </g>
    </g>
  )
}

function ConclusionPill({ t }: { t: number }) {
  const opacity = conclusionOpacity(t)
  if (opacity <= 0) return null
  return (
    <g opacity={opacity}>
      <rect
        x={CONCLUSION_PILL.cx - CONCLUSION_PILL.w / 2}
        y={CONCLUSION_PILL.y}
        width={CONCLUSION_PILL.w}
        height={CONCLUSION_PILL.h}
        rx={CONCLUSION_PILL.h / 2}
        fill={PURPLE}
      />
      <text
        x={CONCLUSION_PILL.cx}
        y={CONCLUSION_PILL.y + CONCLUSION_PILL.h / 2 + 6}
        textAnchor="middle"
        fontSize={18}
        fontWeight={780}
        fill="white"
      >
        立体感を出そうとしたのに、顔は暗くなり、服と壁の境目も消えた
      </text>
    </g>
  )
}

export default function GradingMixVsSplit({ isPlaying, reducedMotion }: VideoVisualProps) {
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

  const t = reducedMotion ? 10 : animT
  const shift = contrastShiftAt(t)

  return (
    <svg viewBox="0 0 1600 500" className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid meet">
      <defs>
        <radialGradient id="gmvs-aurora-purple" cx="20%" cy="8%" r="58%">
          <stop offset="0%" stopColor="rgba(139,127,255,0.42)" />
          <stop offset="100%" stopColor="rgba(139,127,255,0)" />
        </radialGradient>
        <radialGradient id="gmvs-aurora-pink" cx="88%" cy="10%" r="48%">
          <stop offset="0%" stopColor="rgba(210,126,188,0.28)" />
          <stop offset="100%" stopColor="rgba(210,126,188,0)" />
        </radialGradient>
        <radialGradient id="gmvs-aurora-sky" cx="54%" cy="104%" r="60%">
          <stop offset="0%" stopColor="rgba(110,174,210,0.28)" />
          <stop offset="100%" stopColor="rgba(110,174,210,0)" />
        </radialGradient>
      </defs>
      <rect x={0} y={0} width={W} height={H} fill="rgba(255,255,255,0.16)" />
      <rect x={0} y={0} width={W} height={H} fill="url(#gmvs-aurora-purple)" />
      <rect x={0} y={0} width={W} height={H} fill="url(#gmvs-aurora-pink)" />
      <rect x={0} y={0} width={W} height={H} fill="url(#gmvs-aurora-sky)" />
      <ReferenceImage shift={shift} faceOverlay={faceOverlayOpacity(t)} borderOverlay={borderOverlayOpacity(t)} />
      <ToneCurveGraph shift={shift} opacity={graphOpacity(t)} />
      <ToolBadges t={t} />
      <OrderPill t={t} />
      <ConclusionPill t={t} />
    </svg>
  )
}
