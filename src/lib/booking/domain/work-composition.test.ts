import { expect, it } from "vitest"
import { formatDurationSeconds, formatWorkComposition, totalWorkCompositionMinutes, totalWorkCompositionSeconds } from "./work-composition"
import { parseProjectLengthSeconds } from "@/lib/chatbot/domain/project-length"

it("multiplies each customer's row and preserves integer seconds", () => {
  const rows = [{ name: "CM", count: 3, durationSeconds: 15 }, { name: "本編", count: 1, durationSeconds: 3630 }]
  expect(totalWorkCompositionSeconds(rows)).toBe(3675)
  expect(totalWorkCompositionMinutes(rows)).toBe(61.25)
  expect(formatDurationSeconds(3675)).toBe("1時間1分15秒")
  expect(formatWorkComposition(rows)).toBe("CM 3本 × 15秒 / 本編 1本 × 1時間30秒")
  expect(parseProjectLengthSeconds("0.25分")).toBe(15)
  expect(parseProjectLengthSeconds("0.001分")).toBeUndefined()
})
it.each([[], [{ count: 0, durationSeconds: 15 }], [{ count: 1.5, durationSeconds: 15 }], [{ count: 1, durationSeconds: 0.5 }], [{ count: 1 }]].map((rows) => ({ rows })))("never guesses invalid or missing duration for %j", ({ rows }) => {
  expect(totalWorkCompositionSeconds(rows)).toBeUndefined()
  expect(totalWorkCompositionMinutes(rows)).toBeUndefined()
})
it("does not hide a missing row duration behind the known subtotal", () => {
  const rows = [{ count: 2, durationSeconds: 15 }, { count: 1 }]
  expect(formatWorkComposition(rows)).toBe("作品1 2本 × 15秒 / 作品2 1本 × 尺未確認")
  expect(totalWorkCompositionSeconds(rows)).toBeUndefined()
})
