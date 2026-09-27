export type Rgb = readonly [number, number, number]

export interface CubeLut {
  title: string
  size: number
  domainMin: Rgb
  domainMax: Rgb
  values: Float32Array
}

const triplet = (parts: string[]): Rgb => [
  Number(parts[0]),
  Number(parts[1]),
  Number(parts[2]),
]

export function parseCube(text: string, fallbackTitle = "Uploaded LUT"): CubeLut {
  let title = fallbackTitle
  let size = 0
  let domainMin: Rgb = [0, 0, 0]
  let domainMax: Rgb = [1, 1, 1]
  const values: number[] = []

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    const parts = line.split(/\s+/)
    const directive = parts[0].toUpperCase()

    if (directive === "TITLE") {
      title = line.slice(5).trim().replace(/^"|"$/g, "") || fallbackTitle
    } else if (directive === "LUT_3D_SIZE") {
      size = Number(parts[1])
    } else if (directive === "DOMAIN_MIN") {
      domainMin = triplet(parts.slice(1))
    } else if (directive === "DOMAIN_MAX") {
      domainMax = triplet(parts.slice(1))
    } else if (/^[+-]?(?:\d|\.\d)/.test(line)) {
      const value = triplet(parts)
      if (value.every(Number.isFinite)) values.push(...value)
    }
  }

  if (!Number.isInteger(size) || size < 2 || size > 128) {
    throw new Error("LUT_3D_SIZE は2から128の範囲で指定してください。")
  }
  if (values.length !== size ** 3 * 3) {
    throw new Error(`LUTデータ数が不正です。${size ** 3}組が必要です。`)
  }

  return { title, size, domainMin, domainMax, values: new Float32Array(values) }
}

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value))

const mix = (a: number, b: number, amount: number) => a + (b - a) * amount

export function sampleCube(lut: CubeLut, rgb: Rgb): Rgb {
  const normalized = rgb.map((value, channel) => {
    const minimum = lut.domainMin[channel]
    const maximum = lut.domainMax[channel]
    return clamp((value - minimum) / Math.max(maximum - minimum, Number.EPSILON), 0, 1)
  })
  const scaled = normalized.map((value) => value * (lut.size - 1))
  const low = scaled.map(Math.floor)
  const high = scaled.map((value) => Math.min(lut.size - 1, Math.ceil(value)))
  const fraction = scaled.map((value, channel) => value - low[channel])

  const read = (r: number, g: number, b: number): Rgb => {
    const offset = ((b * lut.size + g) * lut.size + r) * 3
    return [lut.values[offset], lut.values[offset + 1], lut.values[offset + 2]]
  }

  const result: number[] = []
  for (let channel = 0; channel < 3; channel += 1) {
    const c000 = read(low[0], low[1], low[2])[channel]
    const c100 = read(high[0], low[1], low[2])[channel]
    const c010 = read(low[0], high[1], low[2])[channel]
    const c110 = read(high[0], high[1], low[2])[channel]
    const c001 = read(low[0], low[1], high[2])[channel]
    const c101 = read(high[0], low[1], high[2])[channel]
    const c011 = read(low[0], high[1], high[2])[channel]
    const c111 = read(high[0], high[1], high[2])[channel]
    const c00 = mix(c000, c100, fraction[0])
    const c10 = mix(c010, c110, fraction[0])
    const c01 = mix(c001, c101, fraction[0])
    const c11 = mix(c011, c111, fraction[0])
    const c0 = mix(c00, c10, fraction[1])
    const c1 = mix(c01, c11, fraction[1])
    result.push(mix(c0, c1, fraction[2]))
  }
  return result as unknown as Rgb
}
