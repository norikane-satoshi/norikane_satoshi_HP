import { describe, expect, it } from "vitest"

import {
  FAILURE_MODES_CHIPS,
  FAILURE_MODES_OFFSET_MAX,
  chipCurrent,
  crossedChannels,
  isFlipped,
  ratioColor,
} from "@/components/notes/visuals/correction-failure-modes"

const byLabel = (label: string) => {
  const chip = FAILURE_MODES_CHIPS.find((c) => c.label === label)
  if (!chip) throw new Error(`missing chip ${label}`)
  return chip
}

describe("correction-failure-modes (本文: 3ch 同量の加算 → 小さい ch が先に 0 をまたぐ → 比率が崩れて色が飛ぶ)", () => {
  it("adds the same amount to all three channels", () => {
    for (const chip of FAILURE_MODES_CHIPS) {
      const cur = chipCurrent(chip, 1)
      const deltas = cur.map((v, i) => v - chip.base[i])
      for (const d of deltas) {
        expect(d).toBeCloseTo(-FAILURE_MODES_OFFSET_MAX, 10)
      }
    }
  })

  it("starts from a base whose ratio color matches the sample", () => {
    expect(ratioColor(byLabel("高彩度の赤").base)[0]).toBe(1)
    expect(ratioColor(byLabel("高彩度の緑").base)[1]).toBe(1)
    expect(ratioColor(byLabel("青い LED（色域外）").base)[2]).toBe(1)
  })

  it("lets the small channel cross 0 before the colour flips", () => {
    for (const label of ["高彩度の赤", "高彩度の緑", "青い LED（色域外）"]) {
      const chip = byLabel(label)
      let firstCross = -1
      let firstFlip = -1
      for (let step = 0; step <= 100; step++) {
        const u = step / 100
        const cur = chipCurrent(chip, u)
        if (firstCross < 0 && crossedChannels(chip.base, cur).length > 0) firstCross = u
        if (firstFlip < 0 && isFlipped(chip.base, cur)) firstFlip = u
      }
      expect(firstCross).toBeGreaterThanOrEqual(0)
      expect(firstFlip).toBeGreaterThan(firstCross)
    }
  })

  it("flips the high-saturation colours to another hue at full offset", () => {
    const red = chipCurrent(byLabel("高彩度の赤"), 1)
    expect(isFlipped(byLabel("高彩度の赤").base, red)).toBe(true)
    expect(ratioColor(red)[0]).toBe(0)
  })

  it("keeps the low-saturation skin comparison from flipping", () => {
    const skin = byLabel("肌（比較）")
    for (let step = 0; step <= 100; step++) {
      const cur = chipCurrent(skin, step / 100)
      expect(isFlipped(skin.base, cur)).toBe(false)
      expect(crossedChannels(skin.base, cur)).toEqual([])
    }
  })
})
