"use client"

import { useEffect, useRef, useState } from "react"

/**
 * v5 動画モジュール: 破綻の代表型 — 色のひっくり返り
 *
 * viewBox 1600×900 (16:9)、モバイル 1000×900。LOOP = 8s。
 *
 * 本文（カラーコレクションの因数分解「破綻を管理する」）の説明に合わせる:
 *   彩度の高い色は、RGB のうち 1 つか 2 つの値が 0 に近いところにある。
 *   LED の照明のように作業色域の外にある色では、すでに 0 を下回っている。
 *   ここにオフセットなどの加算を重ねると、3 チャンネルが同じ量だけ動くので、
 *   小さいチャンネルが先に 0 をまたぐ。色相は RGB の比率で決まるため、
 *   比率が崩れて別の色に飛ぶ。
 *
 * 表現:
 *   - 3 チャンネルすべてに同じ量のオフセット（0 → −OFFSET_MAX → 0、OFFSET_MAX = 0.45）を加える。
 *   - RGB バーは 0 の位置に基準線を持ち、マイナス側にも伸びる。
 *     薄いバーが起点値、濃いバーが現在値で、3 本とも同じ長さだけずれる。
 *   - 大きい swatch は「比率で決まる色」。各値を合計で割った比率
 *     (R:G:B の取り分) を、最大の取り分が 1 になるよう正規化して描く。
 *     合計が 0 をまたぐと比率の符号がそろって反転し、補色側へ飛ぶ。
 *   - 小さいチャンネルが 0 をまたいだ時点で「0 をまたいだ」、比率が崩れて
 *     色が飛んだ時点で「ひっくり返り」のバッジを出す。
 *   - 4 列目の肌色は比較用。彩度が低く、同じ量を動かしても飛ばない。
 *
 * SSR 設計: render は t=0 / isPlaying=false の純関数。
 * IntersectionObserver / matchMedia / requestAnimationFrame は useEffect 内のみ。
 * reducedMotion 時は u を 0.85 で固定して静止画化（反転後の状態を見せる）。
 *
 * 配色: 既存マーカー群と AW (space-choice) で使用済みの TINT を全て除外。
 * 破綻テーマなので muted ・ warning 寄り (faded crimson 系)。
 */

const LOOP = 8.0
const OFFSET_MAX = 0.45
const REDUCED_MOTION_U = 0.85

// バーの値域。マイナス側も見せる。
const BAR_MIN = -0.6
const BAR_MAX = 1.0

const TEXT_PRIMARY = "rgba(28,15,110,0.95)"
const TEXT_MUTED = "rgba(28,15,110,0.55)"
const ALERT = "rgb(180,60,80)"

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

const SUM_EPSILON = 1e-3

/** 各値を合計で割った取り分（比率）。合計が 0 付近では符号だけ保って小さい値で割る。 */
export function ratioShares(rgb: RGB): RGB {
  const raw = rgb[0] + rgb[1] + rgb[2]
  const sum =
    Math.abs(raw) < SUM_EPSILON ? (raw < 0 ? -SUM_EPSILON : SUM_EPSILON) : raw
  return [rgb[0] / sum, rgb[1] / sum, rgb[2] / sum]
}

/** 比率で決まる色。最大の取り分を 1 に正規化し、0〜1 に収めて描く。 */
export function ratioColor(rgb: RGB): RGB {
  const shares = ratioShares(rgb)
  const peak = Math.max(shares[0], shares[1], shares[2])
  if (peak <= 0) return [0, 0, 0]
  return [
    clamp01(shares[0] / peak),
    clamp01(shares[1] / peak),
    clamp01(shares[2] / peak),
  ]
}

/** 比率が崩れて別の色に飛んだか（合計の符号が起点と逆になったか）。 */
export function isFlipped(base: RGB, cur: RGB) {
  const baseSum = base[0] + base[1] + base[2]
  const curSum = cur[0] + cur[1] + cur[2]
  return Math.sign(baseSum) !== Math.sign(curSum) && Math.abs(curSum) >= SUM_EPSILON
}

/** 起点から符号が変わった（0 をまたいだ）チャンネル。 */
export function crossedChannels(base: RGB, cur: RGB): Array<"R" | "G" | "B"> {
  const names = ["R", "G", "B"] as const
  return names.filter((_, i) => (base[i] < 0) !== (cur[i] < 0))
}

function formatShare(v: number) {
  if (v > 9.99) return "+大"
  if (v < -9.99) return "−大"
  const s = Math.abs(v).toFixed(2)
  return v < 0 ? `−${s}` : s
}

function formatSigned(v: number) {
  const s = Math.abs(v).toFixed(2)
  return v < -0.004 ? `−${s}` : s
}

function shareLabel(rgb: RGB) {
  const shares = ratioShares(rgb)
  return shares.map(formatShare).join(" : ")
}

type ChipSpec = {
  base: RGB
  label: string
}

const CHIPS: ChipSpec[] = [
  { base: [0.95, 0.08, 0.04], label: "高彩度の赤" },
  { base: [0.06, 0.9, 0.05], label: "高彩度の緑" },
  { base: [-0.15, 0.1, 0.95], label: "青い LED（色域外）" },
  { base: [0.85, 0.62, 0.48], label: "肌（比較）" },
]

export function chipCurrent(spec: ChipSpec, u: number): RGB {
  // 3 チャンネルすべてに同じ量を加える（ここでは下げる方向）
  const offset = -OFFSET_MAX * u
  return [spec.base[0] + offset, spec.base[1] + offset, spec.base[2] + offset]
}

export const FAILURE_MODES_CHIPS = CHIPS
export const FAILURE_MODES_OFFSET_MAX = OFFSET_MAX

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
  strengthFont: 22,
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
  rankBaseFont: 16,
  rankNowFont: 18,
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
  descriptionX: 28,
  descriptionFont: 17,
  strengthFont: 19,
  colW: 235,
  colGap: 15,
  labelY: 150,
  labelFont: 17,
  swatchY: 176,
  swatchSize: 160,
  insetSize: 42,
  insetLabelOffset: 7,
  insetLabelFont: 13,
  barY0: 482,
  barW: 150,
  barH: 22,
  barGap: 10,
  channelFont: 17,
  valueFont: 13,
  rankBaseY: 666,
  rankNowY: 698,
  rankBaseFont: 14,
  rankNowFont: 15,
  badgeY: 765,
  badgeW: 128,
  badgeH: 34,
  badgeFont: 15,
}

function gridX0(layout: FlipLayout) {
  return (
    (layout.w -
      (layout.colW * FLIP_COLS + layout.colGap * (FLIP_COLS - 1))) /
    2
  )
}

function barXOf(layout: FlipLayout, v: number) {
  const clamped = v < BAR_MIN ? BAR_MIN : v > BAR_MAX ? BAR_MAX : v
  return ((clamped - BAR_MIN) / (BAR_MAX - BAR_MIN)) * layout.barW
}

function Badge({
  layout,
  y,
  label,
}: {
  layout: FlipLayout
  y: number
  label: string
}) {
  return (
    <g transform={`translate(${layout.colW / 2}, ${y})`}>
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
        fill={ALERT}
      >
        {label}
      </text>
    </g>
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
  const flipped = isFlipped(spec.base, cur)
  const crossed = crossedChannels(spec.base, cur)
  const swatchX = (layout.colW - layout.swatchSize) / 2
  const insetX = swatchX + layout.swatchSize - layout.insetSize - 8
  const insetY = layout.swatchY + layout.swatchSize - layout.insetSize - 8
  const barX = (layout.colW - layout.barW) / 2
  const zeroX = barX + barXOf(layout, 0)
  const barsTop = layout.barY0 - 6
  const barsBottom = layout.barY0 + 3 * layout.barH + 2 * layout.barGap + 6
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
      {/* 比率で決まる色 (大) */}
      <rect
        x={swatchX}
        y={layout.swatchY}
        width={layout.swatchSize}
        height={layout.swatchSize}
        rx={14}
        ry={14}
        fill={rgbCss(ratioColor(cur))}
        stroke={flipped ? "rgba(180,60,80,0.75)" : "rgba(28,15,110,0.18)"}
        strokeWidth={flipped ? 3 : 1.6}
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
        fill={rgbCss(ratioColor(spec.base))}
        stroke="rgba(255,255,255,0.95)"
        strokeWidth={2}
      />
      {/* RGB bars (0 の基準線つき、マイナス側にも伸びる) */}
      {(["R", "G", "B"] as const).map((ch, i) => {
        const v = cur[i]
        const baseV = spec.base[i]
        const barY = layout.barY0 + i * (layout.barH + layout.barGap)
        const curX = barX + barXOf(layout, v)
        const baseXPos = barX + barXOf(layout, baseV)
        const isNegative = v < 0
        const didCross = crossed.includes(ch)
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
              x={Math.min(zeroX, baseXPos)}
              y={barY}
              width={Math.abs(baseXPos - zeroX)}
              height={layout.barH}
              fill={CHAN_COLORS[ch]}
              fillOpacity={0.22}
            />
            {/* 現在値 */}
            <rect
              x={Math.min(zeroX, curX)}
              y={barY}
              width={Math.abs(curX - zeroX)}
              height={layout.barH}
              fill={CHAN_COLORS[ch]}
              fillOpacity={isNegative ? 0.55 : 0.85}
            />
            <text
              x={barX + layout.barW + 10}
              y={barY + layout.barH - 7}
              fontSize={layout.valueFont}
              fontWeight={didCross ? 700 : 400}
              fill={didCross ? ALERT : TEXT_MUTED}
              fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
            >
              {formatSigned(v)}
            </text>
          </g>
        )
      })}
      {/* 0 の基準線 */}
      <line
        x1={zeroX}
        y1={barsTop}
        x2={zeroX}
        y2={barsBottom}
        stroke="rgba(28,15,110,0.55)"
        strokeWidth={1.6}
      />
      <text
        x={zeroX}
        y={barsTop - 6}
        textAnchor="middle"
        fontSize={layout.valueFont}
        fill={TEXT_MUTED}
        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
      >
        0
      </text>
      {/* 比率の見出し */}
      <text
        x={layout.colW / 2}
        y={layout.rankBaseY - layout.rankNowFont * 1.9}
        textAnchor="middle"
        fontSize={layout.rankBaseFont}
        fill={TEXT_MUTED}
      >
        比率（合計に対する R : G : B）
      </text>
      {/* 比率 (起点) */}
      <text
        x={layout.colW / 2}
        y={layout.rankBaseY}
        textAnchor="middle"
        fontSize={layout.rankBaseFont}
        fill={TEXT_MUTED}
        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
      >
        起点 {shareLabel(spec.base)}
      </text>
      {/* 比率 (現在) */}
      <text
        x={layout.colW / 2}
        y={layout.rankNowY}
        textAnchor="middle"
        fontSize={layout.rankNowFont}
        fontWeight={700}
        fill={flipped ? ALERT : TEXT_PRIMARY}
        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
      >
        現在 {shareLabel(cur)}
      </text>
      {/* バッジ: 0 をまたいだ → ひっくり返り */}
      {flipped ? (
        <Badge layout={layout} y={layout.badgeY} label="ひっくり返り" />
      ) : crossed.length > 0 ? (
        <Badge layout={layout} y={layout.badgeY} label="0 をまたいだ" />
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
  const u = reducedMotion ? REDUCED_MOTION_U : umphase(t)
  const descriptionY = isMobile
    ? layout.headerY + layout.descriptionFont * 2.1
    : layout.headerY
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
          y={descriptionY}
          fontSize={layout.descriptionFont}
          fontWeight={500}
          fill={TEXT_MUTED}
        >
          3ch に同じ量を加えると、小さい値が先に 0 をまたぎ、比率が崩れて色が飛ぶ
        </text>
      ) : (
        <text
          x={layout.descriptionX}
          y={layout.headerY}
          fontSize={layout.descriptionFont}
          fontWeight={500}
          fill={TEXT_MUTED}
        >
          3ch に同じ量を加えると、小さい値が先に 0 をまたぎ、比率が崩れて色が飛ぶ
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
        オフセット {formatSigned(-OFFSET_MAX * u)}
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
