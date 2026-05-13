"use client"

import dynamic from "next/dynamic"

const VW = 1600
const VH_TOP = 450

const OUTER_PAD = 30
const HEADER_H = 48
const HEADER_GAP = 14

const ROW_H = 328

const COL_PAD = 50
const COL_GAP = 22
const COLUMN_W = (VW - COL_PAD * 2 - COL_GAP) / 2
const SUB_GAP = 11
const SUB_W = (COLUMN_W - SUB_GAP) / 2

const SECTION_TOP_Y = OUTER_PAD
const ROW_TOP_Y = SECTION_TOP_Y + HEADER_H + HEADER_GAP

const NAME_H = 164
const NAME_FAIL_GAP = 0
const FAIL_TOP_Y = ROW_TOP_Y + NAME_H + NAME_FAIL_GAP
const FAIL_H = ROW_TOP_Y + ROW_H - FAIL_TOP_Y

const TOOL_H = ROW_H

const COL_LEFT_X = COL_PAD
const COL_RIGHT_X = COL_PAD + COLUMN_W + COL_GAP
const TOOL_OFFSET_X = SUB_W + SUB_GAP

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
const MAGENTA = "rgb(176,82,160)"
const NAVY = "rgb(58,90,170)"

const FONT_FAMILY = "var(--font-noto-sans-jp), sans-serif"
const MONO = "var(--font-geist-mono), ui-monospace, monospace"

const RGB_CURVE_COLORS = {
  R: "rgba(220,72,82,0.95)",
  G: "rgba(56,168,108,0.95)",
  B: "rgba(74,128,210,0.95)",
} as const

type VisibleAxisKey = "curve" | "rgb"
type HiddenAxisKey = "spread" | "density"

type AxisDef<Key extends string> = {
  key: Key
  name: string
  tagline: string
  color: string
  toolTitle: string
  failLabel: string
  columnX: number
}

type VisibleAxisDef = AxisDef<VisibleAxisKey>
type HiddenAxisDef = AxisDef<HiddenAxisKey>

const AXES_VISIBLE: VisibleAxisDef[] = [
  {
    key: "curve",
    name: "カーブ",
    tagline: "1 本のマスタートーンが画面で動く",
    color: AMBER,
    toolTitle: "TONE CURVE / MASTER",
    failLabel: "曲線の凹凸が画面に出る",
    columnX: COL_LEFT_X,
  },
  {
    key: "rgb",
    name: "RGB カラーバランス",
    tagline: "R / G / B 3 本のトーンが少しずつ離れる",
    color: TEAL,
    toolTitle: "TONE CURVE / R · G · B",
    failLabel: "ch 別のずれが画面に出る",
    columnX: COL_RIGHT_X,
  },
]

const AXES_HIDDEN: HiddenAxisDef[] = [
  {
    key: "spread",
    name: "色の広がり・転がり",
    tagline: "クラスタの形がねじれて広がる",
    color: MAGENTA,
    toolTitle: "COLOR VOLUME / SPREAD",
    failLabel: "シーンを跨いで色の傾向で気付く",
    columnX: COL_LEFT_X,
  },
  {
    key: "density",
    name: "濃度",
    tagline: "有彩色帯が中央軸を上下にスライド",
    color: NAVY,
    toolTitle: "COLOR VOLUME / DENSITY",
    failLabel: "カット間で濃度の段違いで気付く",
    columnX: COL_RIGHT_X,
  },
]

const HiddenLeftCanvas = dynamic(
  () =>
    import("@/components/notes/visuals/grading-visible-vs-hidden-3d").then(
      (mod) => mod.HiddenLeftCanvas,
    ),
  {
    ssr: false,
    loading: () => <HiddenPlaceholder />,
  },
)

const HiddenRightCanvas = dynamic(
  () =>
    import("@/components/notes/visuals/grading-visible-vs-hidden-3d").then(
      (mod) => mod.HiddenRightCanvas,
    ),
  {
    ssr: false,
    loading: () => <HiddenPlaceholder />,
  },
)

function HiddenPlaceholder() {
  return (
    <div
      aria-hidden="true"
      className="h-full w-full"
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
      aria-label="グレーディング 4 軸を『ツール上で見える / 即応』と『ツール上で見えない / 仕込み』の上下 2 段に分類するハイブリッド図。上段は SVG で AMBER の 1 本マスタートーンカーブ（左カラム）と R / G / B 3 本トーンカーブ（右カラム）を左右 2 カラムで横並びにする。下段は @react-three/fiber の HSV 色立体を 2 つ並べ、左ノードはサーフェスがゆっくりうねって色相帯が転がる『広がり』（MAGENTA）、右ノードは形は安定したまま有彩色帯が中央軸を上下にスライドする『濃度』（NAVY）を表す。"
    >
      <div className="relative w-full" style={{ height: "50%" }}>
        <VisibleSectionSvg />
      </div>
      <div className="relative w-full" style={{ height: "50%" }}>
        <HiddenSectionSvg />
        <HiddenCanvasSlot side="left">
          <HiddenLeftCanvas />
        </HiddenCanvasSlot>
        <HiddenCanvasSlot side="right">
          <HiddenRightCanvas />
        </HiddenCanvasSlot>
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

      {AXES_VISIBLE.map((axis) => (
        <AxisRow key={axis.key} axis={axis} />
      ))}
    </svg>
  )
}

function HiddenSectionSvg() {
  return (
    <svg
      viewBox={`0 0 ${VW} ${VH_TOP}`}
      preserveAspectRatio="xMidYMid meet"
      className="absolute inset-0 h-full w-full"
      aria-hidden="true"
      fontFamily={FONT_FAMILY}
    >
      <defs>
        <radialGradient id="gvh-hidden-aurora-purple" cx="14%" cy="10%" r="60%">
          <stop offset="0%" stopColor="#8B7FFF" stopOpacity={0.16} />
          <stop offset="72%" stopColor="#8B7FFF" stopOpacity={0} />
        </radialGradient>
        <radialGradient id="gvh-hidden-aurora-magenta" cx="88%" cy="6%" r="48%">
          <stop offset="0%" stopColor="#FF8FAB" stopOpacity={0.14} />
          <stop offset="72%" stopColor="#FF8FAB" stopOpacity={0} />
        </radialGradient>
        <radialGradient id="gvh-hidden-aurora-sky" cx="58%" cy="100%" r="58%">
          <stop offset="0%" stopColor="#7DD3FC" stopOpacity={0.12} />
          <stop offset="72%" stopColor="#7DD3FC" stopOpacity={0} />
        </radialGradient>
        <filter id="gvh-hidden-card-shadow" x="-6%" y="-12%" width="112%" height="128%">
          <feDropShadow dx={0} dy={6} stdDeviation={12} floodColor="#8B7FFF" floodOpacity={0.13} />
        </filter>
        <filter id="gvh-hidden-badge-shadow" x="-6%" y="-30%" width="112%" height="160%">
          <feDropShadow dx={0} dy={4} stdDeviation={10} floodColor="#8B7FFF" floodOpacity={0.12} />
        </filter>
      </defs>

      <rect x={0} y={0} width={VW} height={VH_TOP} fill={BG_BASE} />
      <rect x={0} y={0} width={VW} height={VH_TOP} fill="url(#gvh-hidden-aurora-purple)" />
      <rect x={0} y={0} width={VW} height={VH_TOP} fill="url(#gvh-hidden-aurora-magenta)" />
      <rect x={0} y={0} width={VW} height={VH_TOP} fill="url(#gvh-hidden-aurora-sky)" />
      <rect x={0} y={0} width={VW} height={VH_TOP} fill="rgba(28,15,110,0.025)" />

      <rect
        x={COL_PAD - 14}
        y={SECTION_TOP_Y - 14}
        width={VW - (COL_PAD - 14) * 2}
        height={VH_TOP - (SECTION_TOP_Y - 14) - (OUTER_PAD - 14)}
        rx={CORNER_R + 4}
        fill="rgba(255,255,255,0.28)"
        stroke="rgba(176,82,160,0.32)"
        strokeWidth={1.2}
      />

      <SectionHeader
        y={SECTION_TOP_Y}
        label="仕込み"
        caption="ツール上で見えない ─ シーンを跨いで気付く"
        toneLabel="TOOL-HIDDEN / SLOW"
        toneColor={MAGENTA}
        color={MAGENTA}
        shadowPrefix="gvh-hidden"
      />

      {AXES_HIDDEN.map((axis) => (
        <HiddenAxisRow key={axis.key} axis={axis} />
      ))}
    </svg>
  )
}

function AxisRow({ axis }: { axis: VisibleAxisDef }) {
  const axisX = axis.columnX
  const toolX = axisX + TOOL_OFFSET_X
  return (
    <g>
      <AxisNameCard x={axisX} y={ROW_TOP_Y} axis={axis} shadowPrefix="gvh" />
      <FailPanel x={axisX} y={FAIL_TOP_Y} shadowPrefix="gvh">
        <FailIndicator
          x={axisX}
          y={FAIL_TOP_Y}
          headline="その場で気付く"
          label={axis.failLabel}
          color={axis.color}
        />
      </FailPanel>
      <ToolPanel x={toolX} y={ROW_TOP_Y} title={axis.toolTitle}>
        {axis.key === "curve" ? (
          <MasterCurveUI x={toolX} y={ROW_TOP_Y} />
        ) : (
          <RgbCurvesUI x={toolX} y={ROW_TOP_Y} />
        )}
      </ToolPanel>
    </g>
  )
}

function HiddenAxisRow({ axis }: { axis: HiddenAxisDef }) {
  const axisX = axis.columnX
  const toolX = axisX + TOOL_OFFSET_X
  return (
    <g>
      <AxisNameCard x={axisX} y={ROW_TOP_Y} axis={axis} shadowPrefix="gvh-hidden" />
      <FailPanel x={axisX} y={FAIL_TOP_Y} shadowPrefix="gvh-hidden">
        <FailIndicator
          x={axisX}
          y={FAIL_TOP_Y}
          headline="あとで気付く"
          label={axis.failLabel}
          color={axis.color}
        />
      </FailPanel>
      <ToolPanel x={toolX} y={ROW_TOP_Y} title={axis.toolTitle} shadowPrefix="gvh-hidden" />
    </g>
  )
}

function HiddenCanvasSlot({
  side,
  children,
}: {
  side: "left" | "right"
  children: React.ReactNode
}) {
  const left = side === "left" ? "28.3125%" : "75.875%"
  return (
    <div
      className="absolute"
      style={{
        left,
        top: "28.444%",
        width: "19.25%",
        height: "61.778%",
      }}
    >
      {children}
    </div>
  )
}

function SectionHeader({
  y,
  label,
  caption,
  toneLabel,
  toneColor,
  color,
  shadowPrefix = "gvh",
}: {
  y: number
  label: string
  caption: string
  toneLabel: string
  toneColor: string
  color: string
  shadowPrefix?: "gvh" | "gvh-hidden"
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
        filter={`url(#${shadowPrefix}-badge-shadow)`}
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
        fontSize={20}
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
        fontSize={20}
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
  shadowPrefix = "gvh",
}: {
  x: number
  y: number
  axis: AxisDef<string>
  shadowPrefix?: "gvh" | "gvh-hidden"
}) {
  const chipW = 12
  const chipX = x + 22
  const chipY = y + 14
  const chipH = NAME_H - 28
  const textCenterY = y + NAME_H / 2
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={SUB_W}
        height={NAME_H}
        rx={CARD_R}
        fill={PANEL_FILL}
        stroke={PANEL_STROKE}
        strokeWidth={1}
        filter={`url(#${shadowPrefix}-card-shadow)`}
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
        y={textCenterY - 12}
        fill={TEXT_PRIMARY}
        fontSize={24}
        fontWeight={700}
        fontFamily={FONT_FAMILY}
      >
        {axis.name}
      </text>
      <text
        x={chipX + chipW + 16}
        y={textCenterY + 16}
        fill={TEXT_MUTED}
        fontSize={16}
        fontFamily={FONT_FAMILY}
      >
        {axis.tagline}
      </text>
    </g>
  )
}

function ToolPanel({
  x,
  y,
  title,
  children,
  shadowPrefix = "gvh",
}: {
  x: number
  y: number
  title: string
  children?: React.ReactNode
  shadowPrefix?: "gvh" | "gvh-hidden"
}) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={SUB_W}
        height={TOOL_H}
        rx={CARD_R}
        fill={PANEL_FILL}
        stroke={PANEL_STROKE}
        strokeWidth={1}
        filter={`url(#${shadowPrefix}-card-shadow)`}
      />
      <text
        x={x + 20}
        y={y + 22}
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
  children,
  shadowPrefix = "gvh",
}: {
  x: number
  y: number
  children: React.ReactNode
  shadowPrefix?: "gvh" | "gvh-hidden"
}) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={SUB_W}
        height={FAIL_H}
        rx={CARD_R}
        fill={PANEL_FILL}
        stroke={PANEL_STROKE}
        strokeWidth={1}
        filter={`url(#${shadowPrefix}-card-shadow)`}
      />
      {children}
    </g>
  )
}

function curveGeometry(x: number, y: number) {
  const innerX = x + 28
  const innerY = y + 36
  const innerW = SUB_W - 56
  const innerH = TOOL_H - 50
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
  const clampY = (value: number) => Math.min(yB, Math.max(innerY, value))
  const startX = innerX
  const startY = yB
  const c1x = innerX + innerW * 0.18
  const c1y = clampY(yB + innerH * 0.12)
  const c2x = innerX + innerW * 0.4
  const c2y = innerY + innerH * 0.9
  const midX = innerX + innerW * 0.5
  const midY = clampY(innerY - innerH * 0.04)
  const c3x = innerX + innerW * 0.6
  const c3y = clampY(innerY - innerH * 0.06)
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

function FailIndicator({
  x,
  y,
  headline,
  label,
  color,
}: {
  x: number
  y: number
  headline: string
  label: string
  color: string
}) {
  const innerX = x + 22
  const iconR = 18
  const iconCx = innerX + iconR
  const iconCy = y + FAIL_H / 2
  return (
    <g>
      <circle
        cx={iconCx}
        cy={iconCy}
        r={iconR}
        fill="rgba(255,182,77,0.18)"
        stroke={color}
        strokeWidth={2}
      />
      <path
        d={`M ${iconCx} ${iconCy - iconR + 8} L ${iconCx} ${iconCy + 2}`}
        stroke={color}
        strokeWidth={2.4}
        strokeLinecap="round"
      />
      <circle cx={iconCx} cy={iconCy + iconR - 8} r={2.4} fill={color} />
      <text
        x={iconCx + iconR + 12}
        y={iconCy - 4}
        fill={TEXT_PRIMARY}
        fontSize={17}
        fontWeight={700}
        fontFamily={FONT_FAMILY}
      >
        {headline}
      </text>
      <text
        x={iconCx + iconR + 12}
        y={iconCy + 16}
        fill={TEXT_MUTED}
        fontSize={14}
        fontFamily={FONT_FAMILY}
      >
        {label}
      </text>
    </g>
  )
}
