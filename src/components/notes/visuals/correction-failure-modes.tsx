"use client"

import { useEffect, useRef, useState } from "react"

/**
 * v5 動画モジュール: 破綻の代表型 — 色のひっくり返り
 *
 * viewBox 1600×900 (16:9)。AY で「暗部の濁り」セルを削除し、
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

type FlipLayout = {
  w: number
  h: number
  rectInset: number
  headerX: number
  headerY: number
  titleFont: number
  descriptionX: number
  descriptionFont: number
  strengthFont: number
  colW: number
  colGap: number
  labelY: number
  labelFont: number
  swatchY: number
  swatchSize: number
  insetSize: number
  insetLabelOffset: number
  insetLabelFont: number
  barY0: number
  barW: number
  barH: number
  barGap: number
  channelFont: number
  valueFont: number
  rankBaseY: number
  rankNowY: number
  rankBaseFont: number
  rankNowFont: number
  badgeY: number
  badgeW: number
  badgeH: number
  badgeFont: number
}

const FLIP_COLS = 4

const DESKTOP_LAYOUT: FlipLayout = {
  w: 1600,
  h: 900,
  rectInset: 12,
  headerX: 56,
  headerY: 78,
  titleFont: 38,
  descriptionX: 392,
  descriptionFont: 19,
  strengthFont: 24,
  colW: 330,
  colGap: 48,
  labelY: 158,
  labelFont: 20,
  swatchY: 180,
  swatchSize: 210,
  insetSize: 56,
  insetLabelOffset: 8,
  insetLabelFont: 14,
  barY0: 520,
  barW: 250,
  barH: 26,
  barGap: 12,
  channelFont: 17,
  valueFont: 15,
  rankBaseY: 720,
  rankNowY: 756,
  rankBaseFont: 17,
  rankNowFont: 20,
  badgeY: 824,
  badgeW: 144,
  badgeH: 38,
  badgeFont: 17,
}

const MOBILE_LAYOUT: FlipLayout = {
  w: 1000,
  h: 900,
  rectInset: 10,
  headerX: 28,
  headerY: 76,
  titleFont: 34,
  descriptionX: 300,
  descriptionFont: 18,
  strengthFont: 20,
  colW: 235,
  colGap: 15,
  labelY: 150,
  labelFont: 20,
  swatchY: 176,
  swatchSize: 160,
  insetSize: 42,
  insetLabelOffset: 7,
  insetLabelFont: 13,
  barY0: 482,
  barW: 180,
  barH: 22,
  barGap: 10,
  channelFont: 17,
  valueFont: 15,
  rankBaseY: 666,
  rankNowY: 698,
  rankBaseFont: 17,
  rankNowFont: 20,
  badgeY: 765,
  badgeW: 128,
  badgeH: 34,
  badgeFont: 16,
}

function gridX0(layout: FlipLayout) {
  return (
    (layout.w -
      (layout.colW * FLIP_COLS + layout.colGap * (FLIP_COLS - 1))) /
    2
  )
}

function FlipColumn({
  layout,
  col,
  spec,
  u,
}: {
  layout: FlipLayout
  col: number
  spec: ChipSpec
  u: number
}) {
  const colX = gridX0(layout) + col * (layout.colW + layout.colGap)
  const cur = chipCurrent(spec, u)
  const baseRank = rankLabel(spec.base)
  const curRank = rankLabel(cur)
  const flipped = rankSignature(spec.base) !== rankSignature(cur)
  const swatchX = (layout.colW - layout.swatchSize) / 2
  const insetX = swatchX + layout.swatchSize - layout.insetSize - 8
  const insetY = layout.swatchY + layout.swatchSize - layout.insetSize - 8
  return (
    <g transform={`translate(${colX}, 0)`}>
      {/* Chip ラベル */}
      <text
        x={layout.colW / 2}
        y={layout.labelY}
        textAnchor="middle"
        fontSize={layout.labelFont}
        fontWeight={600}
        fill={TEXT_MUTED}
      >
        {spec.label}
      </text>
      {/* 現在 swatch (大) */}
      <rect
        x={swatchX}
        y={layout.swatchY}
        width={layout.swatchSize}
        height={layout.swatchSize}
        rx={14}
        ry={14}
        fill={rgbCss(cur)}
        stroke="rgba(28,15,110,0.18)"
        strokeWidth={1.6}
      />
      {/* 起点 inset (右下、白縁付き) */}
      <text
        x={insetX + layout.insetSize / 2}
        y={insetY - layout.insetLabelOffset}
        textAnchor="middle"
        fontSize={layout.insetLabelFont}
        fill="rgba(255,255,255,0.95)"
        fontWeight={700}
      >
        起点
      </text>
      <rect
        x={insetX}
        y={insetY}
        width={layout.insetSize}
        height={layout.insetSize}
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
        const barX = (layout.colW - layout.barW) / 2
        const barY = layout.barY0 + i * (layout.barH + layout.barGap)
        const isClipped = v >= 0.999
        return (
          <g key={ch}>
            <text
              x={barX - 10}
              y={barY + layout.barH - 7}
              textAnchor="end"
              fontSize={layout.channelFont}
              fontWeight={700}
              fill={CHAN_COLORS[ch]}
              fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
            >
              {ch}
            </text>
            <rect
              x={barX}
              y={barY}
              width={layout.barW}
              height={layout.barH}
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
              width={layout.barW * clamp01(baseV)}
              height={layout.barH}
              rx={4}
              ry={4}
              fill={CHAN_COLORS[ch]}
              fillOpacity={0.22}
            />
            {/* 現在値 */}
            <rect
              x={barX}
              y={barY}
              width={layout.barW * clamp01(v)}
              height={layout.barH}
              rx={4}
              ry={4}
              fill={CHAN_COLORS[ch]}
              fillOpacity={0.85}
            />
            {/* clip マーカー */}
            {isClipped ? (
              <line
                x1={barX + layout.barW}
                y1={barY - 3}
                x2={barX + layout.barW}
                y2={barY + layout.barH + 3}
                stroke="rgb(180,60,80)"
                strokeWidth={2}
              />
            ) : null}
            <text
              x={barX + layout.barW + 10}
              y={barY + layout.barH - 7}
              fontSize={layout.valueFont}
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
        x={layout.colW / 2}
        y={layout.rankBaseY}
        textAnchor="middle"
        fontSize={layout.rankBaseFont}
        fill={TEXT_MUTED}
        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
      >
        起点  {baseRank}
      </text>
      {/* 順位ラベル (現在) */}
      <text
        x={layout.colW / 2}
        y={layout.rankNowY}
        textAnchor="middle"
        fontSize={layout.rankNowFont}
        fontWeight={700}
        fill={flipped ? "rgb(180,60,80)" : TEXT_PRIMARY}
        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
      >
        現在  {curRank}
      </text>
      {/* ひっくり返りバッジ */}
      {flipped ? (
        <g transform={`translate(${layout.colW / 2}, ${layout.badgeY})`}>
          <rect
            x={-layout.badgeW / 2}
            y={-layout.badgeH / 2 - 3}
            width={layout.badgeW}
            height={layout.badgeH}
            rx={layout.badgeH / 2}
            ry={layout.badgeH / 2}
            fill="rgba(180,60,80,0.18)"
            stroke="rgba(180,60,80,0.65)"
            strokeWidth={1.4}
          />
          <text
            x={0}
            y={5}
            textAnchor="middle"
            fontSize={layout.badgeFont}
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
  layout,
  t,
  reducedMotion,
  isMobile,
}: {
  layout: FlipLayout
  t: number
  reducedMotion: boolean
  isMobile: boolean
}) {
  const u = reducedMotion ? 0.65 : umphase(t)
  const descriptionLineGap = layout.descriptionFont * 1.28
  return (
    <g>
      <rect
        x={layout.rectInset}
        y={layout.rectInset}
        width={layout.w - layout.rectInset * 2}
        height={layout.h - layout.rectInset * 2}
        rx={24}
        ry={24}
        fill={TINT_FLIP.bg}
        stroke={TINT_FLIP.border}
        strokeOpacity={0.55}
        strokeWidth={1.4}
      />
      <rect
        x={layout.rectInset}
        y={layout.rectInset}
        width={layout.w - layout.rectInset * 2}
        height={layout.h - layout.rectInset * 2}
        rx={24}
        ry={24}
        fill="rgba(255,255,255,0.55)"
      />
      <text
        x={layout.headerX}
        y={layout.headerY}
        fontSize={layout.titleFont}
        fontWeight={700}
        fill={TINT_FLIP.curve}
      >
        色のひっくり返り
      </text>
      {isMobile ? (
        <text
          x={layout.descriptionX}
          y={layout.headerY}
          fontSize={layout.descriptionFont}
          fontWeight={500}
          fill={TEXT_MUTED}
        >
          <tspan x={layout.descriptionX} y={layout.headerY}>
            加算が偏ると、ある閾値で
          </tspan>
          <tspan x={layout.descriptionX} dy={descriptionLineGap}>
            RGB 順位が反転して hue が跳ぶ
          </tspan>
        </text>
      ) : (
        <text
          x={layout.descriptionX}
          y={layout.headerY}
          fontSize={layout.descriptionFont}
          fontWeight={500}
          fill={TEXT_MUTED}
        >
          加算が偏ると、ある閾値で RGB 順位が反転して hue が跳ぶ
        </text>
      )}
      <text
        x={layout.w - layout.headerX}
        y={layout.headerY}
        textAnchor="end"
        fill={TEXT_PRIMARY}
        fontSize={layout.strengthFont}
        fontWeight={600}
        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
      >
        加算強度 u = {u.toFixed(2)}
      </text>
      {CHIPS.map((spec, col) => (
        <FlipColumn key={col} layout={layout} col={col} spec={spec} u={u} />
      ))}
    </g>
  )
}

export default function CorrectionFailureModes({
  isPlaying,
  isMobile,
  reducedMotion,
}: {
  isPlaying: boolean
  isMobile?: boolean
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
  const layout = isMobile ? MOBILE_LAYOUT : DESKTOP_LAYOUT

  return (
    <svg
      viewBox={`0 0 ${layout.w} ${layout.h}`}
      className="absolute inset-0 h-full w-full"
      preserveAspectRatio="xMidYMid meet"
    >
      <FlipCell
        layout={layout}
        t={t}
        reducedMotion={reducedMotion}
        isMobile={Boolean(isMobile)}
      />
    </svg>
  )
}
