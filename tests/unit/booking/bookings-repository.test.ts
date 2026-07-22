import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    bookingTimeSlot: {
      findMany: mocks.findMany,
    },
  },
}))

import { listAllBookings } from "@/lib/booking/server/calendar-free-busy/bookings-repository"

describe("calendar booking repository", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("lists all confirmed bookings and applies default buffers", async () => {
    mocks.findMany.mockResolvedValue([{
      id: "slot_1",
      bookingGroupId: "group_1",
      startTime: new Date("2026-07-10T01:00:00.000Z"),
      endTime: new Date("2026-07-10T02:00:00.000Z"),
      status: "CONFIRMED",
      bookingGroup: {
        projectTitle: "Project",
        status: "CONFIRMED",
        bufferBeforeHours: null,
        bufferAfterHours: null,
        customer: { userId: "user_1" },
      },
    }])

    await expect(listAllBookings(
      "2026-07-01T00:00:00.000Z",
      "2026-08-01T00:00:00.000Z",
    )).resolves.toEqual([expect.objectContaining({
      id: "slot_1",
      customerUserId: "user_1",
      bufferBeforeHours: 1,
      bufferAfterHours: 1,
    })])
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ bookingGroup: {} }),
    }))
  })
})
