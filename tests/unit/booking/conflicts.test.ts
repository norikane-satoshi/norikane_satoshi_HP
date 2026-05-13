import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  prisma: {
    bookingTimeSlot: {
      findMany: vi.fn(),
    },
  },
}))

vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }))

import {
  evaluateConflicts,
  findConflictingBookings,
  resolveConflictForFinalSubmit,
  type ConflictBooking,
} from "@/lib/booking/conflicts"

function conflict(overrides: Partial<ConflictBooking> = {}): ConflictBooking {
  return {
    id: "slot_1",
    bookingGroupId: "group_1",
    startTime: new Date("2026-06-10T01:00:00.000Z"),
    endTime: new Date("2026-06-10T02:00:00.000Z"),
    title: "Booked",
    status: "CONFIRMED",
    memo: null,
    gcalEventId: null,
    customer: {
      displayName: "Satoshi",
      user: { email: "satoshi@example.com" },
    },
    ...overrides,
  }
}

describe("findConflictingBookings", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("queries overlapping CONFIRMED slots and maps confirmed groups", async () => {
    mocks.prisma.bookingTimeSlot.findMany.mockResolvedValue([
      {
        id: "slot_1",
        bookingGroupId: "group_1",
        startTime: new Date("2026-06-10T01:00:00.000Z"),
        endTime: new Date("2026-06-10T02:00:00.000Z"),
        status: "CONFIRMED",
        bookingGroup: {
          status: "CONFIRMED",
          projectTitle: "Project",
          memo: "memo",
          gcalEventId: "gcal_1",
          customer: {
            displayName: "Satoshi",
            user: { email: "satoshi@example.com" },
          },
        },
      },
      {
        id: "slot_2",
        bookingGroupId: "group_2",
        startTime: new Date("2026-06-10T03:00:00.000Z"),
        endTime: new Date("2026-06-10T04:00:00.000Z"),
        status: "CONFIRMED",
        bookingGroup: {
          status: "CANCELLED",
          projectTitle: "Cancelled",
          memo: null,
          gcalEventId: null,
          customer: {
            displayName: "Other",
            user: { email: "other@example.com" },
          },
        },
      },
    ])

    const result = await findConflictingBookings(
      new Date("2026-06-10T01:30:00.000Z"),
      new Date("2026-06-10T02:30:00.000Z"),
      { excludeBookingId: "slot_old" },
    )

    expect(mocks.prisma.bookingTimeSlot.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { not: "slot_old" },
          startTime: { lt: new Date("2026-06-10T02:30:00.000Z") },
          endTime: { gt: new Date("2026-06-10T01:30:00.000Z") },
          status: "CONFIRMED",
        }),
      }),
    )
    expect(result).toEqual([
      expect.objectContaining({
        id: "slot_1",
        bookingGroupId: "group_1",
        title: "Project",
        status: "CONFIRMED",
      }),
    ])
  })

  it("returns no conflicts when Prisma returns no overlap", async () => {
    mocks.prisma.bookingTimeSlot.findMany.mockResolvedValue([])

    await expect(
      findConflictingBookings(
        new Date("2026-06-10T04:00:00.000Z"),
        new Date("2026-06-10T05:00:00.000Z"),
      ),
    ).resolves.toEqual([])
  })
})

describe("conflict verdicts", () => {
  it("blocks overlapping conflicts", () => {
    const conflicts = [conflict()]

    expect(evaluateConflicts(conflicts)).toEqual({ kind: "block", code: "slot_taken" })
    expect(resolveConflictForFinalSubmit(conflicts)).toBe("slot_taken")
  })

  it("allows no-overlap submissions", () => {
    expect(evaluateConflicts([])).toEqual({ kind: "ok" })
    expect(resolveConflictForFinalSubmit([])).toBeNull()
  })

  it("allows slots outside the existing CONFIRMED booking interval", () => {
    const existing = conflict()
    const nextStart = new Date("2026-06-10T04:01:00.000Z")

    expect(existing.endTime.getTime() + 2 * 60 * 60 * 1000 < nextStart.getTime()).toBe(true)
    expect(resolveConflictForFinalSubmit([])).toBeNull()
  })
})
