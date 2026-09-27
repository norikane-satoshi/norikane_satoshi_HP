import type { Rgb } from "./cube"

export type SourceTransform = "none" | "slog3-sgamut3cine" | "logc3-awg3"
export type OutputTransform = "none" | "aces-sdr-rec709"

const SGAMUT3_CINE_TO_AP1 = [
  0.6456066, 0.2651138, 0.0892796,
  -0.0184145, 1.0326971, -0.0142826,
  -0.0025823, 0.0178685, 0.9847137,
] as const

const AP0_TO_AP1 = [
  1.4514393161, -0.2365107469, -0.2149285693,
  -0.0765537734, 1.1762296998, -0.0996759264,
  0.0083161484, -0.0060324498, 0.9977163014,
] as const

const AWG3_TO_AP0 = [
  0.680205505106279, 0.236136601606481, 0.0836578932872398,
  0.0854149797421404, 1.01747087860704, -0.102885858349182,
  0.00205652166929683, -0.0625625003847921, 1.06050597871549,
] as const

const AP1_TO_AP0 = [
  0.6954522414, 0.1406786965, 0.1638690622,
  0.0447945634, 0.8596711185, 0.0955343182,
  -0.0055258826, 0.0040252103, 1.0015006723,
] as const

const AP0_TO_REC709 = [
  2.5216498661, -1.1369884775, -0.3846613887,
  -0.275217283, 1.3697118609, -0.094494578,
  -0.0159253025, -0.1478063209, 1.1637316234,
] as const

const multiplyMatrix = (matrix: readonly number[], color: Rgb): Rgb => [
  matrix[0] * color[0] + matrix[1] * color[1] + matrix[2] * color[2],
  matrix[3] * color[0] + matrix[4] * color[1] + matrix[5] * color[2],
  matrix[6] * color[0] + matrix[7] * color[1] + matrix[8] * color[2],
]

const multiplyMatrices = (left: readonly number[], right: readonly number[]) => {
  const result = new Array<number>(9).fill(0)
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      for (let offset = 0; offset < 3; offset += 1) {
        result[row * 3 + column] += left[row * 3 + offset] * right[offset * 3 + column]
      }
    }
  }
  return result
}

const AWG3_TO_AP1 = multiplyMatrices(AP0_TO_AP1, AWG3_TO_AP0)

const slog3ToLinear = (value: number) => {
  const codeValue = value * 1023
  if (codeValue >= 171.2102946929) {
    return 10 ** ((codeValue - 420) / 261.5) * 0.19 - 0.01
  }
  return ((codeValue - 95) * 0.01125) / (171.2102946929 - 95)
}

const logC3ToLinear = (value: number) => {
  const threshold = 5.367655 * 0.0105909904954696 + 0.092809
  if (value > threshold) {
    return (10 ** ((value - 0.385536998692443) / 0.247189638318671) - 0.0522722750251688) / 5.55555555555556
  }
  return (value - 0.092809) / 5.367655
}

const linearToAcesCct = (value: number) => {
  if (value <= 0.0078125) return 10.5402377416545 * value + 0.0729055341958355
  return (Math.log2(value) + 9.72) / 17.52
}

const acesCctToLinear = (value: number) => {
  if (value <= 0.155251141552511) return (value - 0.0729055341958355) / 10.5402377416545
  if (value <= 1.468) return 2 ** (value * 17.52 - 9.72)
  return 65504
}

export function applySourceTransform(rgb: Rgb, transform: SourceTransform): Rgb {
  if (transform === "none") return rgb
  const decoder = transform === "slog3-sgamut3cine" ? slog3ToLinear : logC3ToLinear
  const matrix = transform === "slog3-sgamut3cine" ? SGAMUT3_CINE_TO_AP1 : AWG3_TO_AP1
  const ap1 = multiplyMatrix(matrix, rgb.map(decoder) as unknown as Rgb)
  return ap1.map(linearToAcesCct) as unknown as Rgb
}

const toneScale = (value: number) => {
  if (value <= 0) return 0
  return value / (0.18 + value)
}

export function applyOutputTransform(rgb: Rgb, transform: OutputTransform): Rgb {
  if (transform === "none") return rgb
  const linearAp1 = rgb.map(acesCctToLinear) as unknown as Rgb
  const ap0 = multiplyMatrix(AP1_TO_AP0, linearAp1)
  const rec709 = multiplyMatrix(AP0_TO_REC709, ap0)
  return rec709.map(toneScale) as unknown as Rgb
}

export const clampRgb = (rgb: Rgb): Rgb => rgb.map((value) =>
  Math.max(0, Math.min(1, value)),
) as unknown as Rgb
