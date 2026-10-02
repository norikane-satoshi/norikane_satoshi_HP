import { describe, expect, it } from "vitest"

import {
  FLIP_HUE_DEG,
  LED_SENSOR,
  WB_GAINS,
  YELLOW_SENSOR,
  hueDeg,
  hueDistance,
  ledProfile,
  ledStrength,
  lightSensor,
  probeState,
  sensorToWorking,
  toDisplay,
  yellowProfile,
  yellowStrength,
  type Vec3,
} from "@/components/notes/visuals/correction-failure-modes"

const hueOf = (v: Vec3) => hueDeg(v)
const probeStateGrey = (): Vec3 => {
  const raw: Vec3 = [0.3 / WB_GAINS[0], 0.3 / WB_GAINS[1], 0.3 / WB_GAINS[2]]
  return [raw[0] * WB_GAINS[0], raw[1] * WB_GAINS[1], raw[2] * WB_GAINS[2]]
}

function firstStep(panel: "led" | "yellow" | "black", pred: (u: number) => boolean) {
  for (let step = 0; step <= 200; step++) {
    const u = step / 200
    if (pred(u)) return u
  }
  return -1
}

describe("correction-failure-modes (鮮やかなところから先に色がひっくり返る)", () => {
  it("keeps grey grey through the colour conversion", () => {
    const w = sensorToWorking([0.2 / 2, 0.2, 0.2 / 1.5])
    for (const v of w) expect(v).toBeCloseTo(0.2, 6)
  })

  it("shows white-balanced values, so the ceiling differs per channel and full clipping is not white", () => {
    const end = probeState("yellow", 1)
    expect(end.limited).toEqual(["R", "G", "B"])
    const recorded = end.values.map((v, i) => Math.min(v, WB_GAINS[i]))
    expect(recorded).toEqual([...WB_GAINS])
    // 上限の高さが違う（G が一番低い）ので、全部止まっても R:G:B は揃わない
    expect(WB_GAINS[1]).toBeLessThan(WB_GAINS[0])
    expect(WB_GAINS[1]).toBeLessThan(WB_GAINS[2])
    // 無彩色ならホワイトバランス後の 3 本は同じ長さ
    const grey = probeStateGrey()
    expect(grey[0]).toBeCloseTo(grey[1], 6)
    expect(grey[2]).toBeCloseTo(grey[1], 6)
  })

  it("LED: starts blue, B stops at the ceiling first, then only the centre flips to the magenta side", () => {
    const start = probeState("led", 0)
    expect(start.limited).toEqual([])
    expect(hueOf(start.display)).toBeGreaterThan(200)
    expect(hueOf(start.display)).toBeLessThan(250)

    const firstLimit = firstStep("led", (u) => probeState("led", u).limited.length > 0)
    expect(probeState("led", firstLimit).limited).toEqual(["B"])
    const firstFlip = firstStep("led", (u) => probeState("led", u).flipped)
    expect(firstFlip).toBeGreaterThan(firstLimit)

    const end = probeState("led", 1)
    expect(end.flipped).toBe(true)
    const endHue = hueOf(end.display) ?? 0
    expect(endHue).toBeGreaterThan(280)

    // 周りのグローは青のまま
    const glow = toDisplay(sensorToWorking(lightSensor(LED_SENSOR, ledStrength(1), ledProfile(0.5, 0))))
    expect(hueOf(glow)).toBeGreaterThan(200)
    expect(hueOf(glow)).toBeLessThan(250)
  })

  it("yellow: G stops at the ceiling before R, and the brightest part turns vivid magenta", () => {
    const start = probeState("yellow", 0)
    expect(start.limited).toEqual([])
    const startHue = hueOf(start.display) ?? 0
    expect(startHue).toBeGreaterThan(45)
    expect(startHue).toBeLessThan(65)

    const firstLimit = firstStep("yellow", (u) => probeState("yellow", u).limited.length > 0)
    expect(probeState("yellow", firstLimit).limited).toEqual(["G"])

    const end = probeState("yellow", 1)
    expect(end.flipped).toBe(true)
    const [r, g, b] = end.display
    expect(r).toBeGreaterThan(g)
    expect(b).toBeGreaterThan(g)
    expect(hueDistance(hueOf(end.display), 330)).toBeLessThan(25)

    // 外側は黄色のまま
    const edge = toDisplay(
      sensorToWorking(lightSensor(YELLOW_SENSOR, yellowStrength(1), yellowProfile(0.95, 0.1)))
    )
    expect(hueDistance(hueOf(edge), startHue)).toBeLessThan(FLIP_HUE_DEG)
  })

})
