import { describe, expect, it } from "vitest"
import { parseCube, sampleCube } from "./cube"

const IDENTITY_CUBE = `
TITLE "Identity"
LUT_3D_SIZE 2
DOMAIN_MIN 0 0 0
DOMAIN_MAX 1 1 1
0 0 0
1 0 0
0 1 0
1 1 0
0 0 1
1 0 1
0 1 1
1 1 1
`

describe("parseCube", () => {
  it("parses a valid 3D cube", () => {
    const lut = parseCube(IDENTITY_CUBE)
    expect(lut.title).toBe("Identity")
    expect(lut.size).toBe(2)
    expect(lut.values).toHaveLength(24)
  })

  it("rejects incomplete cube data", () => {
    expect(() => parseCube("LUT_3D_SIZE 2\n0 0 0")).toThrow("LUTデータ数が不正")
  })
})

describe("sampleCube", () => {
  it("uses trilinear interpolation", () => {
    const lut = parseCube(IDENTITY_CUBE)
    const result = sampleCube(lut, [0.25, 0.5, 0.75])
    expect(result[0]).toBeCloseTo(0.25, 6)
    expect(result[1]).toBeCloseTo(0.5, 6)
    expect(result[2]).toBeCloseTo(0.75, 6)
  })
})
