import { afterEach, describe, expect, it, vi } from "vitest"

import { getBookingBlockStyle, getBookingColorLabel, getBookingCSSColor } from "@/lib/booking/booking-colors"
import {
  formatMonth,
  formatWeek,
  getCalendarDays,
  getCurrentDateKey,
  getCurrentMonth,
  getMonthFromDate,
  getWeekDays,
  groupBookingsByDate,
  navigateDay,
  navigateMonth,
  navigateWeek,
  normalizeCalendarDate,
  splitIntoWeeks,
} from "@/lib/booking/calendar-utils"
import { clearDraft, hasDraft, loadDraft, saveDraft } from "@/lib/booking/draft-storage"
import { getResendClient, sendBookingConfirmedEmail } from "@/lib/booking/email"
import {
  createDefaultBookingFormData,
  formatDurationMinutes,
  getSlotDurationMinutes,
  getTotalDurationMinutes,
} from "@/lib/booking/form-schema"
import { getHolidayName, isJapaneseHoliday } from "@/lib/booking/holidays"
import {
  calculateCopyData,
  calculateTimedMoveData,
  calculateTimedResizeData,
  moveSlotByDates,
} from "@/lib/booking/slot-operations"
import {
  assignWeekBookingLanes,
  getWeekBookingPlacements,
  getWeekTimeWindow,
  getWeekTimeWindowFromPlacements,
} from "@/lib/booking/week-calendar-utils"

function storage() {
  const map = new Map<string, string>()
  return {
    getItem: vi.fn((key: string) => map.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      map.set(key, value)
    }),
    removeItem: vi.fn((key: string) => {
      map.delete(key)
    }),
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe("calendar utilities", () => {
  it("normalizes months, dates, navigation, and week/month labels", () => {
    expect(formatMonth("2026-06")).toBe("2026年6月")
    expect(normalizeCalendarDate("2026-06-10")).toBe("2026-06-10")
    expect(normalizeCalendarDate("2026-6-10")).toBeNull()
    expect(getMonthFromDate("2026-06-10")).toBe("2026-06")
    expect(navigateDay("2026-06-10", 1)).toBe("2026-06-11")
    expect(navigateWeek("2026-06-10", 1)).toBe("2026-06-17")
    expect(navigateMonth("2026-12", 1)).toBe("2027-01")
    expect(formatWeek("2026-06-10")).toBe("2026年6月7日 - 13日")
    expect(formatWeek("2026-06-30")).toBe("2026年6月28日 - 7月4日")
    expect(formatWeek("2026-12-31")).toBe("2026年12月27日 - 2027年1月2日")

    const days = getCalendarDays("2026-06")
    expect(days[0]?.getDay()).toBe(0)
    expect(splitIntoWeeks(days).every((week) => week.length === 7)).toBe(true)
    expect(getWeekDays("bad-date")).toHaveLength(7)
    expect(getCurrentDateKey()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(getCurrentMonth()).toMatch(/^\d{4}-\d{2}$/)
  })

  it("groups multi-day bookings by date and sorts per day", () => {
    const first = {
      startTime: new Date("2026-06-10T04:00:00.000Z"),
      endTime: new Date("2026-06-10T05:00:00.000Z"),
    }
    const multi = {
      startTime: new Date("2026-06-10T01:00:00.000Z"),
      endTime: new Date("2026-06-11T02:00:00.000Z"),
    }

    const grouped = groupBookingsByDate([first, multi])

    expect(grouped.get("2026-06-10")).toEqual([multi, first])
    expect(grouped.get("2026-06-11")).toEqual([multi])
  })
})

describe("week calendar utilities", () => {
  it("assigns lanes for overlapping placements", () => {
    const placements = assignWeekBookingLanes([
      {
        booking: { startTime: "2026-06-10T01:00:00.000Z", endTime: "2026-06-10T02:00:00.000Z" },
        dateKey: "2026-06-10",
        startMinute: 60,
        endMinute: 120,
        continuesBefore: false,
        continuesAfter: false,
      },
      {
        booking: { startTime: "2026-06-10T01:30:00.000Z", endTime: "2026-06-10T02:30:00.000Z" },
        dateKey: "2026-06-10",
        startMinute: 90,
        endMinute: 150,
        continuesBefore: false,
        continuesAfter: false,
      },
    ])

    expect(placements.map((placement) => placement.laneCount)).toEqual([2, 2])
    expect(placements.map((placement) => placement.laneIndex)).toEqual([0, 1])
  })

  it("reuses week lanes for non-overlapping placements and sorts equal starts by end time", () => {
    const placements = assignWeekBookingLanes([
      {
        booking: { startTime: "2026-06-10T01:00:00.000Z", endTime: "2026-06-10T03:00:00.000Z" },
        dateKey: "2026-06-10",
        startMinute: 60,
        endMinute: 180,
        continuesBefore: false,
        continuesAfter: false,
      },
      {
        booking: { startTime: "2026-06-10T01:00:00.000Z", endTime: "2026-06-10T02:00:00.000Z" },
        dateKey: "2026-06-10",
        startMinute: 60,
        endMinute: 120,
        continuesBefore: false,
        continuesAfter: false,
      },
      {
        booking: { startTime: "2026-06-10T03:00:00.000Z", endTime: "2026-06-10T04:00:00.000Z" },
        dateKey: "2026-06-10",
        startMinute: 180,
        endMinute: 240,
        continuesBefore: false,
        continuesAfter: false,
      },
    ])

    expect(placements.map((placement) => placement.endMinute)).toEqual([120, 180, 240])
    expect(placements[2]?.laneIndex).toBe(0)
    expect(assignWeekBookingLanes([])).toEqual([])
  })

  it("splits bookings across week days and derives padded time windows", () => {
    const placements = getWeekBookingPlacements(
      [
        {
          startTime: new Date(2026, 5, 9, 23, 0, 0),
          endTime: new Date(2026, 5, 10, 2, 0, 0),
        },
      ],
      "2026-06-10",
    )

    expect(placements.get("2026-06-09")?.[0]?.continuesAfter).toBe(true)
    expect(placements.get("2026-06-10")?.[0]?.continuesBefore).toBe(true)
    expect(getWeekTimeWindow([], "2026-06-10")).toEqual({ startMinute: 480, endMinute: 1200 })
    expect(getWeekTimeWindowFromPlacements(placements).startMinute).toBe(0)
  })

  it("drops bookings outside the visible week and handles midnight endings", () => {
    const placements = getWeekBookingPlacements(
      [
        {
          startTime: new Date(2026, 5, 1, 1, 0, 0),
          endTime: new Date(2026, 5, 1, 2, 0, 0),
        },
        {
          startTime: new Date(2026, 5, 10, 22, 0, 0),
          endTime: new Date(2026, 5, 11, 0, 0, 0),
        },
      ],
      "2026-06-10",
    )

    expect(Array.from(placements.values()).flat()).toHaveLength(1)
    expect(placements.get("2026-06-10")?.[0]).toMatchObject({
      startMinute: 1320,
      endMinute: 1440,
    })
  })
})

describe("booking display helpers", () => {
  it("formats booking colors and labels", () => {
    expect(getBookingCSSColor({ status: "AVAILABLE" })).toContain("accent-primary")
    expect(getBookingCSSColor({ status: "MEETING" })).toContain("text-primary")
    expect(getBookingCSSColor({ status: "CONFIRMED" })).toBe("var(--accent-primary)")
    expect(getBookingCSSColor({ status: "CANCELLED" })).toBe("transparent")
    expect(getBookingColorLabel({ status: "CONFIRMED", hasAttendance: true })).toBe("確定（立会いあり）")
    expect(getBookingColorLabel({ status: "CONFIRMED" })).toBe("確定")
    expect(getBookingColorLabel({ status: "HOLIDAY" })).toBe("休暇・NG")
    expect(getBookingColorLabel({ status: "MEETING" })).toBe("社内")
    expect(getBookingColorLabel({ status: "OTHER" })).toBe("予定")
    expect(getBookingBlockStyle({ status: "CANCELLED" }).className).toBe("glass-flat")
    expect(getBookingBlockStyle({ status: "MEETING", hasAttendance: true })).toMatchObject({
      className: "glass-card-sm",
      label: "立会い",
    })
    const displayed = getBookingBlockStyle({ status: "CONFIRMED" }, { isActualDisplayed: true })
    expect(displayed).toMatchObject({ className: "glass-inset" })
    expect(displayed).not.toHaveProperty("opacity")
    expect(getBookingBlockStyle({ status: "CONFIRMED" }, { isActualDisplayed: true, isActualPending: true })).toMatchObject({
      className: "glass-inset",
      opacity: "0.4",
      label: null,
    })
  })

  it("calculates slot movement and resize data", () => {
    const slot = {
      start: "2026-06-10T01:00:00.000Z",
      end: "2026-06-10T03:00:00.000Z",
    }

    expect(calculateCopyData(slot, new Date("2026-06-12T00:00:00.000Z")).start).toContain("2026-06-12")
    const moved = calculateTimedMoveData(slot, new Date("2026-06-12T00:00:00.000Z"), 9 * 60)
    expect(moved).not.toBeNull()
    expect(new Date(moved!.end).getTime() - new Date(moved!.start).getTime()).toBe(2 * 60 * 60 * 1000)
    expect(calculateTimedMoveData(slot, new Date("2026-06-12T00:00:00.000Z"), 23 * 60)).toBeNull()
    const resizedStart = calculateTimedResizeData(slot, "start", 0)
    const resizedEnd = calculateTimedResizeData(slot, "end", 14 * 60)
    expect(resizedStart?.start).toBeTruthy()
    expect(resizedEnd?.end).toBeTruthy()
    expect(calculateTimedResizeData(slot, "end", 0)).toBeNull()
    expect(moveSlotByDates(slot, new Date("2026-06-13T01:00:00.000Z"), new Date("2026-06-13T02:00:00.000Z"))).toEqual({
      start: "2026-06-13T01:00:00.000Z",
      end: "2026-06-13T02:00:00.000Z",
    })
  })
})

describe("form, draft, holiday, and email helpers", () => {
  it("formats booking form defaults and durations", () => {
    expect(createDefaultBookingFormData("satoshi@example.com").sessionEmail).toBe("satoshi@example.com")
    expect(getSlotDurationMinutes({ start: "bad", end: "2026-06-10T01:00:00.000Z" })).toBe(0)
    expect(getTotalDurationMinutes([
      { start: "2026-06-10T01:00:00.000Z", end: "2026-06-10T02:30:00.000Z" },
      { start: "2026-06-10T03:00:00.000Z", end: "2026-06-10T03:30:00.000Z" },
    ])).toBe(120)
    expect(formatDurationMinutes(0)).toBe("0 時間")
    expect(formatDurationMinutes(30)).toBe("30 分")
    expect(formatDurationMinutes(120)).toBe("2 時間")
    expect(formatDurationMinutes(150)).toBe("2 時間 30 分")
  })

  it("saves, loads, expires, and clears booking drafts", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-06-10T00:00:00.000Z"))
    const localStorage = storage()
    const sessionStorage = storage()
    vi.stubGlobal("window", { localStorage, sessionStorage })

    const formData = createDefaultBookingFormData("satoshi@example.com")
    saveDraft("user_1", {
      formData,
      selectedSlots: [],
      step: "calendar",
    })

    expect(loadDraft("user_1", "session")?.formData.sessionEmail).toBe("satoshi@example.com")
    expect(hasDraft("user_1")).toBe(true)

    vi.setSystemTime(new Date("2026-06-11T01:00:01.000Z"))
    expect(loadDraft("user_1", "local")).toBeNull()

    saveDraft("user_1", {
      formData,
      selectedSlots: [],
      step: "form",
    })
    clearDraft("user_1")
    expect(loadDraft("user_1")).toBeNull()
  })

  it("migrates legacy single-selectedSlot drafts into selectedSlots", () => {
    const localStorage = storage()
    const sessionStorage = storage()
    vi.stubGlobal("window", { localStorage, sessionStorage })

    const formData = createDefaultBookingFormData("legacy@example.com")
    const legacySlot = {
      startTime: "2026-06-10T09:00:00.000Z",
      endTime: "2026-06-10T10:00:00.000Z",
    }
    const legacyPayload = JSON.stringify({
      formData,
      selectedSlot: legacySlot,
      step: "form",
      savedAt: Date.now(),
    })
    sessionStorage.setItem("booking-draft-session", legacyPayload)

    const restored = loadDraft("legacy_user", "session")
    expect(restored?.selectedSlots).toEqual([legacySlot])
  })

  it("recognizes Japanese holidays", () => {
    expect(isJapaneseHoliday(new Date(2026, 0, 1))).toBe(true)
    expect(getHolidayName(new Date(2026, 0, 1))).toBe("元日")
    expect(isJapaneseHoliday(new Date(2026, 0, 2))).toBe(false)
    expect(getHolidayName(new Date(2026, 0, 2))).toBeNull()
  })

  it("skips booking email when Resend is not configured", async () => {
    const previous = process.env.RESEND_API_KEY
    delete process.env.RESEND_API_KEY

    expect(getResendClient()).toBeNull()
    await expect(sendBookingConfirmedEmail({
      to: "satoshi@example.com",
      projectTitle: "Project",
      start: "2026-06-10T01:00:00.000Z",
      end: "2026-06-10T02:00:00.000Z",
      workScopes: ["grading"],
      otherWorkDetail: "detail",
      estimatedDuration: "consult",
    })).resolves.toEqual({ skipped: true })

    if (previous) process.env.RESEND_API_KEY = previous
  })
})
