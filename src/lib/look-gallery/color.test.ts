import { describe, expect, it } from "vitest"
import { applyOutputTransform, applySourceTransform, clampRgb } from "./color"

describe("look gallery color pipeline", () => {
  it("passes values through when source and output are none", () => {
    const source = [0.18, 0.42, 0.73] as const
    expect(applySourceTransform(source, "none")).toEqual(source)
    expect(applyOutputTransform(source, "none")).toEqual(source)
  })

  it("keeps transformed output finite and display bounded", () => {
    const acesCct = applySourceTransform([0.41, 0.39, 0.37], "slog3-sgamut3cine")
    const output = clampRgb(applyOutputTransform(acesCct, "aces-sdr-rec709"))
    expect(output.every(Number.isFinite)).toBe(true)
    expect(output.every((value) => value >= 0 && value <= 1)).toBe(true)
  })
})
