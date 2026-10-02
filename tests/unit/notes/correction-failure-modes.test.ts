import { describe, expect, it } from "vitest"

import {
  FLIP_HUE_DEG,
  LED_SENSOR,
  YELLOW_SENSOR,
  hueDeg,
  hueDistance,
  ledProfile,
  blackField,
  blackSensorAt,
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

function firstStep(panel: "led" | "yellow" | "black", pred: (u: number) => boolean) {
  for (let step = 0; step <= 200; step++) {
    const u = step / 200
    if (pred(u)) return u
  }
  return -1
}

describe("correction-failure-modes (1 つのチャンネルが先に端で止まる → 比率が崩れて色が飛ぶ)", () => {
  it("keeps grey grey through the colour conversion", () => {
    const w = sensorToWorking([0.2 / 2, 0.2, 0.2 / 1.5])
    for (const v of w) expect(v).toBeCloseTo(0.2, 6)
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

  it("black: as the light fades, G is clipped at 0 first and the white balance turns the rest magenta", () => {
    const start = probeState("black", 0)
    for (const v of start.values) expect(v).toBeGreaterThan(0)

    const firstCut = firstStep("black", (u) => probeState("black", u).limited.length > 0)
    expect(probeState("black", firstCut).limited).toEqual(["G"])

    const end = probeState("black", 1)
    expect(end.values[1]).toBeLessThan(0)
    expect(end.values[0]).toBeGreaterThan(0)
    expect(end.values[2]).toBeGreaterThan(0)
    expect(end.flipped).toBe(true)
    expect(end.display[1]).toBe(0)
    const endHue = hueOf(end.display) ?? 0
    expect(endHue).toBeGreaterThan(280)
  })

  it("black: clipping at 0 before the white balance gives the whole shadow a magenta cast", () => {
    const field = blackField()
    const meanAt = (u: number) => {
      const sum: Vec3 = [0, 0, 0]
      let n = 0
      for (let iy = 0; iy < 128; iy += 2) {
        for (let ix = 0; ix < 128; ix += 2) {
          const w = sensorToWorking(blackSensorAt(ix, iy, u))
          sum[0] += w[0]
          sum[1] += w[1]
          sum[2] += w[2]
          n++
        }
      }
      return sum.map((v) => v / n) as Vec3
    }
    expect(field.noise.length).toBe(128 * 128 * 3)
    const lit = meanAt(0)
    // 光があるうちはほぼ無彩色
    expect(Math.max(...lit) - Math.min(...lit)).toBeLessThan(0.1 * Math.max(...lit))
    const dark = meanAt(1)
    // 0 で切られた分の持ち上がりに WB がかかり、R と B が G より大きくなる
    expect(dark[0]).toBeGreaterThan(dark[1] * 2)
    expect(dark[2]).toBeGreaterThan(dark[1] * 1.5)
  })
})
