import { eachDayOfInterval, endOfDay, format, startOfDay } from "date-fns"

import { getWeekDays, type BookingWithRelations } from "@/lib/booking/calendar-utils"

interface WeekBookingPlacement {
  booking: BookingWithRelations
  dateKey: string
  startMinute: number
  endMinute: number
  laneIndex: number
  laneCount: number
  continuesBefore: boolean
  continuesAfter: boolean
}

export interface WeekBookingPlacementDraft {
  booking: BookingWithRelations
  dateKey: string
  startMinute: number
  endMinute: number
  continuesBefore: boolean
  continuesAfter: boolean
}

interface WeekTimeWindow {
  startMinute: number
  endMinute: number
}

const DEFAULT_WEEK_START_MINUTE = 8 * 60
const DEFAULT_WEEK_END_MINUTE = 20 * 60

function clampMinute(value: number): number {
  return Math.max(0, Math.min(24 * 60, value))
}

function toMinuteOffset(date: Date, dayStart: Date, mode: "start" | "end"): number {
  const rawMinutes = (date.getTime() - dayStart.getTime()) / (60 * 1000)
  return clampMinute(mode === "start" ? Math.floor(rawMinutes) : Math.ceil(rawMinutes))
}

function splitBookingAcrossWeek(
  booking: BookingWithRelations,
  weekDays: Date[],
): WeekBookingPlacementDraft[] {
  if (weekDays.length === 0) return []

  const bookingStart = new Date(booking.startTime)
  const bookingEnd = new Date(booking.endTime)
  const weekStart = startOfDay(weekDays[0])
  const weekEnd = endOfDay(weekDays[weekDays.length - 1])

  if (bookingEnd <= weekStart || bookingStart >= weekEnd) {
    return []
  }

  const visibleStart = bookingStart > weekStart ? bookingStart : weekStart
  const visibleEnd = bookingEnd < weekEnd ? bookingEnd : weekEnd

  const effectiveVisibleEnd =
    visibleEnd.getTime() === startOfDay(visibleEnd).getTime()
      ? new Date(visibleEnd.getTime() - 1)
      : visibleEnd

  const segmentDays = eachDayOfInterval({
    start: startOfDay(visibleStart),
    end: startOfDay(effectiveVisibleEnd),
  })

  return segmentDays.flatMap((day) => {
    const dayStart = startOfDay(day)
    const dayEnd = endOfDay(day)
    const segmentStart = visibleStart > dayStart ? visibleStart : dayStart
    const segmentEnd = visibleEnd < dayEnd ? visibleEnd : dayEnd
    const startMinute = toMinuteOffset(segmentStart, dayStart, "start")
    const endMinute = Math.max(startMinute + 1, toMinuteOffset(segmentEnd, dayStart, "end"))

    return [
      {
        booking,
        dateKey: format(day, "yyyy-MM-dd"),
        startMinute,
        endMinute,
        continuesBefore: bookingStart < dayStart,
        continuesAfter: bookingEnd > dayEnd,
      },
    ]
  })
}

export function assignWeekBookingLanes(
  placements: WeekBookingPlacementDraft[],
): WeekBookingPlacement[] {
  if (placements.length === 0) return []

  const sorted = [...placements].sort((a, b) => {
    const startDiff = a.startMinute - b.startMinute
    if (startDiff !== 0) return startDiff
    return a.endMinute - b.endMinute
  })

  const result: WeekBookingPlacement[] = []
  let cluster: WeekBookingPlacementDraft[] = []
  let clusterMaxEnd = -1

  const flushCluster = () => {
    if (cluster.length === 0) return

    const laneEnds: number[] = []
    const placedCluster = cluster.map((placement) => {
      let laneIndex = laneEnds.findIndex((laneEnd) => laneEnd <= placement.startMinute)
      if (laneIndex === -1) {
        laneIndex = laneEnds.length
        laneEnds.push(placement.endMinute)
      } else {
        laneEnds[laneIndex] = placement.endMinute
      }

      return {
        ...placement,
        laneIndex,
        laneCount: 0,
      }
    })

    const laneCount = Math.max(1, laneEnds.length)
    result.push(
      ...placedCluster.map((placement) => ({
        ...placement,
        laneCount,
      })),
    )

    cluster = []
    clusterMaxEnd = -1
  }

  sorted.forEach((placement) => {
    if (cluster.length === 0) {
      cluster = [placement]
      clusterMaxEnd = placement.endMinute
      return
    }

    if (placement.startMinute < clusterMaxEnd) {
      cluster.push(placement)
      clusterMaxEnd = Math.max(clusterMaxEnd, placement.endMinute)
      return
    }

    flushCluster()
    cluster = [placement]
    clusterMaxEnd = placement.endMinute
  })

  flushCluster()

  return result
}

export function getWeekBookingPlacements(
  bookings: BookingWithRelations[],
  currentDate: string,
): Map<string, WeekBookingPlacement[]> {
  const weekDays = getWeekDays(currentDate)
  const placementsByDate = new Map<string, WeekBookingPlacementDraft[]>()

  weekDays.forEach((day) => {
    placementsByDate.set(format(day, "yyyy-MM-dd"), [])
  })

  bookings.forEach((booking) => {
    splitBookingAcrossWeek(booking, weekDays).forEach((placement) => {
      const list = placementsByDate.get(placement.dateKey)
      if (!list) return
      list.push(placement)
    })
  })

  return new Map(
    Array.from(placementsByDate.entries()).map(([dateKey, placements]) => [
      dateKey,
      assignWeekBookingLanes(placements),
    ]),
  )
}

function getWeekTimeWindow(bookings: BookingWithRelations[], currentDate: string): WeekTimeWindow {
  return getWeekTimeWindowFromPlacements(getWeekBookingPlacements(bookings, currentDate))
}

export function getWeekTimeWindowFromPlacements(
  placementsByDate: Map<string, WeekBookingPlacement[]>,
): WeekTimeWindow {
  let earliestStart = Number.POSITIVE_INFINITY
  let latestEnd = Number.NEGATIVE_INFINITY

  placementsByDate.forEach((placements) => {
    placements.forEach((placement) => {
      earliestStart = Math.min(earliestStart, placement.startMinute)
      latestEnd = Math.max(latestEnd, placement.endMinute)
    })
  })

  if (!Number.isFinite(earliestStart) || !Number.isFinite(latestEnd)) {
    return {
      startMinute: DEFAULT_WEEK_START_MINUTE,
      endMinute: DEFAULT_WEEK_END_MINUTE,
    }
  }

  const paddedStart = clampMinute(
    Math.floor(Math.min(DEFAULT_WEEK_START_MINUTE, earliestStart - 60) / 60) * 60,
  )
  const paddedEnd = clampMinute(
    Math.ceil(Math.max(DEFAULT_WEEK_END_MINUTE, latestEnd + 60) / 60) * 60,
  )

  return {
    startMinute: paddedStart,
    endMinute: Math.max(paddedStart + 60, paddedEnd),
  }
}

export { getWeekTimeWindow }
