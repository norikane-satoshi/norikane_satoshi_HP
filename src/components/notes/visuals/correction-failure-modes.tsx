"use client"

import { useEffect, useRef, useState } from "react"

/**
 * v5 動画モジュール: 破綻の代表型 — 色のひっくり返り
 *
 * viewBox 1600×500 (16:5)。AY で「暗部の濁り」セルを削除し、
 * 「色のひっくり返り」単独構成に再編した。LOOP = 8s。
 *
 * 加算が偏ると、ある閾値で RGB の信号順位が反転し、chip の hue が跳ぶ。
 * 4 つの高彩度サンプル (赤主 / 緑主 / 青主 / 黄主) を縦 1 列ずつ並べ、
 * 各 ch に偏った加算 (offsetMax × u) を 0 → 強 → 0 とランプ。
 * 現在 swatch + 起点 swatch + RGB バー + 順位ラベル + ひっくり返りバッジで
 * 順位反転の瞬間を可視化する。
 *
 * SSR 設計: render は t=0 / isPlaying=false の純関数。
 * IntersectionObserver / matchMedia / requestAnimationFrame は useEffect 内のみ。
 * reducedMotion 時は u を中央値 0.65 で固定して静止画化。
 *
 * 配色: 既存マーカー群と AW (space-choice) で使用済みの TINT を全て除外。
 * 破綻テーマなので muted ・ warning 寄り (faded crimson 系)。
 */

const LOOP = 8.0
const W = 1600
const H = 500

const TEXT_PRIMARY = "rgba(28,15,110,0.95)"
const TEXT_MUTED = "rgba(28,15,110,0.55)"

const TINT_FLIP = {
  border: "rgba(190,100,100,0.85)",
  bg: "rgba(190,100,100,0.10)",
  curve: "rgb(160,70,70)",
}

// RGB 3 chan 表示色 (信号比較用、TINT とは別系統で意味は固定の R/G/B)
const CHAN_COLORS: Record<"R" | "G" | "B", string> = {
  R: "rgb(214,80,80)",
  G: "rgb(60,150,90)",
  B: "rgb(80,100,200)",
}

function umphase(t: number) {
  // 0 → 1 → 0 を 1 ループで走る対称ランプ
  return 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / LOOP)
}

function clamp01(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

const FLIP_HEADER_X = 56
const FLIP_HEADER_Y = 64

type RGB = [number, number, number]

function rgbCss(rgb: RGB) {
  const r = Math.round(clamp01(rgb[0]) * 255)
  const g = Math.round(clamp01(rgb[1]) * 255)
  const b = Math.round(clamp01(rgb[2]) * 255)
  return `rgb(${r}, ${g}, ${b})`
}

function rankSignature(rgb: RGB) {
  // 順位を文字列化 (例: "RGB" / "BRG")。≈ は無視して厳密順位で比較。
  const arr: Array<{ ch: "R" | "G" | "B"; v: number }> = [
    { ch: "R", v: rgb[0] },
    { ch: "G", v: rgb[1] },
    { ch: "B", v: rgb[2] },
  ]
  arr.sort((a, b) => b.v - a.v)
  return arr.map((x) => x.ch).join("")
}

function rankLabel(rgb: RGB) {
  // 表示用: 近接 (< 0.04) を ≈ で繋ぐ
  const arr: Array<{ ch: "R" | "G" | "B"; v: number }> = [
    { ch: "R", v: rgb[0] },
    { ch: "G", v: rgb[1] },
    { ch: "B", v: rgb[2] },
  ]
  arr.sort((a, b) => b.v - a.v)
  const parts: string[] = [arr[0].ch]
  for (let i = 1; i < arr.length; i++) {
    const sep = Math.abs(arr[i - 1].v - arr[i].v) < 0.04 ? "≈" : ">"
    parts.push(sep)
    parts.push(arr[i].ch)
  }
  return parts.join(" ")
}

type ChipSpec = {
  base: RGB
  offsetMax: RGB
  label: string
}

const CHIPS: ChipSpec[] = [
  { base: [0.95, 0.1, 0.05], offsetMax: [0.05, 0.5, 0.92], label: "赤主" },
  { base: [0.1, 0.92, 0.05], offsetMax: [0.92, 0.05, 0.5], label: "緑主" },
  { base: [0.05, 0.18, 0.95], offsetMax: [0.85, 0.5, 0.05], label: "青主" },
  { base: [0.92, 0.85, 0.1], offsetMax: [0.05, 0.1, 0.92], label: "黄主" },
]

function chipCurrent(spec: ChipSpec, u: number): RGB {
  return [
    spec.base[0] + spec.offsetMax[0] * u,
    spec.base[1] + spec.offsetMax[1] * u,
    spec.base[2] + spec.offsetMax[2] * u,
  ]
}

const FLIP_COL_W = 240
const FLIP_COL_GAP = 80
const FLIP_COLS = 4
const FLIP_GRID_W = FLIP_COL_W * FLIP_COLS + FLIP_COL_GAP * (FLIP_COLS - 1)
const FLIP_GRID_X0 = (W - FLIP_GRID_W) / 2

const FLIP_LABEL_Y = 112
const FLIP_SWATCH_Y = 126
const FLIP_SWATCH_SIZE = 150
const FLIP_INSET_SIZE = 42
const FLIP_INSET_LABEL_OFFSET = 6
const FLIP_BAR_Y0 = 300
const FLIP_BAR_W = 176
const FLIP_BAR_H = 20
const FLIP_BAR_GAP = 8
const FLIP_RANK_BASE_Y = 400
const FLIP_RANK_NOW_Y = 424
const FLIP_BADGE_Y = 456
const VALUE_Y = 474

function FlipColumn({
  col,
  spec,
  u,
}: {
  col: number
  spec: ChipSpec
  u: number
}) {
  const colX = FLIP_GRID_X0 + col * (FLIP_COL_W + FLIP_COL_GAP)
  const cur = chipCurrent(spec, u)
  const baseRank = rankLabel(spec.base)
  const curRank = rankLabel(cur)
  const flipped = rankSignature(spec.base) !== rankSignature(cur)
  const swatchX = (FLIP_COL_W - FLIP_SWATCH_SIZE) / 2
  const insetX = swatchX + FLIP_SWATCH_SIZE - FLIP_INSET_SIZE - 8
  const insetY = FLIP_SWATCH_Y + FLIP_SWATCH_SIZE - FLIP_INSET_SIZE - 8
  return (
    <g transform={`translate(${colX}, 0)`}>
      {/* Chip ラベル */}
      <text
        x={FLIP_COL_W / 2}
        y={FLIP_LABEL_Y}
        textAnchor="middle"
        fontSize={16}
        fontWeight={600}
        fill={TEXT_MUTED}
      >
        {spec.label}
      </text>
      {/* 現在 swatch (大) */}
      <rect
        x={swatchX}
        y={FLIP_SWATCH_Y}
        width={FLIP_SWATCH_SIZE}
        height={FLIP_SWATCH_SIZE}
        rx={14}
        ry={14}
        fill={rgbCss(cur)}
        stroke="rgba(28,15,110,0.18)"
        strokeWidth={1.4}
      />
      {/* 起点 inset (右下、白縁付き) */}
      <text
        x={insetX + FLIP_INSET_SIZE / 2}
        y={insetY - FLIP_INSET_LABEL_OFFSET}
        textAnchor="middle"
        fontSize={11}
        fill="rgba(255,255,255,0.95)"
        fontWeight={700}
      >
        起点
      </text>
      <rect
        x={insetX}
        y={insetY}
        width={FLIP_INSET_SIZE}
        height={FLIP_INSET_SIZE}
        rx={8}
        ry={8}
        fill={rgbCss(spec.base)}
        stroke="rgba(255,255,255,0.95)"
        strokeWidth={2}
      />
      {/* RGB bars */}
      {(["R", "G", "B"] as const).map((ch, i) => {
        const v = cur[i]
        const baseV = spec.base[i]
        const barX = (FLIP_COL_W - FLIP_BAR_W) / 2
        const barY = FLIP_BAR_Y0 + i * (FLIP_BAR_H + FLIP_BAR_GAP)
        const isClipped = v >= 0.999
        return (
          <g key={ch}>
            <text
              x={barX - 10}
              y={barY + FLIP_BAR_H - 7}
              textAnchor="end"
              fontSize={14}
              fontWeight={700}
              fill={CHAN_COLORS[ch]}
              fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
            >
              {ch}
            </text>
            <rect
              x={barX}
              y={barY}
              width={FLIP_BAR_W}
              height={FLIP_BAR_H}
              rx={4}
              ry={4}
              fill="rgba(255,255,255,0.7)"
              stroke="rgba(28,15,110,0.16)"
              strokeWidth={1}
            />
            {/* 起点値 (薄め) */}
            <rect
              x={barX}
              y={barY}
              width={FLIP_BAR_W * clamp01(baseV)}
              height={FLIP_BAR_H}
              rx={4}
              ry={4}
              fill={CHAN_COLORS[ch]}
              fillOpacity={0.22}
            />
            {/* 現在値 */}
            <rect
              x={barX}
              y={barY}
              width={FLIP_BAR_W * clamp01(v)}
              height={FLIP_BAR_H}
              rx={4}
              ry={4}
              fill={CHAN_COLORS[ch]}
              fillOpacity={0.85}
            />
            {/* clip マーカー */}
            {isClipped ? (
              <line
                x1={barX + FLIP_BAR_W}
                y1={barY - 3}
                x2={barX + FLIP_BAR_W}
                y2={barY + FLIP_BAR_H + 3}
                stroke="rgb(180,60,80)"
                strokeWidth={2}
              />
            ) : null}
            <text
              x={barX + FLIP_BAR_W + 10}
              y={barY + FLIP_BAR_H - 7}
              fontSize={13}
              fill={TEXT_MUTED}
              fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
            >
              {v.toFixed(2)}
            </text>
          </g>
        )
      })}
      {/* 順位ラベル (起点) */}
      <text
        x={FLIP_COL_W / 2}
        y={FLIP_RANK_BASE_Y}
        textAnchor="middle"
        fontSize={14}
        fill={TEXT_MUTED}
        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
      >
        起点  {baseRank}
      </text>
      {/* 順位ラベル (現在) */}
      <text
        x={FLIP_COL_W / 2}
        y={FLIP_RANK_NOW_Y}
        textAnchor="middle"
        fontSize={16}
        fontWeight={700}
        fill={flipped ? "rgb(180,60,80)" : TEXT_PRIMARY}
        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
      >
        現在  {curRank}
      </text>
      {/* ひっくり返りバッジ */}
      {flipped ? (
        <g transform={`translate(${FLIP_COL_W / 2}, ${FLIP_BADGE_Y})`}>
          <rect
            x={-58}
            y={-18}
            width={116}
            height={30}
            rx={15}
            ry={15}
            fill="rgba(180,60,80,0.18)"
            stroke="rgba(180,60,80,0.65)"
            strokeWidth={1.2}
          />
          <text
            x={0}
            y={4}
            textAnchor="middle"
            fontSize={14}
            fontWeight={700}
            fill="rgb(180,60,80)"
          >
            ひっくり返り
          </text>
        </g>
      ) : null}
    </g>
  )
}

function FlipCell({
  t,
  reducedMotion,
}: {
  t: number
  reducedMotion: boolean
}) {
  const u = reducedMotion ? 0.65 : umphase(t)
  return (
    <g>
      <rect
        x={18}
        y={18}
        width={W - 36}
        height={H - 36}
        rx={24}
        ry={24}
        fill={TINT_FLIP.bg}
        stroke={TINT_FLIP.border}
        strokeOpacity={0.55}
        strokeWidth={1.4}
      />
      <rect
        x={18}
        y={18}
        width={W - 36}
        height={H - 36}
        rx={24}
        ry={24}
        fill="rgba(255,255,255,0.55)"
      />
      <text
        x={FLIP_HEADER_X}
        y={FLIP_HEADER_Y}
        fontSize={32}
        fontWeight={700}
        fill={TINT_FLIP.curve}
      >
        色のひっくり返り
      </text>
      <text
        x={FLIP_HEADER_X}
        y={FLIP_HEADER_Y + 32}
        fontSize={17}
        fontWeight={500}
        fill={TEXT_MUTED}
      >
        加算が偏ると、ある閾値で RGB 順位が反転して hue が跳ぶ
      </text>
      {CHIPS.map((spec, col) => (
        <FlipColumn key={col} col={col} spec={spec} u={u} />
      ))}
      <text
        x={W - FLIP_HEADER_X}
        y={VALUE_Y}
        textAnchor="end"
        fill={TEXT_PRIMARY}
        fontSize={22}
        fontWeight={600}
        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
      >
        加算強度 u = {u.toFixed(2)}
      </text>
    </g>
  )
}

export default function CorrectionFailureModes({
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

  const t = animT

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="absolute inset-0 h-full w-full"
      preserveAspectRatio="xMidYMid meet"
    >
      <FlipCell t={t} reducedMotion={reducedMotion} />
    </svg>
  )
}
