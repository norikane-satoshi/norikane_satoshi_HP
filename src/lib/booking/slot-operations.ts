import { addMilliseconds, differenceInMilliseconds } from "date-fns"

export type Slot = {
  start: string
  end: string
}

function replaceDateKeepTime(original: Date, targetDate: Date): Date {
  const result = new Date(original)
  result.setFullYear(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate())
  return result
}

function replaceTimeKeepDate(original: Date, totalMinutes: number): Date {
  const result = new Date(original)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  result.setHours(hours, minutes, 0, 0)
  return result
}

function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

export function calculateCopyData(slot: Slot, targetDate: Date): Slot {
  const originalStart = new Date(slot.start)
  const originalEnd = new Date(slot.end)
  const durationMs = differenceInMilliseconds(originalEnd, originalStart)
  const newStart = replaceDateKeepTime(originalStart, targetDate)
  const newEnd = addMilliseconds(newStart, durationMs)
  return {
    start: newStart.toISOString(),
    end: newEnd.toISOString(),
  }
}

export function calculateTimedMoveData(
  slot: Slot,
  targetDate: Date,
  targetStartMinutes: number,
): Slot | null {
  const originalStart = new Date(slot.start)
  const originalEnd = new Date(slot.end)
  const durationMs = differenceInMilliseconds(originalEnd, originalStart)

  const newStart = replaceTimeKeepDate(
    replaceDateKeepTime(originalStart, targetDate),
    targetStartMinutes,
  )
  const newEnd = addMilliseconds(newStart, durationMs)

  if (!isSameLocalDay(newStart, newEnd)) return null

  return {
    start: newStart.toISOString(),
    end: newEnd.toISOString(),
  }
}

export function calculateTimedResizeData(
  slot: Slot,
  edge: "start" | "end",
  targetMinutes: number,
): Partial<Slot> | null {
  const originalStart = new Date(slot.start)
  const originalEnd = new Date(slot.end)

  if (!isSameLocalDay(originalStart, originalEnd)) return null

  if (edge === "start") {
    const newStart = replaceTimeKeepDate(originalStart, targetMinutes)
    if (!isSameLocalDay(newStart, originalEnd) || newStart >= originalEnd) return null
    return { start: newStart.toISOString() }
  }

  const newEnd = replaceTimeKeepDate(originalEnd, targetMinutes)
  if (!isSameLocalDay(originalStart, newEnd) || originalStart >= newEnd) return null
  return { end: newEnd.toISOString() }
}

export function moveSlotByDates(
  slot: Slot,
  newStart: Date,
  newEnd: Date,
): Slot {
  return {
    start: newStart.toISOString(),
    end: newEnd.toISOString(),
  }
}
