"use client"

import { useEffect, useRef, useState } from "react"

/**
 * v5 統合動画モジュール: 迷宮 → 因数分解 (上空 swirl + 5 列粒度 + 落下物理)
 *
 * 1 本の 20 秒ループで「混線していた 9 因子」が「フレーム → アングル → カメラ
 * → シーン → 作品 の 5 列粒度」へ整列する過程を描く。
 *
 *   - Phase 0 (0..4s)   : 上空 emit point 周辺で 9 chip がふわふわ swirl (scale 0.85)
 *   - Phase 1 (4..10s)  : 各 chip が所属列へ落下しながら本サイズに展開 (scale → 1.0)
 *   - Phase 2 (10..15s) : 全 chip が所属列に積層完了し静止 (因数分解の完成図)
 *   - Phase 3 (15..20s) : 全 chip が emit point へ吸い上げられ opacity 1→0
 *   - t=20 で Phase 0 に wrap し再ループ
 *
 * 物理は seed 固定の閉形解 (swirl は周期関数、fall は ease-out X / ease-in Y)
 * のみで構成し、衝突解決は所属列 × 積み順の事前割当で表現する (chip 同士の
 * 重なり NG を構造的に保証する)。
 */

const LOOP = 20
const W = 1600
const H = 500

const CHIP_W = 240
const CHIP_H = 56
const COL_W = 240
const COL_X = [80, 380, 680, 980, 1280]
const COL_TOP_Y = 200
const HEADER_OFFSET = 60 // 列ヘッダラベル下端から chip 1 段目までの間隔
const STACK_GAP = 8
const MAX_STACK = 3 // カメラ列の chip 数
const COL_H = HEADER_OFFSET + MAX_STACK * (CHIP_H + STACK_GAP) + 8 // 60 + 192 + 8 = 260
const COL_BOTTOM_Y = COL_TOP_Y + COL_H

const FALL_DUR = 1.6

// emit point Y: 上空中央やや前方 (Phase 0 swirl 中心 Y / Phase 3 吸い上げ先 Y、9 chip 共通)
// X は chip 個別 (CardSpec.emitX、220〜1400) で横方向に分散させる。列順とは無関係に
// シャッフルし、混沌・混線を視覚化する (Phase 32-AH)。
const EMIT_Y = 80

// 0.85: chip 実表示 240×56 → 204×47.6 で fontSize 20 ラベルが読める下限。
// 0.84 が判定境界、混沌感とのバランスでわずかに上を取る。
const SWIRL_SCALE = 0.85

const P0_END = 4
const P1_END = 10
const P2_END = 15
const P3_END = 20

const ACCENT = "rgb(139,127,255)"
const TEXT_PRIMARY = "rgba(28,15,110,0.92)"
const TEXT_MUTED = "rgba(107,95,168,0.85)"

const COLUMNS = [
  { label: "フレーム単位", borderOp: 0.85, fillOp: 0.10 },
  { label: "アングル単位", borderOp: 0.72, fillOp: 0.085 },
  { label: "カメラ単位", borderOp: 0.59, fillOp: 0.07 },
  { label: "シーン単位", borderOp: 0.45, fillOp: 0.055 },
  { label: "作品単位", borderOp: 0.32, fillOp: 0.04 },
]

const TINT_VIOLET = { border: "rgba(139,127,255,0.85)", bg: "rgba(139,127,255,0.10)", iconStroke: "rgba(95,80,210,0.92)" }
const TINT_AMBER = { border: "rgba(214,162,108,0.85)", bg: "rgba(214,162,108,0.10)", iconStroke: "rgba(160,108,60,0.92)" }
const TINT_CORAL = { border: "rgba(214,127,140,0.85)", bg: "rgba(214,127,140,0.10)", iconStroke: "rgba(160,75,90,0.92)" }
const TINT_ROSE = { border: "rgba(214,140,180,0.85)", bg: "rgba(214,140,180,0.10)", iconStroke: "rgba(160,80,120,0.92)" }
const TINT_SKY = { border: "rgba(120,165,225,0.85)", bg: "rgba(120,165,225,0.10)", iconStroke: "rgba(60,108,170,0.92)" }
const TINT_TEAL = { border: "rgba(108,180,170,0.85)", bg: "rgba(108,180,170,0.10)", iconStroke: "rgba(50,120,115,0.92)" }
const TINT_PLUM = { border: "rgba(170,120,200,0.85)", bg: "rgba(170,120,200,0.10)", iconStroke: "rgba(112,60,150,0.92)" }
const TINT_LIME = { border: "rgba(150,180,90,0.85)", bg: "rgba(150,180,90,0.10)", iconStroke: "rgba(95,130,40,0.92)" }
const TINT_INDIGO = { border: "rgba(110,120,210,0.85)", bg: "rgba(110,120,210,0.10)", iconStroke: "rgba(60,75,160,0.92)" }

type Tint = { border: string; bg: string; iconStroke: string }
type IconKind =
  | "camera"
  | "sun"
  | "thermo"
  | "person"
  | "cloud"
  | "scape"
  | "film"
  | "lens"
  | "illusion"

type CardSpec = {
  id: string
  label: string
  col: number
  stack: number
  emitX: number
  emitDelay: number
  fallStart: number
  swirlPhase: number
  swirlR: number
  swirlPeriod: number
  swirlDir: 1 | -1
  tint: Tint
  icon: IconKind
}

// 9 chip × (col, stack) は事前固定で重なり NG を構造的に保証する。stack 0 が
// 列ヘッダ直下 (上端) の段、stack を増やすほど下に積む。
// emitDelay ∈ [0, 2.5]、fallStart ∈ [4.0, 6.8] で時間差を作り、Phase 1 (6s) 内に
// 全 chip が着地できるよう FALL_DUR=1.6s の余白を確保する。
// swirlR は chip サイズ 240×56 (scale 0.85 適用後 204×48) に合わせ、
// 旧値 12〜18 を ×1.85〜2.22 倍 (26〜40) に拡張。chip 同士の重なりは
// 「混沌・混線」の表現として許容する。
const CARDS: CardSpec[] = [
  // フレーム列
  { id: "exposure", label: "露出揺れ", col: 0, stack: 0, emitX: 1100, emitDelay: 0.4, fallStart: 4.2, swirlPhase: 0.0, swirlR: 28, swirlPeriod: 2.0, swirlDir: 1, tint: TINT_AMBER, icon: "sun" },
  { id: "atmosphere", label: "大気", col: 0, stack: 1, emitX: 380, emitDelay: 1.6, fallStart: 5.4, swirlPhase: 1.4, swirlR: 38, swirlPeriod: 2.3, swirlDir: -1, tint: TINT_SKY, icon: "cloud" },
  // アングル列
  { id: "skin", label: "肌", col: 1, stack: 0, emitX: 220, emitDelay: 0.9, fallStart: 4.7, swirlPhase: 2.6, swirlR: 34, swirlPeriod: 1.8, swirlDir: 1, tint: TINT_ROSE, icon: "person" },
  { id: "illusion", label: "色の錯覚", col: 1, stack: 1, emitX: 1400, emitDelay: 2.0, fallStart: 5.9, swirlPhase: 3.7, swirlR: 26, swirlPeriod: 2.1, swirlDir: -1, tint: TINT_LIME, icon: "illusion" },
  // カメラ列
  { id: "camera", label: "カメラ差", col: 2, stack: 0, emitX: 540, emitDelay: 0.2, fallStart: 4.0, swirlPhase: 4.5, swirlR: 32, swirlPeriod: 1.9, swirlDir: 1, tint: TINT_VIOLET, icon: "camera" },
  { id: "lens", label: "レンズ", col: 2, stack: 1, emitX: 1240, emitDelay: 1.2, fallStart: 5.0, swirlPhase: 5.6, swirlR: 40, swirlPeriod: 2.2, swirlDir: -1, tint: TINT_INDIGO, icon: "lens" },
  { id: "color-temp", label: "色温度", col: 2, stack: 2, emitX: 820, emitDelay: 2.4, fallStart: 6.2, swirlPhase: 0.9, swirlR: 28, swirlPeriod: 2.0, swirlDir: 1, tint: TINT_CORAL, icon: "thermo" },
  // シーン列
  { id: "scene-tone", label: "シーントーン", col: 3, stack: 0, emitX: 680, emitDelay: 1.0, fallStart: 5.2, swirlPhase: 1.9, swirlR: 34, swirlPeriod: 2.1, swirlDir: 1, tint: TINT_TEAL, icon: "scape" },
  // 作品列
  { id: "work-look", label: "作品ルック", col: 4, stack: 0, emitX: 960, emitDelay: 1.8, fallStart: 6.8, swirlPhase: 3.0, swirlR: 30, swirlPeriod: 2.0, swirlDir: -1, tint: TINT_PLUM, icon: "film" },
]

function clamp01(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v
}
function easeInCubic(x: number) {
  return x * x * x
}
function easeOutCubic(x: number) {
  return 1 - Math.pow(1 - x, 3)
}
function easeInQuad(x: number) {
  return x * x
}
function lerp(a: number, b: number, p: number) {
  return a + (b - a) * p
}

function chipTargetCX(col: number) {
  return COL_X[col] + COL_W / 2
}

function chipTargetCY(stack: number) {
  // stack 0 = ヘッダ直下、stack を増やすほど下へ積む。chip 中心 y を返す。
  return COL_TOP_Y + HEADER_OFFSET + stack * (CHIP_H + STACK_GAP) + CHIP_H / 2
}

function swirlCenter(card: CardSpec, t: number) {
  const tau = Math.max(0, t - card.emitDelay)
  const angle = (card.swirlDir * 2 * Math.PI * tau) / card.swirlPeriod + card.swirlPhase
  const cx = card.emitX + card.swirlR * Math.cos(angle)
  const cy = EMIT_Y + card.swirlR * 0.6 * Math.sin(angle)
  return { cx, cy }
}

type ChipState = { cx: number; cy: number; opacity: number; scale: number }

function chipState(card: CardSpec, t: number): ChipState {
  const targetCX = chipTargetCX(card.col)
  const targetCY = chipTargetCY(card.stack)

  // Phase 3: 吸い上げ + フェードアウト (15..20s)
  if (t >= P2_END) {
    const p = clamp01((t - P2_END) / (P3_END - P2_END))
    const eased = easeInCubic(p)
    return {
      cx: lerp(targetCX, card.emitX, eased),
      cy: lerp(targetCY, EMIT_Y, eased),
      scale: lerp(1, SWIRL_SCALE, eased),
      opacity: 1 - eased,
    }
  }

  // Phase 2: 静止 (10..15s)
  if (t >= P1_END) {
    return { cx: targetCX, cy: targetCY, scale: 1, opacity: 1 }
  }

  // Phase 1: 落下 (chip 個別の fallStart から FALL_DUR 秒)
  if (t >= card.fallStart) {
    const p = clamp01((t - card.fallStart) / FALL_DUR)
    const start = swirlCenter(card, card.fallStart)
    return {
      cx: lerp(start.cx, targetCX, easeOutCubic(p)),
      cy: lerp(start.cy, targetCY, easeInQuad(p)),
      scale: lerp(SWIRL_SCALE, 1, easeOutCubic(p)),
      opacity: 1,
    }
  }

  // Phase 0: emit_delay 後 swirl + fade-in (scale=SWIRL_SCALE のまま emit point 周りをふわふわ旋回。ラベル可読性を保つ)
  if (t >= card.emitDelay) {
    const fadeIn = clamp01((t - card.emitDelay) / 0.6)
    const sw = swirlCenter(card, t)
    return { cx: sw.cx, cy: sw.cy, scale: SWIRL_SCALE, opacity: fadeIn }
  }

  // Pre-emission: emit point に駐機・不可視
  return { cx: card.emitX, cy: EMIT_Y, scale: SWIRL_SCALE, opacity: 0 }
}

function Icon({
  kind,
  x,
  y,
  stroke,
}: {
  kind: IconKind
  x: number
  y: number
  stroke: string
}) {
  const sw = 1.6
  const common = {
    stroke,
    strokeWidth: sw,
    fill: "none",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  }
  switch (kind) {
    case "camera":
      // 筐体 + ファインダ凸 + レンズ円 (3 線)
      return (
        <g {...common}>
          <rect x={x + 2} y={y + 8} width={24} height={14} rx={2} ry={2} />
          <path d={`M ${x + 10} ${y + 8} L ${x + 12} ${y + 5} L ${x + 18} ${y + 5} L ${x + 20} ${y + 8}`} />
          <circle cx={x + 14} cy={y + 15} r={3.5} />
        </g>
      )
    case "sun":
      // 太陽 ＝ 円 + 揺らぎ短線 4 本 (露出揺れ)
      return (
        <g {...common}>
          <circle cx={x + 14} cy={y + 14} r={4} />
          <path d={`M ${x + 14} ${y + 3} L ${x + 14} ${y + 6}`} />
          <path d={`M ${x + 14} ${y + 22} L ${x + 14} ${y + 25}`} />
          <path d={`M ${x + 3} ${y + 14} L ${x + 6} ${y + 14}`} />
          <path d={`M ${x + 22} ${y + 14} L ${x + 25} ${y + 14}`} />
        </g>
      )
    case "thermo":
      // 温度計: 細い管 + 球
      return (
        <g {...common}>
          <path d={`M ${x + 11} ${y + 5} a 3 3 0 0 1 6 0 L ${x + 17} ${y + 18} a 3 3 0 0 1 -6 0 Z`} />
          <circle cx={x + 14} cy={y + 22} r={3} fill={stroke} />
        </g>
      )
    case "person":
      // 半身バスト: 頭丸 + 肩弧
      return (
        <g {...common}>
          <circle cx={x + 14} cy={y + 9} r={3.5} />
          <path d={`M ${x + 5} ${y + 25} a 9 9 0 0 1 18 0`} />
        </g>
      )
    case "cloud":
      // 雲: なめらかな単一輪郭
      return (
        <g {...common}>
          <path
            d={`M ${x + 7} ${y + 19}
                a 4 4 0 0 1 0 -8
                a 5 5 0 0 1 9 -2
                a 4 4 0 0 1 4 5
                a 4 4 0 0 1 -4 5 Z`}
          />
        </g>
      )
    case "scape":
      // 風景: 地平線 + 山稜 + 太陽
      return (
        <g {...common}>
          <path d={`M ${x + 3} ${y + 21} L ${x + 25} ${y + 21}`} />
          <path d={`M ${x + 3} ${y + 21} L ${x + 9} ${y + 12} L ${x + 14} ${y + 17} L ${x + 20} ${y + 9} L ${x + 25} ${y + 21}`} />
          <circle cx={x + 22} cy={y + 6} r={1.8} />
        </g>
      )
    case "film":
      // 額縁: 外枠 + 内枠
      return (
        <g {...common}>
          <rect x={x + 3} y={y + 5} width={22} height={18} rx={1.5} ry={1.5} />
          <rect x={x + 7} y={y + 9} width={14} height={10} />
        </g>
      )
    case "lens":
      // 凸レンズ断面: 紡錘 + 中央光軸破線
      return (
        <g {...common}>
          <path d={`M ${x + 4} ${y + 14} a 12 7 0 0 1 20 0 a 12 7 0 0 1 -20 0 Z`} />
          <path
            d={`M ${x + 1.5} ${y + 14} L ${x + 26.5} ${y + 14}`}
            strokeOpacity={0.45}
            strokeDasharray="2 3"
          />
        </g>
      )
    case "illusion":
      // 同色矩形 2 つを濃淡背景の上に並べる「同じ色なのに違って見える」図
      return (
        <g>
          <rect
            x={x + 2}
            y={y + 7}
            width={11}
            height={14}
            fill="rgba(0,0,0,0.20)"
            stroke={stroke}
            strokeWidth={1}
          />
          <rect
            x={x + 15}
            y={y + 7}
            width={11}
            height={14}
            fill="rgba(0,0,0,0.05)"
            stroke={stroke}
            strokeWidth={1}
          />
          <rect x={x + 5} y={y + 11} width={5} height={6} fill={stroke} />
          <rect x={x + 18} y={y + 11} width={5} height={6} fill={stroke} />
        </g>
      )
  }
}

export default function CorrectionLabyrinthToFactor({
  isPlaying,
  reducedMotion,
}: {
  isPlaying: boolean
  reducedMotion: boolean
}) {
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

  // reducedMotion / 非再生時は Phase 2 中盤 (整列静止) を表示する
  const t = reducedMotion ? 12.5 : animT

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="absolute inset-0 h-full w-full"
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <linearGradient id="scope-axis-grad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor={ACCENT} stopOpacity={0.85} />
          <stop offset="100%" stopColor={ACCENT} stopOpacity={0.20} />
        </linearGradient>
      </defs>

      {/* 上部 eyebrow + 細→粗 粒度バー */}
      <text
        x={80}
        y={28}
        fill={TEXT_MUTED}
        fontSize={18}
        fontWeight={500}
        letterSpacing={4}
      >
        粒 度 の 階 層
      </text>
      <text
        x={72}
        y={190}
        textAnchor="end"
        fill={TEXT_MUTED}
        fontSize={16}
        fontWeight={500}
      >
        細
      </text>
      <text
        x={1528}
        y={190}
        fill={TEXT_MUTED}
        fontSize={16}
        fontWeight={500}
      >
        粗
      </text>
      <rect x={80} y={175} width={1440} height={14} rx={7} ry={7} fill="url(#scope-axis-grad)" />

      {/* 列間の連結矢印 (4 本、列の中段) */}
      {COLUMNS.slice(0, 4).map((_, i) => {
        const ax = COL_X[i] + COL_W + 12
        const bx = COL_X[i + 1] - 12
        const ay = COL_TOP_Y + 76
        return (
          <g key={`arrow-${i}`} opacity={0.55}>
            <path
              d={`M ${ax} ${ay} L ${bx} ${ay}`}
              stroke={ACCENT}
              strokeWidth={1.6}
              strokeLinecap="round"
              fill="none"
            />
            <path
              d={`M ${bx - 10} ${ay - 6} L ${bx} ${ay} L ${bx - 10} ${ay + 6}`}
              stroke={ACCENT}
              strokeWidth={1.6}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </g>
        )
      })}

      {/* 5 列の枠 + 番号バッジ + 層名ラベル */}
      {COLUMNS.map((col, i) => {
        const x = COL_X[i]
        const cx = x + COL_W / 2
        return (
          <g key={col.label}>
            <rect
              x={x}
              y={COL_TOP_Y}
              width={COL_W}
              height={COL_H}
              rx={20}
              ry={20}
              fill={ACCENT}
              fillOpacity={col.fillOp}
              stroke={ACCENT}
              strokeOpacity={col.borderOp}
              strokeWidth={1.6}
            />
            <rect
              x={x}
              y={COL_TOP_Y}
              width={COL_W}
              height={COL_H}
              rx={20}
              ry={20}
              fill="rgba(255,255,255,0.45)"
            />
            {/* 番号バッジ */}
            <circle
              cx={cx}
              cy={COL_TOP_Y - 48}
              r={18}
              fill="rgba(255,255,255,0.85)"
              stroke={ACCENT}
              strokeOpacity={col.borderOp}
              strokeWidth={1.6}
            />
            <text
              x={cx}
              y={COL_TOP_Y - 48 + 6}
              textAnchor="middle"
              fill={TEXT_PRIMARY}
              fontSize={18}
              fontWeight={700}
            >
              {i + 1}
            </text>
            {/* 層名ラベル (L プレフィックスなし) */}
            <text
              x={cx}
              y={COL_TOP_Y + 32}
              textAnchor="middle"
              fill={TEXT_PRIMARY}
              fontSize={20}
              fontWeight={700}
            >
              {col.label}
            </text>
          </g>
        )
      })}

      {/* 9 chip — phase 別の状態で描画 (中心座標 + scale) */}
      {CARDS.map((card) => {
        const s = chipState(card, t)
        if (s.opacity <= 0.001) return null
        return (
          <g
            key={card.id}
            opacity={s.opacity}
            transform={`translate(${s.cx} ${s.cy}) scale(${s.scale})`}
          >
            <rect
              x={-CHIP_W / 2}
              y={-CHIP_H / 2}
              width={CHIP_W}
              height={CHIP_H}
              rx={20}
              ry={20}
              fill={card.tint.bg}
              stroke={card.tint.border}
              strokeWidth={1.6}
            />
            <rect
              x={-CHIP_W / 2}
              y={-CHIP_H / 2}
              width={CHIP_W}
              height={CHIP_H}
              rx={20}
              ry={20}
              fill="rgba(255,255,255,0.55)"
            />
            <Icon
              kind={card.icon}
              x={-CHIP_W / 2 + 14}
              y={-CHIP_H / 2 + 14}
              stroke={card.tint.iconStroke}
            />
            <text
              x={-CHIP_W / 2 + 56}
              y={6}
              fill={TEXT_PRIMARY}
              fontSize={20}
              fontWeight={600}
            >
              {card.label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
