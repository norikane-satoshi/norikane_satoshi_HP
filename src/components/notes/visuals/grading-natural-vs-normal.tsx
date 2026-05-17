const W = 1600
const H = 900

const PAD_TOP = 100
const PAD_BOTTOM = 100
const PAD_LEFT = 100
const PAD_RIGHT = 100
const GAP = 0
const IMG_W = (W - PAD_LEFT - PAD_RIGHT - GAP) / 2
const IMG_H = (H - PAD_TOP - PAD_BOTTOM - GAP) / 2
const CORNER_R = 0

const BG_BASE = "#F8F6FF"
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
    <g
      fill={ACCENT}
      fontSize={28}
      fontWeight={500}
      letterSpacing="0.05em"
      textAnchor="middle"
      dominantBaseline="central"
    >
      <text x={800} y={70}>
        ナチュラル高
      </text>
      <text x={800} y={830}>
        ナチュラル低
      </text>
      <text x={55} y={450} transform="rotate(-90 55 450)">
        ノーマル低
      </text>
      <text x={1545} y={450} transform="rotate(-90 1545 450)">
        ノーマル高
      </text>
    </g>
  )
}

function AxisCross() {
  return (
    <g
      stroke={ACCENT}
      strokeWidth="1.5"
      strokeOpacity="0.25"
      strokeLinecap="round"
      fill="none"
    >
      <path d="M 800 100 V 800" />
      <path d="M 100 450 H 1500" />
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
      viewBox={`0 0 ${W} ${H}`}
      className="absolute inset-0 h-full w-full"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="ナチュラル軸（上=ナチュラル高 / 下=ナチュラル低）とノーマル軸（右=ノーマル高 / 左=ノーマル低）の二軸を、中央十字線と外周の象限ピル付き 4 象限独立画像で対比する図。4 枚の画像は角丸なしで密着し、矢印と accent point は使わない。"
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
      </defs>

      <rect x={0} y={0} width={W} height={H} rx={CORNER_R} fill={BG_BASE} />

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

      <AxisCross />
      <AxisLabels />
      <QuadrantLabels />
    </svg>
  )
}
