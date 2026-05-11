"use client"

import dynamic from "next/dynamic"

const VW = 1600
const VH_TOP = 450

const OUTER_PAD = 30
const HEADER_H = 48
const HEADER_GAP = 10
const ROW_GAP = 12
const COL_PAD = 50
const COL_GAP = 22
const COL_NAME_W = 296
const COL_FAIL_W = 280
const COL_UI_W = VW - COL_PAD * 2 - COL_NAME_W - COL_FAIL_W - COL_GAP * 2
const COL_NAME_X = COL_PAD
const COL_UI_X = COL_NAME_X + COL_NAME_W + COL_GAP
const COL_FAIL_X = COL_UI_X + COL_UI_W + COL_GAP

const SECTION_TOP_Y = OUTER_PAD
const ROWS_TOP_Y = SECTION_TOP_Y + HEADER_H + HEADER_GAP
const ROW_H = (VH_TOP - ROWS_TOP_Y - OUTER_PAD - ROW_GAP) / 2

const CARD_R = 14
const CORNER_R = 18

const BG_BASE = "#F8F6FF"
const TEXT_PRIMARY = "#1C0F6E"
const TEXT_MUTED = "#6B5FA8"
const GLASS_FILL = "rgba(255,255,255,0.65)"
const GLASS_STROKE = "rgba(255,255,255,0.78)"
const PANEL_FILL = "rgba(255,255,255,0.55)"
const PANEL_STROKE = "rgba(255,255,255,0.72)"

const AMBER = "rgb(200,146,58)"
const TEAL = "rgb(46,140,132)"
const MAGENTA = "rgb(192,74,142)"

const FONT_FAMILY = "var(--font-noto-sans-jp), sans-serif"
const MONO = "var(--font-geist-mono), ui-monospace, monospace"

const RGB_CURVE_COLORS = {
  R: "rgba(220,72,82,0.95)",
  G: "rgba(56,168,108,0.95)",
  B: "rgba(74,128,210,0.95)",
} as const

type VisibleAxisKey = "curve" | "rgb"

type VisibleAxisDef = {
  key: VisibleAxisKey
  name: string
  tagline: string
  color: string
  rowIndex: 0 | 1
}

const AXES_VISIBLE: VisibleAxisDef[] = [
  {
    key: "curve",
    name: "カーブ",
    tagline: "1 本のマスタートーンが画面で動く",
    color: AMBER,
    rowIndex: 0,
  },
  {
    key: "rgb",
    name: "RGB カラーバランス",
    tagline: "R / G / B 3 本のトーンが少しずつ離れる",
    color: TEAL,
    rowIndex: 1,
  },
]

function rowY(rowIndex: 0 | 1) {
  return ROWS_TOP_Y + rowIndex * (ROW_H + ROW_GAP)
}

const HiddenSection3D = dynamic(
  () => import("@/components/notes/visuals/grading-visible-vs-hidden-3d"),
  {
    ssr: false,
    loading: () => <HiddenPlaceholder />,
  },
)

function HiddenPlaceholder() {
  return (
    <div
      aria-hidden="true"
      className="absolute inset-0"
      style={{ background: "transparent" }}
    />
  )
}

export default function GradingVisibleVsHidden() {
  return (
    <div
      data-diagram-slug="grading-visible-vs-hidden"
      className="absolute inset-0 flex flex-col"
      role="img"
      aria-label="グレーディング 4 軸を『ツール上で見える / 即応』と『ツール上で見えない / 仕込み』の上下 2 段に分類するハイブリッド図。上段は SVG でカーブ（AMBER の 1 本マスタートーンカーブ）と RGB バランス（TEAL の R / G / B 3 本トーンカーブ）の対比を描く。下段は @react-three/fiber の 3D 色空間に粒子クラスタ S1–S4 を浮かべ、ゆっくり自動旋回でクラスタ重心のずれが色の広がり（MAGENTA）、縦軸方向の分布偏りが濃度（NAVY）を表す。"
    >
      <div className="relative w-full" style={{ height: "50%" }}>
        <VisibleSectionSvg />
      </div>
      <div className="relative w-full" style={{ height: "50%" }}>
        <HiddenSection3D />
      </div>
    </div>
  )
}

function VisibleSectionSvg() {
  return (
    <svg
      viewBox={`0 0 ${VW} ${VH_TOP}`}
      preserveAspectRatio="xMidYMid meet"
      className="absolute inset-0 h-full w-full"
      aria-hidden="true"
      fontFamily={FONT_FAMILY}
    >
      <defs>
        <radialGradient id="gvh-aurora-purple" cx="14%" cy="10%" r="60%">
          <stop offset="0%" stopColor="#8B7FFF" stopOpacity={0.18} />
          <stop offset="72%" stopColor="#8B7FFF" stopOpacity={0} />
        </radialGradient>
        <radialGradient id="gvh-aurora-pink" cx="88%" cy="6%" r="48%">
          <stop offset="0%" stopColor="#FF8FAB" stopOpacity={0.12} />
          <stop offset="72%" stopColor="#FF8FAB" stopOpacity={0} />
        </radialGradient>
        <radialGradient id="gvh-aurora-sky" cx="58%" cy="100%" r="58%">
          <stop offset="0%" stopColor="#7DD3FC" stopOpacity={0.12} />
          <stop offset="72%" stopColor="#7DD3FC" stopOpacity={0} />
        </radialGradient>
        <filter id="gvh-card-shadow" x="-6%" y="-12%" width="112%" height="128%">
          <feDropShadow dx={0} dy={6} stdDeviation={12} floodColor="#8B7FFF" floodOpacity={0.13} />
        </filter>
        <filter id="gvh-badge-shadow" x="-6%" y="-30%" width="112%" height="160%">
          <feDropShadow dx={0} dy={4} stdDeviation={10} floodColor="#8B7FFF" floodOpacity={0.12} />
        </filter>
      </defs>

      <rect x={0} y={0} width={VW} height={VH_TOP} fill={BG_BASE} />
      <rect x={0} y={0} width={VW} height={VH_TOP} fill="url(#gvh-aurora-purple)" />
      <rect x={0} y={0} width={VW} height={VH_TOP} fill="url(#gvh-aurora-pink)" />
      <rect x={0} y={0} width={VW} height={VH_TOP} fill="url(#gvh-aurora-sky)" />
      <rect x={0} y={0} width={VW} height={VH_TOP} fill="rgba(28,15,110,0.025)" />

      <rect
        x={COL_PAD - 14}
        y={SECTION_TOP_Y - 14}
        width={VW - (COL_PAD - 14) * 2}
        height={VH_TOP - (SECTION_TOP_Y - 14) - (OUTER_PAD - 14)}
        rx={CORNER_R + 4}
        fill="rgba(255,255,255,0.28)"
        stroke="rgba(200,146,58,0.32)"
        strokeWidth={1.2}
      />

      <SectionHeader
        y={SECTION_TOP_Y}
        label="即応"
        caption="ツール上で破綻が見える ─ 立ち会いで返せる"
        toneLabel="TOOL-VISIBLE / FAST"
        toneColor={AMBER}
        color={AMBER}
      />

      {AXES_VISIBLE.map((axis) => {
        const y = rowY(axis.rowIndex)
        return (
          <g key={axis.key}>
            <AxisNameCard x={COL_NAME_X} y={y} axis={axis} />
            <ToolPanel
              x={COL_UI_X}
              y={y}
              title={axis.key === "curve" ? "TONE CURVE / MASTER" : "TONE CURVE / R · G · B"}
            >
              {axis.key === "curve" ? (
                <MasterCurveUI x={COL_UI_X} y={y} />
              ) : (
                <RgbCurvesUI x={COL_UI_X} y={y} />
              )}
            </ToolPanel>
            <FailPanel x={COL_FAIL_X} y={y} title="FAILURE / VISIBLE">
              <InstantFail
                x={COL_FAIL_X}
                y={y}
                label={
                  axis.key === "curve"
                    ? "曲線の凹凸が画面に出る"
                    : "ch 別のずれが画面に出る"
                }
              />
            </FailPanel>
          </g>
        )
      })}
    </svg>
  )
}

function SectionHeader({
  y,
  label,
  caption,
  toneLabel,
  toneColor,
  color,
}: {
  y: number
  label: string
  caption: string
  toneLabel: string
  toneColor: string
  color: string
}) {
  const x = COL_PAD
  const w = VW - COL_PAD * 2
  const badgeW = 124
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={HEADER_H}
        rx={CARD_R}
        fill={GLASS_FILL}
        stroke={GLASS_STROKE}
        strokeWidth={1}
        filter="url(#gvh-badge-shadow)"
      />
      <rect
        x={x + 16}
        y={y + 10}
        width={badgeW}
        height={HEADER_H - 20}
        rx={(HEADER_H - 20) / 2}
        fill={color}
        opacity={0.92}
      />
      <text
        x={x + 16 + badgeW / 2}
        y={y + HEADER_H / 2 + 6}
        textAnchor="middle"
        fill="#FFFFFF"
        fontSize={17}
        fontWeight={700}
        fontFamily={FONT_FAMILY}
        letterSpacing="0.06em"
      >
        {label}
      </text>
      <text
        x={x + 16 + badgeW + 20}
        y={y + HEADER_H / 2 + 6}
        fill={TEXT_PRIMARY}
        fontSize={17}
        fontWeight={600}
        fontFamily={FONT_FAMILY}
      >
        {caption}
      </text>
      <text
        x={x + w - 18}
        y={y + HEADER_H / 2 + 4}
        textAnchor="end"
        fill={toneColor}
        fontSize={11}
        fontFamily={MONO}
        letterSpacing="0.22em"
      >
        {toneLabel}
      </text>
    </g>
  )
}

function AxisNameCard({
  x,
  y,
  axis,
}: {
  x: number
  y: number
  axis: VisibleAxisDef
}) {
  const chipW = 12
  const chipX = x + 22
  const chipY = y + 22
  const chipH = ROW_H - 44
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={COL_NAME_W}
        height={ROW_H}
        rx={CARD_R}
        fill={PANEL_FILL}
        stroke={PANEL_STROKE}
        strokeWidth={1}
        filter="url(#gvh-card-shadow)"
      />
      <rect
        x={chipX}
        y={chipY}
        width={chipW}
        height={chipH}
        rx={6}
        fill={axis.color}
        opacity={0.92}
      />
      <text
        x={chipX + chipW + 16}
        y={y + 46}
        fill={TEXT_PRIMARY}
        fontSize={24}
        fontWeight={700}
        fontFamily={FONT_FAMILY}
      >
        {axis.name}
      </text>
      <text
        x={chipX + chipW + 16}
        y={y + 76}
        fill={TEXT_MUTED}
        fontSize={14}
        fontFamily={FONT_FAMILY}
      >
        {axis.tagline}
      </text>
      <text
        x={chipX + chipW + 16}
        y={y + ROW_H - 18}
        fill={axis.color}
        fontSize={10}
        fontFamily={MONO}
        letterSpacing="0.18em"
      >
        AXIS / {axis.key.toUpperCase()}
      </text>
    </g>
  )
}

function ToolPanel({
  x,
  y,
  title,
  children,
}: {
  x: number
  y: number
  title: string
  children: React.ReactNode
}) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={COL_UI_W}
        height={ROW_H}
        rx={CARD_R}
        fill={PANEL_FILL}
        stroke={PANEL_STROKE}
        strokeWidth={1}
        filter="url(#gvh-card-shadow)"
      />
      <text
        x={x + 20}
        y={y + 24}
        fill={TEXT_MUTED}
        fontSize={10}
        fontFamily={MONO}
        letterSpacing="0.2em"
      >
        {title}
      </text>
      {children}
    </g>
  )
}

function FailPanel({
  x,
  y,
  title,
  children,
}: {
  x: number
  y: number
  title: string
  children: React.ReactNode
}) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={COL_FAIL_W}
        height={ROW_H}
        rx={CARD_R}
        fill={PANEL_FILL}
        stroke={PANEL_STROKE}
        strokeWidth={1}
        filter="url(#gvh-card-shadow)"
      />
      <text
        x={x + 20}
        y={y + 24}
        fill={TEXT_MUTED}
        fontSize={10}
        fontFamily={MONO}
        letterSpacing="0.2em"
      >
        {title}
      </text>
      {children}
    </g>
  )
}

function curveGeometry(x: number, y: number) {
  const innerX = x + 28
  const innerY = y + 40
  const innerW = COL_UI_W - 56
  const innerH = ROW_H - 56
  return {
    innerX,
    innerY,
    innerW,
    innerH,
    xR: innerX + innerW,
    yB: innerY + innerH,
  }
}

function CurveAxesBg({
  innerX,
  innerY,
  innerW,
  innerH,
}: {
  innerX: number
  innerY: number
  innerW: number
  innerH: number
}) {
  const grid: React.ReactNode[] = []
  const gridLines = 4
  const xR = innerX + innerW
  const yB = innerY + innerH
  for (let i = 1; i < gridLines; i += 1) {
    const gx = innerX + (innerW / gridLines) * i
    grid.push(
      <line
        key={`gv${i}`}
        x1={gx}
        y1={innerY}
        x2={gx}
        y2={yB}
        stroke="rgba(28,15,110,0.08)"
        strokeWidth={1}
      />,
    )
    const gy = innerY + (innerH / gridLines) * i
    grid.push(
      <line
        key={`gh${i}`}
        x1={innerX}
        y1={gy}
        x2={xR}
        y2={gy}
        stroke="rgba(28,15,110,0.08)"
        strokeWidth={1}
      />,
    )
  }
  const refPath = `M ${innerX} ${yB} L ${xR} ${innerY}`
  return (
    <g>
      <rect
        x={innerX}
        y={innerY}
        width={innerW}
        height={innerH}
        rx={8}
        fill="rgba(28,15,110,0.04)"
        stroke="rgba(28,15,110,0.12)"
        strokeWidth={1}
      />
      {grid}
      <path
        d={refPath}
        stroke="rgba(28,15,110,0.22)"
        strokeWidth={1}
        strokeDasharray="4 6"
        fill="none"
      />
    </g>
  )
}

function MasterCurveUI({ x, y }: { x: number; y: number }) {
  const { innerX, innerY, innerW, innerH, xR, yB } = curveGeometry(x, y)
  const startX = innerX
  const startY = yB
  const c1x = innerX + innerW * 0.18
  const c1y = yB + innerH * 0.12
  const c2x = innerX + innerW * 0.4
  const c2y = innerY + innerH * 0.9
  const midX = innerX + innerW * 0.5
  const midY = innerY - innerH * 0.04
  const c3x = innerX + innerW * 0.6
  const c3y = innerY - innerH * 0.06
  const c4x = innerX + innerW * 0.82
  const c4y = innerY + innerH * 0.08
  const endX = xR
  const endY = innerY
  const path = `M ${startX} ${startY} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${midX} ${midY} C ${c3x} ${c3y}, ${c4x} ${c4y}, ${endX} ${endY}`
  return (
    <g>
      <CurveAxesBg innerX={innerX} innerY={innerY} innerW={innerW} innerH={innerH} />
      <path
        d={path}
        stroke={AMBER}
        strokeWidth={3}
        fill="none"
        strokeLinecap="round"
      />
      <circle cx={midX} cy={midY} r={5} fill={AMBER} />
      <circle cx={c2x} cy={yB - 2} r={4} fill={AMBER} opacity={0.55} />
      <circle cx={c3x} cy={innerY + 2} r={4} fill={AMBER} opacity={0.55} />
      <text
        x={innerX + 8}
        y={yB - 6}
        fill="rgba(28,15,110,0.45)"
        fontSize={10}
        fontFamily={MONO}
      >
        0
      </text>
      <text
        x={xR - 28}
        y={innerY - 6}
        fill="rgba(28,15,110,0.45)"
        fontSize={10}
        fontFamily={MONO}
      >
        255
      </text>
      <text
        x={midX + 12}
        y={midY + 4}
        fill={TEXT_PRIMARY}
        fontSize={11}
        fontFamily={MONO}
        letterSpacing="0.16em"
      >
        MASTER
      </text>
    </g>
  )
}

type ChannelDef = {
  key: "R" | "G" | "B"
  color: string
  offset: number
  curvature: number
}

const RGB_CHANNELS: ChannelDef[] = [
  { key: "R", color: RGB_CURVE_COLORS.R, offset: 0.16, curvature: 0.32 },
  { key: "G", color: RGB_CURVE_COLORS.G, offset: 0.0, curvature: 0.22 },
  { key: "B", color: RGB_CURVE_COLORS.B, offset: -0.14, curvature: 0.18 },
]

function rgbCurvePath(
  innerX: number,
  innerY: number,
  innerW: number,
  innerH: number,
  offset: number,
  curvature: number,
) {
  const xR = innerX + innerW
  const yB = innerY + innerH
  const startX = innerX
  const startY = yB - innerH * 0.02
  const endX = xR
  const endY = innerY + innerH * 0.02
  const lift = innerH * offset
  const midX = innerX + innerW * 0.5
  const midY = innerY + innerH * (0.5 - offset)
  const c1x = innerX + innerW * 0.22
  const c1y = yB - innerH * (0.18 + curvature * 0.5) - lift * 0.4
  const c2x = innerX + innerW * 0.42
  const c2y = innerY + innerH * (0.72 - curvature * 0.5) - lift * 0.55
  const c3x = innerX + innerW * 0.6
  const c3y = innerY + innerH * (0.32 + curvature * 0.5) - lift * 0.55
  const c4x = innerX + innerW * 0.82
  const c4y = innerY + innerH * (0.16 - curvature * 0.3) - lift * 0.4
  return `M ${startX} ${startY} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${midX} ${midY} C ${c3x} ${c3y}, ${c4x} ${c4y}, ${endX} ${endY}`
}

function RgbCurvesUI({ x, y }: { x: number; y: number }) {
  const { innerX, innerY, innerW, innerH, xR, yB } = curveGeometry(x, y)
  const legendX = xR - 78
  const legendY = innerY + 12
  return (
    <g>
      <CurveAxesBg innerX={innerX} innerY={innerY} innerW={innerW} innerH={innerH} />
      {RGB_CHANNELS.map((ch) => {
        const d = rgbCurvePath(innerX, innerY, innerW, innerH, ch.offset, ch.curvature)
        return (
          <path
            key={ch.key}
            d={d}
            stroke={ch.color}
            strokeWidth={2.4}
            fill="none"
            strokeLinecap="round"
            opacity={0.92}
          />
        )
      })}
      <text
        x={innerX + 8}
        y={yB - 6}
        fill="rgba(28,15,110,0.45)"
        fontSize={10}
        fontFamily={MONO}
      >
        0
      </text>
      <text
        x={xR - 28}
        y={innerY - 6}
        fill="rgba(28,15,110,0.45)"
        fontSize={10}
        fontFamily={MONO}
      >
        255
      </text>
      <g>
        {RGB_CHANNELS.map((ch, i) => (
          <g key={ch.key} transform={`translate(${legendX} ${legendY + i * 16})`}>
            <line x1={0} y1={6} x2={18} y2={6} stroke={ch.color} strokeWidth={2.4} />
            <text
              x={24}
              y={10}
              fill={TEXT_PRIMARY}
              fontSize={11}
              fontFamily={MONO}
              letterSpacing="0.16em"
            >
              {ch.key}
            </text>
          </g>
        ))}
      </g>
    </g>
  )
}

function InstantFail({ x, y, label }: { x: number; y: number; label: string }) {
  const innerX = x + 22
  const innerY = y + 38
  const innerH = ROW_H - 56
  const iconR = 28
  const iconCx = innerX + iconR
  const iconCy = innerY + innerH / 2
  return (
    <g>
      <circle
        cx={iconCx}
        cy={iconCy}
        r={iconR}
        fill="rgba(255,182,77,0.18)"
        stroke={AMBER}
        strokeWidth={2}
      />
      <path
        d={`M ${iconCx} ${iconCy - iconR + 12} L ${iconCx} ${iconCy + 4}`}
        stroke={AMBER}
        strokeWidth={3}
        strokeLinecap="round"
      />
      <circle cx={iconCx} cy={iconCy + iconR - 14} r={3} fill={AMBER} />
      <text
        x={iconCx + iconR + 14}
        y={iconCy - 4}
        fill={TEXT_PRIMARY}
        fontSize={17}
        fontWeight={700}
        fontFamily={FONT_FAMILY}
      >
        その場で気付く
      </text>
      <text
        x={iconCx + iconR + 14}
        y={iconCy + 18}
        fill={TEXT_MUTED}
        fontSize={12}
        fontFamily={FONT_FAMILY}
      >
        {label}
      </text>
    </g>
  )
}
