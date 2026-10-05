import { expect, it } from "vitest"
import { deadlineForScheduling, deadlineFromMessage, isCalendarDate, isValidDeadlineInput, todayInJapan } from "./deadline"
it("validates actual calendar dates and JST boundaries", () => {
  const now = new Date("2026-09-29T15:00:00Z")
  expect(todayInJapan(now)).toBe("2026-09-30")
  expect(isCalendarDate("2026-02-30")).toBe(false)
  expect(isValidDeadlineInput("2026-09-29", now)).toBe(false)
  expect(isValidDeadlineInput("2026-09-30", now)).toBe(true)
  expect(isValidDeadlineInput("10月末ごろ", now)).toBe(false)
  expect(isValidDeadlineInput("", now)).toBe(false)
  expect(isValidDeadlineInput("未定", now)).toBe(true)
  expect(deadlineFromMessage("納期: 2026-10-10")).toBe("2026-10-10")
})

it("keeps undecided/free text out of calendar calculations", () => {
  expect(deadlineForScheduling("未定")).toBeUndefined()
  expect(deadlineForScheduling("相談したい")).toBeUndefined()
  expect(deadlineForScheduling("10月末ごろ")).toBeUndefined()
  expect(deadlineForScheduling("2026-10-15")).toBe("2026-10-15")
})
