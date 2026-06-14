"use client"

import { useEffect, useRef, useState } from "react"

/**
 * Phase 32-AQ: 戻せる / 戻せない（可逆性の比較）
 *
 * Phase 32-AQ 主要変更:
 *  - safePow を signedPow へ置換 (b<0 で -(|b|^e) を返し負域を保持、Resolve 32bit float 互換)
 *  - Y 軸を [-0.4, 1.0] へ拡張、y=0 補助線と y=0 ラベルを追加
 *  - 右セル forward / backward 中央 op に強い負リフトを入れ、中盤で y < 0 まで潜らせる
 *  - 左セル完全可逆性は維持
 *
 * 時間軸（合計 14 秒）:
 *   HOLD_START  2.5s : P = 0,        Q = 0,        y = x
 *   FORWARD     4.0s : P が 0 → 1,    Q = 0,        forward 進行（処理追加中）
 *   BACKWARD    4.0s : P = 1,        Q が 0 → 1,   backward 進行（後段で復元中）
 *   HOLD_END    3.5s : P = 1,        Q = 1,        理想線重ね（復元結果）
 *
 * 各 op i に進度区間 [lo_i, hi_i] を割り当て、隣接 op と区間を overlap させる
 * （5 op で [0.00, 0.32], [0.18, 0.50], [0.36, 0.68], [0.54, 0.86], [0.72, 1.00]）。
 *
 * reducedMotion=true のときは HOLD_END 状態（P=1, Q=1, 理想線 1.0）で静止。
 */

const LOOP = 14
const HOLD_START = 2.5
const FORWARD_DUR = 4.0
const BACKWARD_DUR = 4.0
const HOLD_END = 3.5
const FADE_DUR = 0.2
const IDEAL_FADE_IN = 0.6
const IDEAL_FADE_OUT = 0.2

const NUM_OPS = 5
const SAMPLES = 96
const OSC_AMP_RIGHT = 0.06

const W = 1600
const H = 500
const CELL_W = 760
const GAP = 80

const TITLE_Y = 28
const PLOT_X_LOCAL = 50
const PLOT_Y = 56
const PLOT_W = CELL_W - 100 // 660
const PLOT_H = 330 // 56..386
const BADGE_CY = 416
const FORMULA_CY = 462

const Y_MAX = 1.0
const Y_MIN = 0
const Y_RANGE = Y_MAX - Y_MIN

const TEXT_PRIMARY = "rgba(28,15,110,0.95)"
const TEXT_MUTED = "rgba(107,95,168,0.85)"
const GRID = "rgba(139,127,255,0.18)"
const Y_ONE_LINE = "rgba(139,127,255,0.32)"

const TINT_GAMMA = {
  title: "rgb(45,135,120)",
  border: "rgba(108,180,170,0.85)",
  bg: "rgba(108,180,170,0.10)",
}
const TINT_LIFT = {
  title: "rgb(55,108,180)",
  border: "rgba(120,165,225,0.85)",
  bg: "rgba(120,165,225,0.10)",
}

const RGB_R = "rgba(220, 60, 60, 0.88)"
const RGB_G = "rgba(60, 180, 80, 0.88)"
const RGB_B = "rgba(60, 110, 220, 0.88)"

type Op = { kind: "add" | "pow" | "mul"; param: number }
type Offsets = { lo: number; hi: number }[]

const BASE_OFFSETS: Offsets = [
  { lo: 0.0, hi: 0.32 },
  { lo: 0.18, hi: 0.5 },
  { lo: 0.36, hi: 0.68 },
  { lo: 0.54, hi: 0.86 },
  { lo: 0.72, hi: 1.0 },
]

function shiftOffsets(shift: number): Offsets {
  return BASE_OFFSETS.map(({ lo, hi }) => ({ lo: lo + shift, hi: hi + shift }))
}

const OFFSETS_LEFT_R: Offsets = shiftOffsets(0)
const OFFSETS_LEFT_G: Offsets = shiftOffsets(0.12)
const OFFSETS_LEFT_B: Offsets = shiftOffsets(-0.12)

// Phase 32-AQ: 各 chan の idx 2 op (中央リフト負) が P=0.5 付近でしっかり発火するよう
// 全 shift を負側に再配置（base 中央 0.52 を P=0.5 直近に寄せる）。
const OFFSETS_RIGHT_R: Offsets = shiftOffsets(0)
const OFFSETS_RIGHT_G: Offsets = shiftOffsets(-0.06)
const OFFSETS_RIGHT_B: Offsets = shiftOffsets(-0.12)

// 左セル（ゲイン × ガンマ）: RGB ごとに param をずらして中盤で識別性を出す。
// 各 chan は自分自身の数学的逆を backward 区間で適用するので完全可逆。
// Phase 32-AP: param 振幅を拡大して FORWARD 中盤の「ぐじゃぐじゃ」を強化。
const LEFT_OPS_R: Op[] = [
  { kind: "mul", param: 2.2 },
  { kind: "pow", param: 1.85 },
  { kind: "mul", param: 0.45 },
  { kind: "pow", param: 0.55 },
  { kind: "mul", param: 1.3 },
]
const LEFT_OPS_G: Op[] = [
  { kind: "mul", param: 2.0 },
  { kind: "pow", param: 1.7 },
  { kind: "mul", param: 0.5 },
  { kind: "pow", param: 0.62 },
  { kind: "mul", param: 1.2 },
]
const LEFT_OPS_B: Op[] = [
  { kind: "mul", param: 2.4 },
  { kind: "pow", param: 1.95 },
  { kind: "mul", param: 0.4 },
  { kind: "pow", param: 0.5 },
  { kind: "mul", param: 1.4 },
]

// 右セル（リフト × ガンマ）forward 用 ops。
// Phase 32-AQ: 中央 op (idx 2) に強い負リフトを入れ、中盤で y < 0 まで潜らせる。
//   add +正 → pow >1 → add -大 (中域で y を負域へ) → pow >1 (signedPow が負域保持)
//   → add +小 (plot 内へ押し戻し)
const RIGHT_FORWARD_R: Op[] = [
  { kind: "add", param: 0.25 },
  { kind: "pow", param: 1.5 },
  { kind: "add", param: -1.0 },
  { kind: "pow", param: 1.4 },
  { kind: "add", param: 0.1 },
]
const RIGHT_FORWARD_G: Op[] = [
  { kind: "add", param: 0.22 },
  { kind: "pow", param: 1.4 },
  { kind: "add", param: -0.85 },
  { kind: "pow", param: 1.3 },
  { kind: "add", param: 0.14 },
]
const RIGHT_FORWARD_B: Op[] = [
  { kind: "add", param: 0.18 },
  { kind: "pow", param: 1.55 },
  { kind: "add", param: -0.95 },
  { kind: "pow", param: 1.45 },
  { kind: "add", param: 0.18 },
]

// 右セル backward 用 ops（forward の逆ではない、後段追加適用）。
// Phase 32-AQ: BACKWARD 中盤で再度 y < 0 へ沈ませ、HOLD_END で plateau+lift。
//   add -big (一気に負域へ) → pow >1 (負域整形、signedPow) → add -mid (中央 lift down)
//   → pow <1 (持ち上げ)  → add +final (大きく plot 内へ復帰)
// 最終 add は (1-y) factor で y=1 不動点を維持しつつ、負域からの持ち上げに効く。
const RIGHT_BACKWARD_R: Op[] = [
  { kind: "add", param: -0.4 },
  { kind: "pow", param: 1.85 },
  { kind: "add", param: -0.1 },
  { kind: "pow", param: 0.55 },
  { kind: "add", param: 0.55 },
]
const RIGHT_BACKWARD_G: Op[] = [
  { kind: "add", param: -0.35 },
  { kind: "pow", param: 1.7 },
  { kind: "add", param: -0.1 },
  { kind: "pow", param: 0.6 },
  { kind: "add", param: 0.5 },
]
const RIGHT_BACKWARD_B: Op[] = [
  { kind: "add", param: -0.4 },
  { kind: "pow", param: 2.0 },
  { kind: "add", param: -0.1 },
  { kind: "pow", param: 0.5 },
  { kind: "add", param: 0.65 },
]

const FREQS = [0.7, 0.85, 1.0, 1.15, 1.3]
const PHASE_R = 0
const PHASE_G = (2 * Math.PI) / 3
const PHASE_B = (4 * Math.PI) / 3

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

// Phase 32-AQ: signedPow は b<0 でも -(|b|^e) を返し負域を保持する。
// DaVinci Resolve の 32bit float 内部計算に揃え、ノードを重ねた中域で y が
// 負域へ「潜って」から後段で復帰する非線形挙動を可視化できるようにする。
function signedPow(b: number, e: number): number {
  if (b === 0) return 0
  if (b > 0) return Math.pow(b, e)
  return -Math.pow(-b, e)
}

function easeInOutCubic(p: number): number {
  return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2
}

// リフト操作 (1, 1) 不動点固定: out = y + L * p * (1 - y)
//   y = 0 → L * p（黒側を持ち上げ）
//   y = 1 → 1（白側は常に固定）
function applyOpProgress(y: number, op: Op, p: number): number {
  if (op.kind === "add") return y + op.param * p * (1 - y)
  if (op.kind === "pow") return signedPow(y, 1 + (op.param - 1) * p)
  return y * (1 + (op.param - 1) * p)
}

// applyOpProgress の数学的逆関数。
//   add 逆: y = (out - L*p) / (1 - L*p)
function applyOpProgressInverse(y: number, op: Op, p: number): number {
  if (op.kind === "add") {
    const denom = 1 - op.param * p
    return denom === 0 ? y : (y - op.param * p) / denom
  }
  if (op.kind === "pow") return signedPow(y, 1 / (1 + (op.param - 1) * p))
  return y / (1 + (op.param - 1) * p)
}

type Phase = "hold-start" | "forward" | "backward" | "hold-end"

type AnimState = {
  phase: Phase
  P: number
  Q: number
  t: number
  tInPhase: number
  tEnd: number
}

function computeAnimState(t: number): AnimState {
  if (t < HOLD_START) {
    return { phase: "hold-start", P: 0, Q: 0, t, tInPhase: t, tEnd: 0 }
  }
  if (t < HOLD_START + FORWARD_DUR) {
    const tIn = t - HOLD_START
    return {
      phase: "forward",
      P: clamp01(tIn / FORWARD_DUR),
      Q: 0,
      t,
      tInPhase: tIn,
      tEnd: 0,
    }
  }
  if (t < HOLD_START + FORWARD_DUR + BACKWARD_DUR) {
    const tIn = t - HOLD_START - FORWARD_DUR
    return {
      phase: "backward",
      P: 1,
      Q: clamp01(tIn / BACKWARD_DUR),
      t,
      tInPhase: tIn,
      tEnd: 0,
    }
  }
  const tIn = t - HOLD_START - FORWARD_DUR - BACKWARD_DUR
  return { phase: "hold-end", P: 1, Q: 1, t, tInPhase: tIn, tEnd: tIn }
}

function envelopeAmp(P: number, Q: number): number {
  return Math.sin(clamp01(P) * Math.PI) * Math.sin(clamp01(Q) * Math.PI)
}

/**
 * 左セル用: forward は applyOpProgress、backward は applyOpProgressInverse
 * （同じ ops の数学的逆関数を逆順で適用）。
 * HOLD_END (Q = 1) で常に y = x へ完全復帰。
 */
function buildLeftFn(
  ops: Op[],
  offsets: Offsets,
  P: number,
  Q: number,
): (x: number) => number {
  return (x: number) => {
    let y = x
    for (let i = 0; i < ops.length; i++) {
      const { lo, hi } = offsets[i]
      const p = P <= 0 ? 0 : easeInOutCubic(clamp01((P - lo) / (hi - lo)))
      y = applyOpProgress(y, ops[i], p)
    }
    for (let i = ops.length - 1; i >= 0; i--) {
      const { lo, hi } = offsets[i]
      const p = Q <= 0 ? 0 : easeInOutCubic(clamp01((Q - lo) / (hi - lo)))
      y = applyOpProgressInverse(y, ops[i], p)
    }
    return y
  }
}

/**
 * 右セル用: forward は opsForward を applyOpProgress、backward は opsBackward を
 * applyOpProgress で 0..M-1 順に追加適用（数学的逆ではない）。
 * 入れ子非可換性で HOLD_END (Q = 1) でも y = x には戻らず残差が残る。
 * 中間オシレーションは envelope = sin(Pπ) sin(Qπ) で両端 0、中央 max。
 */
function buildRightFn(
  opsForward: Op[],
  opsBackward: Op[],
  offsetsForward: Offsets,
  offsetsBackward: Offsets,
  P: number,
  Q: number,
  freqs: number[],
  phaseRgb: number,
  oscAmp: number,
  t: number,
): (x: number) => number {
  const env = oscAmp > 0 ? envelopeAmp(P, Q) : 0
  return (x: number) => {
    let y = x
    for (let i = 0; i < opsForward.length; i++) {
      const { lo, hi } = offsetsForward[i]
      let p = P <= 0 ? 0 : easeInOutCubic(clamp01((P - lo) / (hi - lo)))
      if (oscAmp > 0 && p > 0) {
        p = clamp01(
          p + oscAmp * env * Math.sin(t * 2 * Math.PI * freqs[i] + phaseRgb),
        )
      }
      y = applyOpProgress(y, opsForward[i], p)
    }
    for (let i = 0; i < opsBackward.length; i++) {
      const { lo, hi } = offsetsBackward[i]
      let p = Q <= 0 ? 0 : easeInOutCubic(clamp01((Q - lo) / (hi - lo)))
      if (oscAmp > 0 && p > 0) {
        p = clamp01(
          p +
            oscAmp *
              env *
              Math.sin(t * 2 * Math.PI * freqs[i] + phaseRgb + Math.PI),
        )
      }
      y = applyOpProgress(y, opsBackward[i], p)
    }
    return y
  }
}

// Phase 32-AQ: Y 軸 [Y_MIN, Y_MAX] に対する screen Y 変換。
//   sy = plotY + plotH * (1 - (y - Y_MIN) / Y_RANGE)
function yToScreen(y: number, plotY: number, plotH: number): number {
  return plotY + plotH * (1 - (y - Y_MIN) / Y_RANGE)
}

function buildPolyline(
  fn: (x: number) => number,
  plotXAbs: number,
  plotY: number,
  plotW: number,
  plotH: number,
): string {
  const points: string[] = []
  for (let i = 0; i <= SAMPLES; i++) {
    const x = i / SAMPLES
    const y = fn(x)
    const sx = plotXAbs + x * plotW
    const sy = yToScreen(y, plotY, plotH)
    points.push(`${sx.toFixed(2)},${sy.toFixed(2)}`)
  }
  return points.join(" ")
}

function buildIdealPolyline(
  plotXAbs: number,
  plotY: number,
  plotW: number,
  plotH: number,
): string {
  const N = 32
  const points: string[] = []
  for (let i = 0; i <= N; i++) {
    const x = i / N
    const sx = plotXAbs + x * plotW
    const sy = yToScreen(x, plotY, plotH)
    points.push(`${sx.toFixed(2)},${sy.toFixed(2)}`)
  }
  return points.join(" ")
}

function fmt3(n: number): string {
  return n.toFixed(3)
}

function formulaForOpAt(op: Op, p: number, isInverseDisplay: boolean): string {
  if (!isInverseDisplay) {
    if (op.kind === "add") {
      const v = op.param * p
      const abs = Math.abs(v).toFixed(3)
      if (v >= 0) return `y + ${abs}`
      return `y − ${abs}`
    }
    if (op.kind === "pow") return `y^${fmt3(1 + (op.param - 1) * p)}`
    return `y × ${fmt3(1 + (op.param - 1) * p)}`
  }
  if (op.kind === "add") {
    const v = op.param * p
    const abs = Math.abs(v).toFixed(3)
    if (v >= 0) return `y − ${abs}`
    return `y + ${abs}`
  }
  if (op.kind === "pow") return `y^(1/${fmt3(1 + (op.param - 1) * p)})`
  return `y ÷ ${fmt3(1 + (op.param - 1) * p)}`
}

type FormulaCell = {
  current: string
  prev: string | null
  fadeIn: number
  fadeOut: number
}

/**
 * 左セル channel 1 つぶんの formula state。
 * forward は ops を 0..N-1 順に表示、backward は ops[N-1..0] の逆関数表示。
 */
function makeFormulaForLeftChannel(
  state: AnimState,
  ops: Op[],
  offsets: Offsets,
): FormulaCell {
  if (state.phase === "hold-start") {
    return { current: "y = x", prev: null, fadeIn: 1, fadeOut: 0 }
  }
  if (state.phase === "hold-end") {
    return {
      current: formulaForOpAt(ops[0], 1, true),
      prev: null,
      fadeIn: 1,
      fadeOut: 0,
    }
  }
  let idx: number
  let isInverse: boolean
  let progress: number
  if (state.phase === "forward") {
    idx = Math.min(NUM_OPS - 1, Math.max(0, Math.floor(state.P * NUM_OPS)))
    isInverse = false
    progress = state.P
  } else {
    const fromQ = Math.min(NUM_OPS - 1, Math.max(0, Math.floor(state.Q * NUM_OPS)))
    idx = NUM_OPS - 1 - fromQ
    isInverse = true
    progress = state.Q
  }
  const { lo, hi } = offsets[idx]
  const easedP = easeInOutCubic(clamp01((progress - lo) / (hi - lo)))
  const op = ops[idx]
  const current = formulaForOpAt(op, easedP, isInverse)

  const since =
    state.phase === "forward"
      ? (state.P - Math.floor(state.P * NUM_OPS) / NUM_OPS) * FORWARD_DUR
      : (state.Q - Math.floor(state.Q * NUM_OPS) / NUM_OPS) * BACKWARD_DUR
  if (since >= FADE_DUR) {
    return { current, prev: null, fadeIn: 1, fadeOut: 0 }
  }
  let prevIdx: number
  let prevInverse: boolean
  if (!isInverse) {
    prevIdx = idx - 1
    prevInverse = false
    if (prevIdx < 0) {
      const ratio = since / FADE_DUR
      return { current, prev: "y = x", fadeIn: ratio, fadeOut: 1 - ratio }
    }
  } else {
    prevIdx = idx + 1
    prevInverse = true
    if (prevIdx > NUM_OPS - 1) {
      const ratio = since / FADE_DUR
      return {
        current,
        prev: formulaForOpAt(ops[NUM_OPS - 1], 1, false),
        fadeIn: ratio,
        fadeOut: 1 - ratio,
      }
    }
  }
  const prevOp = ops[prevIdx]
  if (prevOp.kind === op.kind) {
    return { current, prev: null, fadeIn: 1, fadeOut: 0 }
  }
  const ratio = since / FADE_DUR
  return {
    current,
    prev: formulaForOpAt(prevOp, prevInverse ? 0 : 1, prevInverse),
    fadeIn: ratio,
    fadeOut: 1 - ratio,
  }
}

/**
 * 右セル channel 1 つぶんの formula state。
 * forward は opsForward の forward 表示、backward は opsBackward の forward 表示
 * （別 ops 列の追加適用なので両区間とも非反転表示）。
 */
function makeFormulaForRightChannel(
  state: AnimState,
  opsForward: Op[],
  opsBackward: Op[],
  offsetsForward: Offsets,
  offsetsBackward: Offsets,
): FormulaCell {
  if (state.phase === "hold-start") {
    return { current: "y = x", prev: null, fadeIn: 1, fadeOut: 0 }
  }
  if (state.phase === "hold-end") {
    return {
      current: formulaForOpAt(
        opsBackward[opsBackward.length - 1],
        1,
        false,
      ),
      prev: null,
      fadeIn: 1,
      fadeOut: 0,
    }
  }
  let opsToUse: Op[]
  let offsetsToUse: Offsets
  let progress: number
  if (state.phase === "forward") {
    opsToUse = opsForward
    offsetsToUse = offsetsForward
    progress = state.P
  } else {
    opsToUse = opsBackward
    offsetsToUse = offsetsBackward
    progress = state.Q
  }
  const idx = Math.min(NUM_OPS - 1, Math.max(0, Math.floor(progress * NUM_OPS)))
  const { lo, hi } = offsetsToUse[idx]
  const easedP = easeInOutCubic(clamp01((progress - lo) / (hi - lo)))
  const op = opsToUse[idx]
  const current = formulaForOpAt(op, easedP, false)

  const since =
    state.phase === "forward"
      ? (state.P - idx / NUM_OPS) * FORWARD_DUR
      : (state.Q - idx / NUM_OPS) * BACKWARD_DUR
  if (since >= FADE_DUR) {
    return { current, prev: null, fadeIn: 1, fadeOut: 0 }
  }
  const prevIdx = idx - 1
  if (prevIdx < 0) {
    if (state.phase === "forward") {
      const ratio = since / FADE_DUR
      return { current, prev: "y = x", fadeIn: ratio, fadeOut: 1 - ratio }
    }
    // backward 開始直後 → 前は forward 最後 (opsForward[NUM_OPS-1] 完全)
    const ratio = since / FADE_DUR
    return {
      current,
      prev: formulaForOpAt(opsForward[NUM_OPS - 1], 1, false),
      fadeIn: ratio,
      fadeOut: 1 - ratio,
    }
  }
  const prevOp = opsToUse[prevIdx]
  if (prevOp.kind === op.kind) {
    return { current, prev: null, fadeIn: 1, fadeOut: 0 }
  }
  const ratio = since / FADE_DUR
  return {
    current,
    prev: formulaForOpAt(prevOp, 1, false),
    fadeIn: ratio,
    fadeOut: 1 - ratio,
  }
}

type BadgeKind = "initial" | "forward" | "backward" | "hold-end"

function phaseToBadge(p: Phase): BadgeKind {
  if (p === "hold-start") return "initial"
  if (p === "forward") return "forward"
  if (p === "backward") return "backward"
  return "hold-end"
}

function previousPhase(p: Phase): Phase {
  if (p === "forward") return "hold-start"
  if (p === "backward") return "forward"
  if (p === "hold-end") return "backward"
  return "hold-end"
}

function badgeOpacities(state: AnimState): Record<BadgeKind, number> {
  const result: Record<BadgeKind, number> = {
    initial: 0,
    forward: 0,
    backward: 0,
    "hold-end": 0,
  }
  const cur = phaseToBadge(state.phase)
  const fadeIn = Math.min(1, state.tInPhase / FADE_DUR)
  result[cur] = fadeIn
  const fadeOut = 1 - fadeIn
  if (fadeOut > 0.001) {
    result[phaseToBadge(previousPhase(state.phase))] = fadeOut
  }
  return result
}

function Badge({
  cx,
  cy,
  kind,
  opacity,
}: {
  cx: number
  cy: number
  kind: BadgeKind
  opacity: number
}) {
  if (opacity <= 0.001) return null
  const cfgMap: Record<
    BadgeKind,
    {
      fill: string
      text: string
      icon: "play" | "rev" | "check" | "circle"
      rx: number
    }
  > = {
    initial: {
      fill: "rgba(120,120,130,0.88)",
      text: "初期状態",
      icon: "circle",
      rx: 70,
    },
    forward: {
      fill: "rgba(80,180,120,0.88)",
      text: "処理追加中",
      icon: "play",
      rx: 82,
    },
    backward: {
      fill: "rgba(220,130,60,0.88)",
      text: "後段で復元中",
      icon: "rev",
      rx: 92,
    },
    "hold-end": {
      fill: "rgba(120,120,130,0.88)",
      text: "復元結果",
      icon: "check",
      rx: 70,
    },
  }
  const cfg = cfgMap[kind]
  const iconCx = cx - cfg.rx * 0.55
  const textCx = cx + cfg.rx * 0.18
  return (
    <g opacity={opacity}>
      <ellipse cx={cx} cy={cy} rx={cfg.rx} ry={20} fill={cfg.fill} />
      {cfg.icon === "play" && (
        <polygon
          points={`${iconCx - 6},${cy - 8} ${iconCx - 6},${cy + 8} ${iconCx + 6},${cy}`}
          fill="white"
        />
      )}
      {cfg.icon === "rev" && (
        <polygon
          points={`${iconCx + 6},${cy - 8} ${iconCx + 6},${cy + 8} ${iconCx - 6},${cy}`}
          fill="white"
        />
      )}
      {cfg.icon === "check" && (
        <polyline
          points={`${iconCx - 7},${cy + 1} ${iconCx - 1},${cy + 7} ${iconCx + 8},${cy - 6}`}
          fill="none"
          stroke="white"
          strokeWidth={2.6}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {cfg.icon === "circle" && (
        <circle
          cx={iconCx}
          cy={cy}
          r={6}
          fill="none"
          stroke="white"
          strokeWidth={2}
        />
      )}
      <text
        x={textCx}
        y={cy + 1}
        fontSize={16}
        fontWeight={600}
        fill="white"
        textAnchor="middle"
        dominantBaseline="middle"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
      >
        {cfg.text}
      </text>
    </g>
  )
}

function CellBackground({
  cellX,
  border,
  bg,
}: {
  cellX: number
  border: string
  bg: string
}) {
  return (
    <>
      <rect
        x={cellX + 6}
        y={6}
        width={CELL_W - 12}
        height={H - 12}
        rx={18}
        ry={18}
        fill={bg}
        stroke={border}
        strokeOpacity={0.55}
        strokeWidth={1.4}
      />
      <rect
        x={cellX + 6}
        y={6}
        width={CELL_W - 12}
        height={H - 12}
        rx={18}
        ry={18}
        fill="rgba(255,255,255,0.55)"
      />
    </>
  )
}

function CellPlot({
  cellX,
  showIdeal,
  idealOpacity,
  curveBuilds,
  clipId,
}: {
  cellX: number
  showIdeal: boolean
  idealOpacity: number
  curveBuilds: { fnR: (x: number) => number; fnG: (x: number) => number; fnB: (x: number) => number }
  clipId: string
}) {
  const plotXAbs = cellX + PLOT_X_LOCAL
  const polyR = buildPolyline(curveBuilds.fnR, plotXAbs, PLOT_Y, PLOT_W, PLOT_H)
  const polyG = buildPolyline(curveBuilds.fnG, plotXAbs, PLOT_Y, PLOT_W, PLOT_H)
  const polyB = buildPolyline(curveBuilds.fnB, plotXAbs, PLOT_Y, PLOT_W, PLOT_H)
  const idealPoints = buildIdealPolyline(plotXAbs, PLOT_Y, PLOT_W, PLOT_H)

  // Phase 32-AT: Y_MIN=0, Y_MAX=1.0 (y=0 が plot 下端、y=1 が plot 上端)
  const yOneScreen = yToScreen(1, PLOT_Y, PLOT_H)
  const yHalfScreen = yToScreen(0.5, PLOT_Y, PLOT_H)
  const yZeroScreen = yToScreen(0, PLOT_Y, PLOT_H)

  return (
    <g>
      <rect
        x={plotXAbs}
        y={PLOT_Y}
        width={PLOT_W}
        height={PLOT_H}
        rx={4}
        ry={4}
        fill="rgba(255,255,255,0.4)"
        stroke={GRID}
        strokeWidth={1}
      />

      {/* y = x 参照線（y=0 ライン上の左端 → y=1 ライン上の右端） */}
      <line
        x1={plotXAbs}
        y1={yZeroScreen}
        x2={plotXAbs + PLOT_W}
        y2={yOneScreen}
        stroke={GRID}
        strokeWidth={1}
        strokeDasharray="2 6"
      />

      <line
        x1={plotXAbs}
        y1={yHalfScreen}
        x2={plotXAbs + PLOT_W}
        y2={yHalfScreen}
        stroke={GRID}
        strokeWidth={1}
        strokeDasharray="4 6"
      />

      <line
        x1={plotXAbs}
        y1={yOneScreen}
        x2={plotXAbs + PLOT_W}
        y2={yOneScreen}
        stroke={Y_ONE_LINE}
        strokeWidth={1.2}
        strokeDasharray="6 6"
      />
      <text
        x={plotXAbs + PLOT_W}
        y={PLOT_Y - 8}
        fontSize={13}
        fill={TEXT_MUTED}
        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
        textAnchor="end"
        dominantBaseline="alphabetic"
      >
        y = 1
      </text>

      <g clipPath={`url(#${clipId})`}>
        {showIdeal && (
          <polyline
            points={idealPoints}
            fill="none"
            stroke="rgba(255,255,255,0.85)"
            strokeWidth={2.2}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="6 6"
            opacity={idealOpacity}
          />
        )}
        <g style={{ mixBlendMode: "screen" }}>
          <polyline
            points={polyR}
            fill="none"
            stroke={RGB_R}
            strokeWidth={3.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <polyline
            points={polyG}
            fill="none"
            stroke={RGB_G}
            strokeWidth={3.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <polyline
            points={polyB}
            fill="none"
            stroke={RGB_B}
            strokeWidth={3.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      </g>
    </g>
  )
}

function FormulaRGB({
  cellX,
  rCell,
  gCell,
  bCell,
}: {
  cellX: number
  rCell: FormulaCell
  gCell: FormulaCell
  bCell: FormulaCell
}) {
  const slotW = (PLOT_W - 20) / 3
  const baseX = cellX + PLOT_X_LOCAL + 10
  const slots: { label: string; cell: FormulaCell; color: string; cx: number }[] = [
    {
      label: "R",
      cell: rCell,
      color: "rgb(195,55,55)",
      cx: baseX + slotW * 0.5,
    },
    {
      label: "G",
      cell: gCell,
      color: "rgb(45,150,70)",
      cx: baseX + slotW * 1.5,
    },
    {
      label: "B",
      cell: bCell,
      color: "rgb(55,100,200)",
      cx: baseX + slotW * 2.5,
    },
  ]
  return (
    <g>
      {slots.map((s) => (
        <g key={s.label}>
          {s.cell.prev && (
            <text
              x={s.cx}
              y={FORMULA_CY}
              fontSize={22}
              fontWeight={500}
              fill={TEXT_PRIMARY}
              textAnchor="middle"
              dominantBaseline="middle"
              fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
              opacity={s.cell.fadeOut}
            >
              <tspan fill={s.color} fontWeight={700}>
                {s.label}:{" "}
              </tspan>
              {s.cell.prev}
            </text>
          )}
          <text
            x={s.cx}
            y={FORMULA_CY}
            fontSize={22}
            fontWeight={500}
            fill={TEXT_PRIMARY}
            textAnchor="middle"
            dominantBaseline="middle"
            fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
            opacity={s.cell.fadeIn}
          >
            <tspan fill={s.color} fontWeight={700}>
              {s.label}:{" "}
            </tspan>
            {s.cell.current}
          </text>
        </g>
      ))}
    </g>
  )
}

function Cell({
  cellX,
  title,
  tint,
  showIdeal,
  idealOpacity,
  curveBuilds,
  clipId,
  rgbFormula,
  badgeOps,
}: {
  cellX: number
  title: string
  tint: typeof TINT_GAMMA
  showIdeal: boolean
  idealOpacity: number
  curveBuilds: { fnR: (x: number) => number; fnG: (x: number) => number; fnB: (x: number) => number }
  clipId: string
  rgbFormula: { r: FormulaCell; g: FormulaCell; b: FormulaCell }
  badgeOps: Record<BadgeKind, number>
}) {
  const cx = cellX + CELL_W / 2
  return (
    <g>
      <CellBackground cellX={cellX} border={tint.border} bg={tint.bg} />
      <text
        x={cx}
        y={TITLE_Y}
        fontSize={22}
        fontWeight={700}
        fill={tint.title}
        textAnchor="middle"
        dominantBaseline="middle"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
      >
        {title}
      </text>

      <CellPlot
        cellX={cellX}
        showIdeal={showIdeal}
        idealOpacity={idealOpacity}
        curveBuilds={curveBuilds}
        clipId={clipId}
      />

      <Badge cx={cx} cy={BADGE_CY} kind="initial" opacity={badgeOps.initial} />
      <Badge cx={cx} cy={BADGE_CY} kind="forward" opacity={badgeOps.forward} />
      <Badge cx={cx} cy={BADGE_CY} kind="backward" opacity={badgeOps.backward} />
      <Badge cx={cx} cy={BADGE_CY} kind="hold-end" opacity={badgeOps["hold-end"]} />

      <FormulaRGB
        cellX={cellX}
        rCell={rgbFormula.r}
        gCell={rgbFormula.g}
        bCell={rgbFormula.b}
      />
    </g>
  )
}

// 開発時のみ実行: 左セル完全可逆性 + 右セル残差検証
let _devAssertionsRun = false
function runDevAssertions() {
  if (_devAssertionsRun) return
  _devAssertionsRun = true

  // Phase 32-AQ: signedPow 6 点ユニット検証ログ
  console.log(
    "[Phase 32-AQ] signedPow unit checks:",
    `signedPow(-0.3, 1.5)=${signedPow(-0.3, 1.5).toFixed(4)}`,
    `signedPow(-0.1, 1.5)=${signedPow(-0.1, 1.5).toFixed(4)}`,
    `signedPow(0, 1.5)=${signedPow(0, 1.5).toFixed(4)}`,
    `signedPow(0.1, 1.5)=${signedPow(0.1, 1.5).toFixed(4)}`,
    `signedPow(0.3, 1.5)=${signedPow(0.3, 1.5).toFixed(4)}`,
    `signedPow(-0.5, 0.5)=${signedPow(-0.5, 0.5).toFixed(4)}`,
  )

  const leftSamples = [0.0, 0.25, 0.5, 0.75, 1.0]
  const leftChans = [
    { name: "LEFT_R", ops: LEFT_OPS_R, offsets: OFFSETS_LEFT_R },
    { name: "LEFT_G", ops: LEFT_OPS_G, offsets: OFFSETS_LEFT_G },
    { name: "LEFT_B", ops: LEFT_OPS_B, offsets: OFFSETS_LEFT_B },
  ]
  for (const { name, ops, offsets } of leftChans) {
    const fn = buildLeftFn(ops, offsets, 1, 1)
    for (const x of leftSamples) {
      const y = fn(x)
      console.assert(
        Math.abs(y - x) < 1e-10,
        `${name}@x=${x}: |y-x|=${Math.abs(y - x)} not reversible`,
      )
    }
  }

  // Phase 32-AT: 21 点 (0.0, 0.05, ..., 1.0) 共通サンプル
  const N = 20
  const xs: number[] = []
  for (let i = 0; i <= N; i++) xs.push(i / N)

  // Phase 32-AT: HOLD_START (P=0, Q=0) 左セル直線検証
  for (const { name, ops, offsets } of leftChans) {
    const fn = buildLeftFn(ops, offsets, 0, 0)
    const ys = xs.map((x) => fn(x))
    const maxErr = Math.max(...xs.map((x, i) => Math.abs(ys[i] - x)))
    console.assert(
      maxErr < 1e-12,
      `${name} HOLD_START (P=0, Q=0) max|y-x|=${maxErr} not y=x`,
    )
  }

  const rightChans = [
    { name: "RIGHT_R", opsF: RIGHT_FORWARD_R, opsB: RIGHT_BACKWARD_R, off: OFFSETS_RIGHT_R },
    { name: "RIGHT_G", opsF: RIGHT_FORWARD_G, opsB: RIGHT_BACKWARD_G, off: OFFSETS_RIGHT_G },
    { name: "RIGHT_B", opsF: RIGHT_FORWARD_B, opsB: RIGHT_BACKWARD_B, off: OFFSETS_RIGHT_B },
  ]

  // Phase 32-AT: HOLD_START (P=0, Q=0) 右セル直線検証
  for (const { name, opsF, opsB, off } of rightChans) {
    const fn = buildRightFn(opsF, opsB, off, off, 0, 0, FREQS, 0, 0, 0)
    const ys = xs.map((x) => fn(x))
    const maxErr = Math.max(...xs.map((x, i) => Math.abs(ys[i] - x)))
    console.assert(
      maxErr < 1e-12,
      `${name} HOLD_START (P=0, Q=0) max|y-x|=${maxErr} not y=x`,
    )
  }

  for (const { name, opsF, opsB, off } of rightChans) {
    // (a) FORWARD 中盤 (P=0.5, Q=0): min(y) < -0.15
    const fnFwdMid = buildRightFn(opsF, opsB, off, off, 0.5, 0, FREQS, 0, 0, 0)
    const ysFwdMid = xs.map((x) => fnFwdMid(x))
    const minFwdMid = Math.min(...ysFwdMid)
    console.assert(
      minFwdMid < -0.15,
      `${name} FORWARD mid (P=0.5, Q=0) min(y)=${minFwdMid} not below -0.15`,
    )

    // (b) BACKWARD 中盤 (P=1, Q=0.5): min(y) < -0.15
    const fnBwdMid = buildRightFn(opsF, opsB, off, off, 1, 0.5, FREQS, 0, 0, 0)
    const ysBwdMid = xs.map((x) => fnBwdMid(x))
    const minBwdMid = Math.min(...ysBwdMid)
    console.assert(
      minBwdMid < -0.15,
      `${name} BACKWARD mid (P=1, Q=0.5) min(y)=${minBwdMid} not below -0.15`,
    )

    // (c) HOLD_END (P=1, Q=1): リフト不動点 + プラトー+持ち上げ + 下方残差許容
    const fnEnd = buildRightFn(opsF, opsB, off, off, 1, 1, FREQS, 0, 0, 0)
    const ysEnd = xs.map((x) => fnEnd(x))
    console.assert(
      Math.abs(ysEnd[N] - 1) < 1e-9,
      `${name}@x=1 lift fixed-point violation: |y-1|=${Math.abs(ysEnd[N] - 1)}`,
    )
    let maxJump = 0
    for (let i = 0; i + 1 < N; i++) {
      const dy0 = ysEnd[i + 1] - ysEnd[i]
      const dy1 = ysEnd[i + 2] - ysEnd[i + 1]
      maxJump = Math.max(maxJump, dy1 - dy0)
    }
    console.assert(
      maxJump > 0.02,
      `${name} HOLD_END monotone (no plateau+lift): max(dy[i+1]-dy[i])=${maxJump}`,
    )
    const minEnd = Math.min(...ysEnd)
    console.assert(
      minEnd > -0.1,
      `${name} HOLD_END min(y)=${minEnd} below -0.1 (excess residual)`,
    )
  }
}

if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
  runDevAssertions()
}

export default function CorrectionReversibility({
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

  const state: AnimState = reducedMotion
    ? {
        phase: "hold-end",
        P: 1,
        Q: 1,
        t: 0,
        tInPhase: HOLD_END / 2,
        tEnd: HOLD_END / 2,
      }
    : computeAnimState(animT)

  let showIdeal = false
  let idealOpacity = 0
  if (reducedMotion) {
    showIdeal = true
    idealOpacity = 1
  } else if (state.phase === "hold-end") {
    showIdeal = true
    const tEnd = state.tEnd
    if (tEnd < IDEAL_FADE_IN) idealOpacity = tEnd / IDEAL_FADE_IN
    else if (tEnd > HOLD_END - IDEAL_FADE_OUT)
      idealOpacity = Math.max(0, (HOLD_END - tEnd) / IDEAL_FADE_OUT)
    else idealOpacity = 1
  }

  // 左セル: RGB 3 chan + 各 chan 完全可逆 (osc なし)
  const leftFnR = buildLeftFn(LEFT_OPS_R, OFFSETS_LEFT_R, state.P, state.Q)
  const leftFnG = buildLeftFn(LEFT_OPS_G, OFFSETS_LEFT_G, state.P, state.Q)
  const leftFnB = buildLeftFn(LEFT_OPS_B, OFFSETS_LEFT_B, state.P, state.Q)
  const leftCurves = { fnR: leftFnR, fnG: leftFnG, fnB: leftFnB }

  // 右セル: forward / backward 別 ops、入れ子非可換性で残差残る (osc あり)
  const rightFnR = buildRightFn(
    RIGHT_FORWARD_R,
    RIGHT_BACKWARD_R,
    OFFSETS_RIGHT_R,
    OFFSETS_RIGHT_R,
    state.P,
    state.Q,
    FREQS,
    PHASE_R,
    OSC_AMP_RIGHT,
    state.t,
  )
  const rightFnG = buildRightFn(
    RIGHT_FORWARD_G,
    RIGHT_BACKWARD_G,
    OFFSETS_RIGHT_G,
    OFFSETS_RIGHT_G,
    state.P,
    state.Q,
    FREQS,
    PHASE_G,
    OSC_AMP_RIGHT,
    state.t,
  )
  const rightFnB = buildRightFn(
    RIGHT_FORWARD_B,
    RIGHT_BACKWARD_B,
    OFFSETS_RIGHT_B,
    OFFSETS_RIGHT_B,
    state.P,
    state.Q,
    FREQS,
    PHASE_B,
    OSC_AMP_RIGHT,
    state.t,
  )
  const rightCurves = { fnR: rightFnR, fnG: rightFnG, fnB: rightFnB }

  const leftFormulaR = makeFormulaForLeftChannel(state, LEFT_OPS_R, OFFSETS_LEFT_R)
  const leftFormulaG = makeFormulaForLeftChannel(state, LEFT_OPS_G, OFFSETS_LEFT_G)
  const leftFormulaB = makeFormulaForLeftChannel(state, LEFT_OPS_B, OFFSETS_LEFT_B)

  const rightFormulaR = makeFormulaForRightChannel(
    state,
    RIGHT_FORWARD_R,
    RIGHT_BACKWARD_R,
    OFFSETS_RIGHT_R,
    OFFSETS_RIGHT_R,
  )
  const rightFormulaG = makeFormulaForRightChannel(
    state,
    RIGHT_FORWARD_G,
    RIGHT_BACKWARD_G,
    OFFSETS_RIGHT_G,
    OFFSETS_RIGHT_G,
  )
  const rightFormulaB = makeFormulaForRightChannel(
    state,
    RIGHT_FORWARD_B,
    RIGHT_BACKWARD_B,
    OFFSETS_RIGHT_B,
    OFFSETS_RIGHT_B,
  )

  const badgeOps = badgeOpacities(state)

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="absolute inset-0 h-full w-full"
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <clipPath id="cr-plot-left">
          <rect x={PLOT_X_LOCAL} y={PLOT_Y} width={PLOT_W} height={PLOT_H} />
        </clipPath>
        <clipPath id="cr-plot-right">
          <rect
            x={CELL_W + GAP + PLOT_X_LOCAL}
            y={PLOT_Y}
            width={PLOT_W}
            height={PLOT_H}
          />
        </clipPath>
      </defs>

      <Cell
        cellX={0}
        title="ゲイン × ガンマ（乗算 + べき乗）"
        tint={TINT_GAMMA}
        showIdeal={showIdeal}
        idealOpacity={idealOpacity}
        curveBuilds={leftCurves}
        clipId="cr-plot-left"
        rgbFormula={{ r: leftFormulaR, g: leftFormulaG, b: leftFormulaB }}
        badgeOps={badgeOps}
      />
      <Cell
        cellX={CELL_W + GAP}
        title="リフト × ガンマ（加算 + べき乗）"
        tint={TINT_LIFT}
        showIdeal={showIdeal}
        idealOpacity={idealOpacity}
        curveBuilds={rightCurves}
        clipId="cr-plot-right"
        rgbFormula={{
          r: rightFormulaR,
          g: rightFormulaG,
          b: rightFormulaB,
        }}
        badgeOps={badgeOps}
      />
    </svg>
  )
}
