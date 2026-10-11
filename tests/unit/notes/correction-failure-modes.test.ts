import { describe, expect, it } from "vitest"

import {
  hueDeg,
  luminance,
  negativePixel,
  panelState,
  saturateAroundMean,
  type Vec3,
} from "@/components/notes/visuals/correction-failure-modes"

describe("correction-failure-modes (0〜100% の外に出た値が後ろの処理で崩れる)", () => {
  it("clip side: starts orange, then the centre clips channel by channel and drifts toward yellow / white", () => {
    const start = panelState("clip", 0)
    expect(start.broken).toBe(false)
    const startHue = hueDeg(start.display) ?? 0
    expect(startHue).toBeGreaterThan(10)
    expect(startHue).toBeLessThan(35)

    const end = panelState("clip", 1)
    expect(end.broken).toBe(true)
    expect(end.display[0]).toBe(1)
    expect(end.display[1]).toBe(1)
    const endHue = hueDeg(end.display) ?? 0
    expect(endHue).toBeGreaterThan(50)
  })

  it("negative side: saturation pushes the small channels below 0 and the centre luminance to <= 0, so it goes black", () => {
    const start = panelState("negative", 0)
    expect(start.broken).toBe(false)
    expect(luminance(start.center)).toBeGreaterThan(0)
    expect(Math.max(...start.display)).toBeGreaterThan(0.3)

    const end = panelState("negative", 1)
    expect(end.broken).toBe(true)
    expect(end.center[0]).toBeLessThan(0)
    expect(end.center[1]).toBeLessThan(0)
    expect(luminance(end.center)).toBeLessThanOrEqual(0)
    expect(end.display).toEqual([0, 0, 0])
  })

  it("negative side: the less saturated glow stays blue", () => {
    const glow = negativePixel(0.45, 0, 1)
    expect(luminance(glow.value)).toBeGreaterThan(0)
    const h = hueDeg(glow.display) ?? 0
    expect(h).toBeGreaterThan(200)
    expect(h).toBeLessThan(250)
  })

  it("saturation around the channel mean lowers Rec.709 luminance for a saturated blue (luma-pivot would not)", () => {
    const blue: Vec3 = [0.02, 0.05, 1.0]
    expect(luminance(saturateAroundMean(blue, 2))).toBeLessThan(luminance(blue))
    const y = luminance(blue)
    const lumaPivot = blue.map((v) => y + 2 * (v - y)) as Vec3
    expect(luminance(lumaPivot)).toBeCloseTo(y, 10)
  })
})
