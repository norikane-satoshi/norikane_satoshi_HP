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
  resolveConflictForFinalSubmit,
} from "@/lib/booking/domain/conflicts"
import {
  findConflictingBookings,
  type ConflictBooking,
} from "@/lib/booking/server/conflicts"

function conflict(overrides: Partial<ConflictBooking> = {}): ConflictBooking {
  const now = new Date("2026-06-10T00:00:00.000Z")
  return {
    id: "slot_1",
    bookingGroupId: "group_1",
    startTime: new Date("2026-06-10T01:00:00.000Z"),
    endTime: new Date("2026-06-10T02:00:00.000Z"),
    previousStartTime: null,
    previousEndTime: null,
    status: "CONFIRMED",
    createdAt: now,
    updatedAt: now,
    bookingGroup: {
      id: "group_1",
      customerId: "customer_1",
      teamId: null,
      status: "CONFIRMED",
      projectTitle: "Booked",
      memo: null,
      contactName: "Satoshi",
      companyName: null,
      customerEmail: null,
      phone: null,
      dueDate: null,
      pendingExpiresAt: null,
      bufferBeforeHours: 1,
      bufferAfterHours: 1,
      gcalEventId: null,
      notionPageId: null,
      originatedFrom: null,
      lineUserId: null,
      chatConversationId: null,
      createdAt: now,
      updatedAt: now,
      customer: {
        displayName: "Satoshi",
        user: { email: "satoshi@example.com" },
      },
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
          pendingExpiresAt: null,
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
          pendingExpiresAt: null,
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
          status: { in: ["PENDING_GCAL", "CONFIRMED"] },
          bookingGroup: expect.objectContaining({
            status: { in: ["PENDING_GCAL", "CONFIRMED"] },
            OR: expect.arrayContaining([
              { pendingExpiresAt: null },
              { pendingExpiresAt: { gt: expect.any(Date) } },
            ]),
          }),
        }),
      }),
    )
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      id: "slot_1",
      bookingGroupId: "group_1",
      status: "CONFIRMED",
      bookingGroup: expect.objectContaining({
        status: "CONFIRMED",
        projectTitle: "Project",
      }),
    })
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

  it("omits excludeBookingId when no exclusion is requested", async () => {
    mocks.prisma.bookingTimeSlot.findMany.mockResolvedValue([])

    await findConflictingBookings(
      new Date("2026-06-10T01:00:00.000Z"),
      new Date("2026-06-10T02:00:00.000Z"),
    )

    expect(mocks.prisma.bookingTimeSlot.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.not.objectContaining({ id: expect.anything() }),
      }),
    )
  })

  it("filters expired PENDING_GCAL holds out of conflicts", async () => {
    mocks.prisma.bookingTimeSlot.findMany.mockResolvedValue([
      {
        id: "slot_expired",
        bookingGroupId: "group_expired",
        startTime: new Date("2026-06-10T01:00:00.000Z"),
        endTime: new Date("2026-06-10T02:00:00.000Z"),
        status: "PENDING_GCAL",
        bookingGroup: {
          status: "PENDING_GCAL",
          pendingExpiresAt: new Date("2026-05-19T00:00:00.000Z"),
          projectTitle: "Expired",
          memo: null,
          gcalEventId: null,
          customer: {
            displayName: "Satoshi",
            user: { email: "satoshi@example.com" },
          },
        },
      },
    ])

    await expect(
      findConflictingBookings(
        new Date("2026-06-10T01:00:00.000Z"),
        new Date("2026-06-10T02:00:00.000Z"),
      ),
    ).resolves.toEqual([])
  })

  it.each([
    ["complete match", "2026-06-10T01:00:00.000Z", "2026-06-10T02:00:00.000Z"],
    ["one second overlap at start", "2026-06-10T00:59:59.000Z", "2026-06-10T01:00:01.000Z"],
    ["one second overlap at end", "2026-06-10T01:59:59.000Z", "2026-06-10T02:00:01.000Z"],
  ])("maps confirmed group conflicts for %s", async (_label, start, end) => {
    mocks.prisma.bookingTimeSlot.findMany.mockResolvedValue([
      {
        id: "slot_1",
        bookingGroupId: "group_1",
        startTime: new Date("2026-06-10T01:00:00.000Z"),
        endTime: new Date("2026-06-10T02:00:00.000Z"),
        status: "CONFIRMED",
        bookingGroup: {
          status: "CONFIRMED",
          pendingExpiresAt: null,
          projectTitle: "Project",
          memo: null,
          gcalEventId: null,
          customer: {
            displayName: "Satoshi",
            user: { email: "satoshi@example.com" },
          },
        },
      },
    ])

    const result = await findConflictingBookings(new Date(start), new Date(end))

    expect(result).toHaveLength(1)
    expect(mocks.prisma.bookingTimeSlot.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          startTime: { lt: new Date(end) },
          endTime: { gt: new Date(start) },
        }),
      }),
    )
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

  it("treats exact two-hour buffer boundaries as caller-owned preflight data", () => {
    const existing = conflict()
    const exactlyBefore = new Date(existing.startTime.getTime() - 2 * 60 * 60 * 1000)
    const oneMsInsideBefore = new Date(exactlyBefore.getTime() + 1)
    const exactlyAfter = new Date(existing.endTime.getTime() + 2 * 60 * 60 * 1000)
    const oneMsInsideAfter = new Date(exactlyAfter.getTime() - 1)

    expect(exactlyBefore.toISOString()).toBe("2026-06-09T23:00:00.000Z")
    expect(oneMsInsideBefore.toISOString()).toBe("2026-06-09T23:00:00.001Z")
    expect(exactlyAfter.toISOString()).toBe("2026-06-10T04:00:00.000Z")
    expect(oneMsInsideAfter.toISOString()).toBe("2026-06-10T03:59:59.999Z")
    expect(resolveConflictForFinalSubmit([])).toBeNull()
    expect(resolveConflictForFinalSubmit([existing])).toBe("slot_taken")
  })
})
