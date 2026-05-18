const W = 1600
const H = 900

const PAD_TOP = 100
const PAD_BOTTOM = 100
const PAD_LEFT = 100
const PAD_RIGHT = 100
const GAP = 0
const IMG_W = (W - PAD_LEFT - PAD_RIGHT - GAP) / 2
const IMG_H = (H - PAD_TOP - PAD_BOTTOM - GAP) / 2

const ACCENT = "#8B7FFF"
const TEXT_PRIMARY = "#1C0F6E"
const PILL_W = 290
const PILL_H = 40

const QUADRANTS = [
  {
    role: "hero" as const,
    href: "/notes-assets/quadrant-natural-not-normal.png",
    x: PAD_LEFT,
    y: PAD_TOP,
  },
  {
    role: "support" as const,
    href: "/notes-assets/quadrant-normal.png",
    x: PAD_LEFT + IMG_W + GAP,
    y: PAD_TOP,
  },
  {
    role: "support" as const,
    href: "/notes-assets/quadrant-outdated.png",
    x: PAD_LEFT + IMG_W + GAP,
    y: PAD_TOP + IMG_H + GAP,
  },
  {
    role: "support" as const,
    href: "/notes-assets/quadrant-aza.png",
    x: PAD_LEFT,
    y: PAD_TOP + IMG_H + GAP,
  },
]

function AxisLabels() {
  return (
    <g fontFamily="var(--font-noto-sans-jp), system-ui, sans-serif" textAnchor="middle" dominantBaseline="central">
      <g fontSize={20} fontWeight={600} letterSpacing="0.12em" fill={TEXT_PRIMARY}>
        <text x={800} y={22}>
          ナチュラル
        </text>
        <text x={800} y={888}>
          ナチュラル
        </text>
        <text x={0} y={440}>
          ノーマル
        </text>
        <text x={1600} y={440}>
          ノーマル
        </text>
      </g>
      <g fontSize={11} fontWeight={600} letterSpacing="0.28em" fill={ACCENT}>
        <text x={800} y={48}>
          HIGH
        </text>
        <text x={800} y={862}>
          LOW
        </text>
        <text x={0} y={460}>
          LOW
        </text>
        <text x={1600} y={460}>
          HIGH
        </text>
      </g>
    </g>
  )
}

function AxisCrossDashed() {
  return (
    <g fill="none">
      <path
        d="M 800 100 L 800 800"
        stroke="#FFFFFF"
        strokeWidth={1.5}
        strokeOpacity={0.65}
        strokeDasharray="5 5"
        strokeLinecap="butt"
      />
      <path
        d="M 100 450 L 1500 450"
        stroke="#FFFFFF"
        strokeWidth={1.5}
        strokeOpacity={0.65}
        strokeDasharray="5 5"
        strokeLinecap="butt"
      />
    </g>
  )
}

function AxisCrossExtensions() {
  return (
    <g fill="none">
      <g>
        <path d="M 800 100 L 800 84" stroke="#FFFFFF" strokeWidth={2} strokeOpacity={0.85} strokeDasharray="5 5" strokeLinecap="butt" />
        <path d="M 800 800 L 800 816" stroke="#FFFFFF" strokeWidth={2} strokeOpacity={0.85} strokeDasharray="5 5" strokeLinecap="butt" />
        <path d="M 100 450 L 84 450" stroke="#FFFFFF" strokeWidth={2} strokeOpacity={0.85} strokeDasharray="5 5" strokeLinecap="butt" />
        <path d="M 1500 450 L 1516 450" stroke="#FFFFFF" strokeWidth={2} strokeOpacity={0.85} strokeDasharray="5 5" strokeLinecap="butt" />
      </g>
      <g stroke="none">
        <path d="M 800 80 L 800 81" markerStart="url(#cross-head)" />
        <path d="M 800 820 L 800 819" markerStart="url(#cross-head)" />
        <path d="M 80 450 L 81 450" markerStart="url(#cross-head)" />
        <path d="M 1520 450 L 1519 450" markerStart="url(#cross-head)" />
      </g>
    </g>
  )
}

function AxisCenterMark() {
  return (
    <circle
      cx={800}
      cy={450}
      r={5}
      fill="#FFFFFF"
      stroke={TEXT_PRIMARY}
      strokeWidth={1}
      strokeOpacity={0.42}
    />
  )
}

function QuadrantFrames() {
  return (
    <g>
      {QUADRANTS.map((q) => (
        <rect
          key={`${q.href}-frame`}
          x={q.x}
          y={q.y}
          width={IMG_W}
          height={IMG_H}
          fill="none"
          stroke="rgba(28,15,110,0.16)"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </g>
  )
}

function QuadrantPill({
  x,
  y,
  label,
  hero = false,
}: {
  x: number
  y: number
  label: string
  hero?: boolean
}) {
  return (
    <g transform={`translate(${x - PILL_W / 2} ${y - PILL_H / 2})`}>
      <rect
        width={PILL_W}
        height={PILL_H}
        rx={20}
        fill={hero ? ACCENT : "rgba(255,255,255,0.72)"}
        stroke={hero ? "none" : "rgba(139,127,255,0.35)"}
        strokeWidth={hero ? 0 : 1}
        filter={hero ? "url(#gnvn-hero-pill-shadow)" : "url(#gnvn-pill-shadow)"}
      />
      <text
        x={PILL_W / 2}
        y={PILL_H / 2}
        fill={hero ? "#FFFFFF" : TEXT_PRIMARY}
        fontSize={20}
        fontWeight={hero ? 700 : 600}
        textAnchor="middle"
        dominantBaseline="central"
      >
        {label}
      </text>
    </g>
  )
}

function QuadrantLabels() {
  return (
    <g>
      <QuadrantPill x={455} y={35} label="狙う狭い場所" hero />
      <QuadrantPill x={1145} y={35} label="設計上の中立" />
      <QuadrantPill x={455} y={865} label="あざとい" />
      <QuadrantPill x={1145} y={865} label="現在の感覚とずれる" />
    </g>
  )
}

export default function GradingNaturalVsNormal() {
  return (
    <svg
      data-diagram-slug="grading-natural-vs-normal"
      viewBox="-120 0 1840 900"
      className="absolute inset-0 h-full w-full"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="ナチュラル軸（上=ナチュラル高 / 下=ナチュラル低）とノーマル軸（右=ノーマル高 / 左=ノーマル低）の二軸を、中央十字線と外周の象限ピル付き 4 象限独立画像で対比する図。4 枚の画像は角丸なしで密着し、中央十字線の両端矢じりで方向を示す。"
      fontFamily="var(--font-noto-sans-jp), sans-serif"
    >
      <defs>
        <filter
          id="gnvn-pill-shadow"
          x="-10%"
          y="-40%"
          width="120%"
          height="180%"
          colorInterpolationFilters="sRGB"
        >
          <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#1C0F6E" floodOpacity="0.08" />
        </filter>
        <filter
          id="gnvn-hero-pill-shadow"
          x="-10%"
          y="-45%"
          width="120%"
          height="190%"
          colorInterpolationFilters="sRGB"
        >
          <feDropShadow dx="0" dy="2" stdDeviation="4" floodColor="#8B7FFF" floodOpacity="0.35" />
        </filter>
        <marker
          id="cross-head"
          viewBox="0 0 10 10"
          markerWidth={14}
          markerHeight={14}
          refX={0}
          refY={5}
          orient="auto-start-reverse"
        >
          <path d="M0,0 L10,5 L0,10 Z" fill={TEXT_PRIMARY} fillOpacity="0.9" />
        </marker>
      </defs>

      {QUADRANTS.map((q) => (
        <image
          key={q.href}
          href={q.href}
          x={q.x}
          y={q.y}
          width={IMG_W}
          height={IMG_H}
          preserveAspectRatio="xMidYMid slice"
        />
      ))}

      <QuadrantFrames />
      <AxisCrossDashed />
      <AxisCrossExtensions />
      <AxisCenterMark />
      <AxisLabels />
      <QuadrantLabels />
    </svg>
  )
}
