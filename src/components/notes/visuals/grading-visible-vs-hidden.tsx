const W = 1600
const H = 900

const OUTER_PAD = 50
const SECTION_GAP = 24
const SECTION_H = (H - OUTER_PAD * 2 - SECTION_GAP) / 2

const HEADER_H = 56
const ROW_GAP = 12
const ROW_H = (SECTION_H - HEADER_H - ROW_GAP * 2) / 2

const COL_PAD = 60
const COL_GAP = 24
const COL_NAME_W = 300
const COL_UI_W = 596
const COL_FAIL_W = W - COL_PAD * 2 - COL_NAME_W - COL_UI_W - COL_GAP * 2

const COL_NAME_X = COL_PAD
const COL_UI_X = COL_NAME_X + COL_NAME_W + COL_GAP
const COL_FAIL_X = COL_UI_X + COL_UI_W + COL_GAP

const SECTION_TOP_Y = OUTER_PAD
const SECTION_BOTTOM_Y = OUTER_PAD + SECTION_H + SECTION_GAP

const CORNER_R = 18
const CARD_R = 14

const BG_BASE = "#F8F6FF"
const ACCENT = "#8B7FFF"
const TEXT_PRIMARY = "#1C0F6E"
const TEXT_MUTED = "#6B5FA8"
const GLASS_FILL = "rgba(255,255,255,0.65)"
const GLASS_STROKE = "rgba(255,255,255,0.78)"
const PANEL_FILL = "rgba(255,255,255,0.55)"
const PANEL_STROKE = "rgba(255,255,255,0.72)"

const AMBER = "rgb(200,146,58)"
const TEAL = "rgb(46,140,132)"
const MAGENTA = "rgb(192,74,142)"
const NAVY = "rgb(42,79,143)"

const FONT_FAMILY = "var(--font-noto-sans-jp), sans-serif"
const MONO = "var(--font-geist-mono), ui-monospace, monospace"

type VisibleAxisKey = "curve" | "rgb"
type HiddenAxisKey = "spread" | "density"
type AxisKey = VisibleAxisKey | HiddenAxisKey

type AxisDef = {
  key: AxisKey
  name: string
  tagline: string
  color: string
  rowIndex: 0 | 1
}

type VisibleAxisDef = AxisDef & { key: VisibleAxisKey }
type HiddenAxisDef = AxisDef & { key: HiddenAxisKey }

const AXES_VISIBLE: VisibleAxisDef[] = [
  {
    key: "curve",
    name: "カーブ",
    tagline: "トーンの傾きが画面で動く",
    color: AMBER,
    rowIndex: 0,
  },
  {
    key: "rgb",
    name: "RGB カラーバランス",
    tagline: "ベース温度が画面で動く",
    color: TEAL,
    rowIndex: 1,
  },
]

const AXES_HIDDEN: HiddenAxisDef[] = [
  {
    key: "spread",
    name: "色の広がり・転がり",
    tagline: "彩度の連鎖はツールに出ない",
    color: MAGENTA,
    rowIndex: 0,
  },
  {
    key: "density",
    name: "濃度",
    tagline: "光の階層感はツールに出ない",
    color: NAVY,
    rowIndex: 1,
  },
]

function rowY(sectionY: number, rowIndex: 0 | 1) {
  return sectionY + HEADER_H + ROW_GAP + rowIndex * (ROW_H + ROW_GAP)
}

function AxisNameCard({
  x,
  y,
  axis,
}: {
  x: number
  y: number
  axis: AxisDef
}) {
  const chipW = 14
  const chipX = x + 24
  const chipY = y + 24
  const chipH = ROW_H - 48
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
        x={chipX + chipW + 18}
        y={y + 50}
        fill={TEXT_PRIMARY}
        fontSize={26}
        fontWeight={700}
        fontFamily={FONT_FAMILY}
      >
        {axis.name}
      </text>
      <text
        x={chipX + chipW + 18}
        y={y + 84}
        fill={TEXT_MUTED}
        fontSize={16}
        fontFamily={FONT_FAMILY}
      >
        {axis.tagline}
      </text>
      <text
        x={chipX + chipW + 18}
        y={y + ROW_H - 22}
        fill={axis.color}
        fontSize={11}
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
        x={x + 22}
        y={y + 28}
        fill={TEXT_MUTED}
        fontSize={11}
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
        x={x + 22}
        y={y + 28}
        fill={TEXT_MUTED}
        fontSize={11}
        fontFamily={MONO}
        letterSpacing="0.2em"
      >
        {title}
      </text>
      {children}
    </g>
  )
}

function CurveUI({ x, y }: { x: number; y: number }) {
  const innerX = x + 36
  const innerY = y + 46
  const innerW = COL_UI_W - 72
  const innerH = ROW_H - 70
  const xR = innerX + innerW
  const yB = innerY + innerH
  const gridLines = 4
  const grid: React.ReactNode[] = []
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
      />
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
      />
    )
  }
  const startX = innerX
  const startY = yB
  const c1x = innerX + innerW * 0.18
  const c1y = yB + innerH * 0.14
  const c2x = innerX + innerW * 0.38
  const c2y = innerY + innerH * 0.92
  const midX = innerX + innerW * 0.5
  const midY = innerY - innerH * 0.04
  const c3x = innerX + innerW * 0.62
  const c3y = innerY - innerH * 0.06
  const c4x = innerX + innerW * 0.82
  const c4y = innerY + innerH * 0.08
  const endX = xR
  const endY = innerY
  const path = `M ${startX} ${startY} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${midX} ${midY} C ${c3x} ${c3y}, ${c4x} ${c4y}, ${endX} ${endY}`
  const refPath = `M ${startX} ${startY} L ${endX} ${endY}`
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
      <path d={refPath} stroke="rgba(28,15,110,0.22)" strokeWidth={1} strokeDasharray="4 6" fill="none" />
      <path d={path} stroke={AMBER} strokeWidth={3} fill="none" strokeLinecap="round" />
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
    </g>
  )
}

function RgbParadeUI({ x, y }: { x: number; y: number }) {
  const innerX = x + 36
  const innerY = y + 46
  const innerW = COL_UI_W - 72
  const innerH = ROW_H - 70
  const colW = (innerW - 24) / 3
  const channels: { color: string; label: string; tilt: number; offset: number }[] = [
    { color: "rgba(239,68,68,0.78)", label: "R", tilt: 0.14, offset: -0.12 },
    { color: "rgba(74,222,128,0.78)", label: "G", tilt: -0.06, offset: 0.04 },
    { color: "rgba(96,165,250,0.78)", label: "B", tilt: -0.22, offset: 0.18 },
  ]
  return (
    <g>
      {channels.map((ch, i) => {
        const cx = innerX + i * (colW + 12)
        const cy = innerY
        const pts: string[] = []
        const samples = 20
        for (let s = 0; s <= samples; s += 1) {
          const t = s / samples
          const px = cx + t * colW
          const base = innerH * (0.65 - ch.offset)
          const wave = Math.sin(t * Math.PI * 1.8) * innerH * 0.18
          const tilt = (t - 0.5) * innerH * ch.tilt
          const py = cy + Math.max(8, Math.min(innerH - 8, base - wave + tilt))
          pts.push(`${px.toFixed(1)},${py.toFixed(1)}`)
        }
        const polyTop = pts.join(" ")
        const bottom = `${cx + colW},${cy + innerH} ${cx},${cy + innerH}`
        return (
          <g key={ch.label}>
            <rect
              x={cx}
              y={cy}
              width={colW}
              height={innerH}
              rx={6}
              fill="rgba(28,15,110,0.04)"
              stroke="rgba(28,15,110,0.12)"
              strokeWidth={1}
            />
            <polygon points={`${polyTop} ${bottom}`} fill={ch.color} opacity={0.4} />
            <polyline points={polyTop} fill="none" stroke={ch.color} strokeWidth={2.4} />
            <text
              x={cx + 8}
              y={cy + 18}
              fill={TEXT_MUTED}
              fontSize={12}
              fontFamily={MONO}
            >
              {ch.label}
            </text>
          </g>
        )
      })}
      <line
        x1={innerX}
        y1={innerY + innerH * 0.65}
        x2={innerX + innerW}
        y2={innerY + innerH * 0.65}
        stroke={TEAL}
        strokeWidth={1.5}
        strokeDasharray="4 6"
        opacity={0.55}
      />
    </g>
  )
}

function VectorscopeUI({ x, y }: { x: number; y: number }) {
  const innerX = x + 36
  const innerY = y + 46
  const innerW = COL_UI_W - 72
  const innerH = ROW_H - 70
  const cx = innerX + innerH / 2 + 8
  const cy = innerY + innerH / 2
  const r = innerH / 2 - 8
  const rightX = cx + r + 32
  const rightW = innerX + innerW - rightX
  const dots: { dx: number; dy: number; o: number }[] = [
    { dx: 0.06, dy: 0.04, o: 0.6 },
    { dx: -0.04, dy: 0.08, o: 0.5 },
    { dx: 0.1, dy: -0.05, o: 0.55 },
    { dx: -0.07, dy: -0.03, o: 0.4 },
    { dx: 0.02, dy: 0.11, o: 0.5 },
    { dx: 0.08, dy: -0.09, o: 0.45 },
    { dx: -0.09, dy: 0.05, o: 0.45 },
    { dx: 0.04, dy: -0.07, o: 0.5 },
    { dx: -0.05, dy: -0.08, o: 0.4 },
    { dx: 0.11, dy: 0.02, o: 0.55 },
    { dx: -0.02, dy: 0.09, o: 0.5 },
    { dx: 0.07, dy: 0.07, o: 0.45 },
  ]
  const meterX = rightX
  const meterY = innerY + 12
  const meterH = innerH - 24
  const meterW = Math.min(rightW - 12, 110)
  const ticks = 5
  const meterFillH = meterH * 0.42
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
      <circle cx={cx} cy={cy} r={r} fill="rgba(255,255,255,0.5)" stroke="rgba(28,15,110,0.18)" strokeWidth={1} />
      <circle cx={cx} cy={cy} r={r * 0.55} fill="none" stroke="rgba(28,15,110,0.12)" strokeWidth={1} strokeDasharray="3 5" />
      <line x1={cx - r} y1={cy} x2={cx + r} y2={cy} stroke="rgba(28,15,110,0.18)" strokeWidth={1} />
      <line x1={cx} y1={cy - r} x2={cx} y2={cy + r} stroke="rgba(28,15,110,0.18)" strokeWidth={1} />
      <circle cx={cx} cy={cy} r={3} fill={MAGENTA} />
      {dots.map((d, i) => (
        <circle
          key={i}
          cx={cx + d.dx * r}
          cy={cy + d.dy * r}
          r={2.4}
          fill={MAGENTA}
          opacity={d.o}
        />
      ))}
      <text
        x={cx}
        y={innerY + innerH - 10}
        textAnchor="middle"
        fill={TEXT_MUTED}
        fontSize={11}
        fontFamily={MONO}
        letterSpacing="0.18em"
      >
        VECTORSCOPE
      </text>
      <rect
        x={meterX}
        y={meterY}
        width={meterW}
        height={meterH}
        rx={6}
        fill="rgba(28,15,110,0.04)"
        stroke="rgba(28,15,110,0.14)"
        strokeWidth={1}
      />
      {Array.from({ length: ticks }).map((_, i) => {
        const ty = meterY + (meterH / ticks) * (i + 1) - meterH / ticks / 2
        return (
          <line
            key={i}
            x1={meterX}
            y1={ty}
            x2={meterX + meterW}
            y2={ty}
            stroke="rgba(28,15,110,0.08)"
            strokeWidth={1}
          />
        )
      })}
      <rect
        x={meterX + 6}
        y={meterY + meterH - meterFillH - 6}
        width={meterW - 12}
        height={meterFillH}
        rx={4}
        fill={MAGENTA}
        opacity={0.35}
      />
      <line
        x1={meterX}
        y1={meterY + meterH - meterFillH - 6}
        x2={meterX + meterW}
        y2={meterY + meterH - meterFillH - 6}
        stroke={MAGENTA}
        strokeWidth={2}
      />
      <text
        x={meterX + meterW / 2}
        y={meterY - 6}
        textAnchor="middle"
        fill={TEXT_MUTED}
        fontSize={10}
        fontFamily={MONO}
        letterSpacing="0.18em"
      >
        SAT
      </text>
    </g>
  )
}

function HistogramUI({ x, y }: { x: number; y: number }) {
  const innerX = x + 36
  const innerY = y + 46
  const innerW = COL_UI_W - 72
  const innerH = ROW_H - 70
  const leftW = innerW * 0.62
  const histX = innerX
  const histY = innerY
  const histW = leftW - 12
  const histH = innerH
  const samples = 80
  const top: string[] = []
  for (let s = 0; s <= samples; s += 1) {
    const t = s / samples
    const px = histX + t * histW
    const peak = Math.exp(-Math.pow((t - 0.52) / 0.18, 2))
    const shoulder = 0.18 * Math.exp(-Math.pow((t - 0.82) / 0.1, 2))
    const toe = 0.12 * Math.exp(-Math.pow((t - 0.18) / 0.08, 2))
    const v = peak * 0.78 + shoulder + toe
    const py = histY + histH - 14 - v * (histH - 24)
    top.push(`${px.toFixed(1)},${py.toFixed(1)}`)
  }
  const baseLine = `${histX + histW},${histY + histH - 14} ${histX},${histY + histH - 14}`
  const meterX = histX + leftW + 8
  const meterW = innerW - leftW - 8
  const meterY = innerY + 12
  const meterH = innerH - 24
  const fill = meterH * 0.5
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
      <line
        x1={histX}
        y1={histY + histH - 14}
        x2={histX + histW}
        y2={histY + histH - 14}
        stroke="rgba(28,15,110,0.18)"
        strokeWidth={1}
      />
      <polygon points={`${top.join(" ")} ${baseLine}`} fill={NAVY} opacity={0.28} />
      <polyline points={top.join(" ")} fill="none" stroke={NAVY} strokeWidth={2.2} />
      <text
        x={histX + 6}
        y={histY + histH - 2}
        fill={TEXT_MUTED}
        fontSize={10}
        fontFamily={MONO}
      >
        0
      </text>
      <text
        x={histX + histW - 22}
        y={histY + histH - 2}
        fill={TEXT_MUTED}
        fontSize={10}
        fontFamily={MONO}
      >
        255
      </text>
      <text
        x={histX + histW / 2}
        y={histY + 16}
        textAnchor="middle"
        fill={TEXT_MUTED}
        fontSize={11}
        fontFamily={MONO}
        letterSpacing="0.18em"
      >
        HISTOGRAM
      </text>
      <rect
        x={meterX}
        y={meterY}
        width={meterW}
        height={meterH}
        rx={6}
        fill="rgba(28,15,110,0.04)"
        stroke="rgba(28,15,110,0.14)"
        strokeWidth={1}
      />
      {Array.from({ length: 5 }).map((_, i) => {
        const ty = meterY + (meterH / 5) * (i + 1) - meterH / 5 / 2
        return (
          <line
            key={i}
            x1={meterX}
            y1={ty}
            x2={meterX + meterW}
            y2={ty}
            stroke="rgba(28,15,110,0.08)"
            strokeWidth={1}
          />
        )
      })}
      <rect
        x={meterX + 6}
        y={meterY + meterH - fill - 6}
        width={meterW - 12}
        height={fill}
        rx={4}
        fill={NAVY}
        opacity={0.32}
      />
      <line
        x1={meterX}
        y1={meterY + meterH - fill - 6}
        x2={meterX + meterW}
        y2={meterY + meterH - fill - 6}
        stroke={NAVY}
        strokeWidth={2}
      />
      <text
        x={meterX + meterW / 2}
        y={meterY - 6}
        textAnchor="middle"
        fill={TEXT_MUTED}
        fontSize={10}
        fontFamily={MONO}
        letterSpacing="0.18em"
      >
        DENS
      </text>
    </g>
  )
}

function InstantFail({ x, y, label }: { x: number; y: number; label: string }) {
  const innerX = x + 28
  const innerY = y + 46
  const innerH = ROW_H - 70
  const iconR = 32
  const iconCx = innerX + iconR
  const iconCy = innerY + innerH / 2
  return (
    <g>
      <circle cx={iconCx} cy={iconCy} r={iconR} fill="rgba(255,182,77,0.18)" stroke={AMBER} strokeWidth={2} />
      <path
        d={`M ${iconCx} ${iconCy - iconR + 12} L ${iconCx} ${iconCy + 4}`}
        stroke={AMBER}
        strokeWidth={3}
        strokeLinecap="round"
      />
      <circle cx={iconCx} cy={iconCy + iconR - 14} r={3} fill={AMBER} />
      <text
        x={iconCx + iconR + 18}
        y={iconCy - 6}
        fill={TEXT_PRIMARY}
        fontSize={20}
        fontWeight={700}
        fontFamily={FONT_FAMILY}
      >
        その場で気付く
      </text>
      <text
        x={iconCx + iconR + 18}
        y={iconCy + 20}
        fill={TEXT_MUTED}
        fontSize={14}
        fontFamily={FONT_FAMILY}
      >
        {label}
      </text>
    </g>
  )
}

function CrossSceneStrip({
  x,
  y,
  axis,
}: {
  x: number
  y: number
  axis: "spread" | "density"
}) {
  const innerX = x + 24
  const innerY = y + 44
  const innerW = COL_FAIL_W - 48
  const innerH = ROW_H - 64
  const tiles = 4
  const tileGap = 10
  const tileW = (innerW - tileGap * (tiles - 1)) / tiles
  const tileH = innerH - 26
  const color = axis === "spread" ? MAGENTA : NAVY
  return (
    <g>
      {Array.from({ length: tiles }).map((_, i) => {
        const tx = innerX + i * (tileW + tileGap)
        const ty = innerY
        const drift = i / (tiles - 1)
        const sat = axis === "spread" ? 0.04 + drift * 0.22 : 0
        const dense = axis === "density" ? 0.04 + drift * 0.18 : 0
        const baseTone = axis === "spread"
          ? `rgba(255,255,255,${0.55 - drift * 0.08})`
          : `rgba(255,255,255,${0.55 - drift * 0.14})`
        const accent = axis === "spread"
          ? `rgba(192,74,142,${sat})`
          : `rgba(42,79,143,${dense})`
        const hl = axis === "spread"
          ? `rgba(255,182,224,${0.18 + drift * 0.18})`
          : `rgba(180,196,232,${0.16 + drift * 0.18})`
        return (
          <g key={i}>
            <rect
              x={tx}
              y={ty}
              width={tileW}
              height={tileH}
              rx={8}
              fill={baseTone}
              stroke="rgba(28,15,110,0.14)"
              strokeWidth={1}
            />
            <rect
              x={tx}
              y={ty}
              width={tileW}
              height={tileH}
              rx={8}
              fill={accent}
            />
            <circle
              cx={tx + tileW * 0.32}
              cy={ty + tileH * 0.45}
              r={tileH * 0.22}
              fill={hl}
            />
            <rect
              x={tx + tileW * 0.55}
              y={ty + tileH * 0.5}
              width={tileW * 0.34}
              height={tileH * 0.34}
              rx={4}
              fill={hl}
              opacity={0.7}
            />
            <text
              x={tx + tileW / 2}
              y={ty + tileH + 18}
              textAnchor="middle"
              fill={TEXT_MUTED}
              fontSize={11}
              fontFamily={MONO}
              letterSpacing="0.16em"
            >
              S{i + 1}
            </text>
          </g>
        )
      })}
      <line
        x1={innerX}
        y1={innerY + tileH + 28}
        x2={innerX + innerW}
        y2={innerY + tileH + 28}
        stroke={color}
        strokeWidth={1.2}
        strokeDasharray="4 6"
        opacity={0.5}
      />
    </g>
  )
}

function SectionHeader({
  y,
  label,
  caption,
  tone,
  color,
}: {
  y: number
  label: string
  caption: string
  tone: "instant" | "prepared"
  color: string
}) {
  const x = COL_PAD
  const w = W - COL_PAD * 2
  const badgeW = 132
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
        x={x + 18}
        y={y + 12}
        width={badgeW}
        height={HEADER_H - 24}
        rx={(HEADER_H - 24) / 2}
        fill={color}
        opacity={0.92}
      />
      <text
        x={x + 18 + badgeW / 2}
        y={y + HEADER_H / 2 + 6}
        textAnchor="middle"
        fill="#FFFFFF"
        fontSize={18}
        fontWeight={700}
        fontFamily={FONT_FAMILY}
        letterSpacing="0.06em"
      >
        {label}
      </text>
      <text
        x={x + 18 + badgeW + 22}
        y={y + HEADER_H / 2 + 7}
        fill={TEXT_PRIMARY}
        fontSize={18}
        fontWeight={600}
        fontFamily={FONT_FAMILY}
      >
        {caption}
      </text>
      <text
        x={x + w - 22}
        y={y + HEADER_H / 2 + 5}
        textAnchor="end"
        fill={tone === "instant" ? AMBER : MAGENTA}
        fontSize={11}
        fontFamily={MONO}
        letterSpacing="0.22em"
      >
        {tone === "instant" ? "TOOL-VISIBLE / FAST" : "TOOL-HIDDEN / SLOW"}
      </text>
    </g>
  )
}

export default function GradingVisibleVsHidden() {
  return (
    <svg
      data-diagram-slug="grading-visible-vs-hidden"
      viewBox={`0 0 ${W} ${H}`}
      className="absolute inset-0 h-full w-full"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="グレーディング 4 軸を『ツール上で見える / 即応』と『ツール上で見えない / 仕込み』の上下 2 段に分類する静止図。上段はカーブ（AMBER）と RGB バランス（TEAL）でトーンカーブ模式と RGB パレード模式の破綻が画面で一目で読める。下段は色の広がり・転がり（MAGENTA）と濃度（NAVY）でベクトルスコープ／彩度メーターとヒストグラム／密度メーターはツール上で平穏に見え、右端のシーン跨ぎミニサムネ列で彩度と立体感が徐々にずれる差を示す。"
      fontFamily={FONT_FAMILY}
    >
      <defs>
        <radialGradient id="gvh-aurora-purple" cx="14%" cy="10%" r="50%">
          <stop offset="0%" stopColor="#8B7FFF" stopOpacity={0.18} />
          <stop offset="72%" stopColor="#8B7FFF" stopOpacity={0} />
        </radialGradient>
        <radialGradient id="gvh-aurora-pink" cx="88%" cy="6%" r="44%">
          <stop offset="0%" stopColor="#FF8FAB" stopOpacity={0.12} />
          <stop offset="72%" stopColor="#FF8FAB" stopOpacity={0} />
        </radialGradient>
        <radialGradient id="gvh-aurora-sky" cx="58%" cy="96%" r="48%">
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

      <rect x={0} y={0} width={W} height={H} fill={BG_BASE} />
      <rect x={0} y={0} width={W} height={H} fill="url(#gvh-aurora-purple)" />
      <rect x={0} y={0} width={W} height={H} fill="url(#gvh-aurora-pink)" />
      <rect x={0} y={0} width={W} height={H} fill="url(#gvh-aurora-sky)" />
      <rect x={0} y={0} width={W} height={H} fill="rgba(28,15,110,0.025)" />

      <rect
        x={COL_PAD - 14}
        y={SECTION_TOP_Y - 14}
        width={W - (COL_PAD - 14) * 2}
        height={SECTION_H + 28}
        rx={CORNER_R + 4}
        fill="rgba(255,255,255,0.28)"
        stroke="rgba(200,146,58,0.32)"
        strokeWidth={1.2}
      />
      <rect
        x={COL_PAD - 14}
        y={SECTION_BOTTOM_Y - 14}
        width={W - (COL_PAD - 14) * 2}
        height={SECTION_H + 28}
        rx={CORNER_R + 4}
        fill="rgba(255,255,255,0.28)"
        stroke="rgba(192,74,142,0.32)"
        strokeWidth={1.2}
      />

      <SectionHeader
        y={SECTION_TOP_Y}
        label="即応"
        caption="ツール上で破綻が見える ─ 立ち会いで返せる"
        tone="instant"
        color={AMBER}
      />
      <SectionHeader
        y={SECTION_BOTTOM_Y}
        label="仕込み"
        caption="ツール上では見えない ─ シーンを跨いで分かる"
        tone="prepared"
        color={MAGENTA}
      />

      {AXES_VISIBLE.map((axis) => {
        const y = rowY(SECTION_TOP_Y, axis.rowIndex)
        return (
          <g key={axis.key}>
            <AxisNameCard x={COL_NAME_X} y={y} axis={axis} />
            <ToolPanel
              x={COL_UI_X}
              y={y}
              title={axis.key === "curve" ? "TONE CURVE" : "RGB PARADE"}
            >
              {axis.key === "curve" ? (
                <CurveUI x={COL_UI_X} y={y} />
              ) : (
                <RgbParadeUI x={COL_UI_X} y={y} />
              )}
            </ToolPanel>
            <FailPanel
              x={COL_FAIL_X}
              y={y}
              title={axis.key === "curve" ? "FAILURE / VISIBLE" : "FAILURE / VISIBLE"}
            >
              <InstantFail
                x={COL_FAIL_X}
                y={y}
                label={
                  axis.key === "curve"
                    ? "曲線の凹凸が画面に出る"
                    : "ch 偏りが画面に出る"
                }
              />
            </FailPanel>
          </g>
        )
      })}

      {AXES_HIDDEN.map((axis) => {
        const y = rowY(SECTION_BOTTOM_Y, axis.rowIndex)
        return (
          <g key={axis.key}>
            <AxisNameCard x={COL_NAME_X} y={y} axis={axis} />
            <ToolPanel
              x={COL_UI_X}
              y={y}
              title={axis.key === "spread" ? "VECTOR / SATURATION" : "HISTOGRAM / DENSITY"}
            >
              {axis.key === "spread" ? (
                <VectorscopeUI x={COL_UI_X} y={y} />
              ) : (
                <HistogramUI x={COL_UI_X} y={y} />
              )}
            </ToolPanel>
            <FailPanel
              x={COL_FAIL_X}
              y={y}
              title="DRIFT / CROSS-SCENE"
            >
              <CrossSceneStrip x={COL_FAIL_X} y={y} axis={axis.key} />
            </FailPanel>
          </g>
        )
      })}
    </svg>
  )
}
