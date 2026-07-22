import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  prisma: {
    bookingGroup: {
      findMany: vi.fn(),
    },
  },
}))

vi.mock("@/auth", () => ({ auth: mocks.auth }))
vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }))

import { GET } from "@/app/api/booking/history/route"

describe("GET /api/booking/history", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns 401 when unauthenticated", async () => {
    mocks.auth.mockResolvedValue(null)

    const response = await GET()

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" })
    expect(mocks.prisma.bookingGroup.findMany).not.toHaveBeenCalled()
  })

  it("returns the authenticated user's booking history", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "user_1", email: "satoshi@example.com" } })
    mocks.prisma.bookingGroup.findMany.mockResolvedValue([
      {
        id: "group_1",
        createdAt: new Date("2026-07-02T10:00:00.000Z"),
        status: "NEEDS_SCHEDULE",
        projectTitle: "Long consultation",
        contactName: "Satoshi",
        companyName: "NCS",
        memo: "共有事項\n希望日: 7/10(金)、1日間",
        customerEmail: "satoshi@example.com",
        timeSlots: [],
      },
      {
        id: "group_2",
        createdAt: new Date("2026-07-02T11:00:00.000Z"),
        status: "CONFIRMED",
        projectTitle: "Confirmed booking",
        contactName: "Satoshi",
        companyName: null,
        memo: null,
        customerEmail: "satoshi@example.com",
        timeSlots: [{ startTime: new Date("2026-07-12T01:00:00.000Z") }],
      },
      ...[
        ["PENDING_GCAL", "連携中"],
        ["FAILED", "要確認"],
        ["CANCELLED", "キャンセル"],
        ["CUSTOM", "CUSTOM"],
      ].map(([status], index) => ({
        id: `group_${index + 3}`,
        createdAt: new Date(`2026-07-${String(index + 3).padStart(2, "0")}T10:00:00.000Z`),
        status,
        projectTitle: status,
        contactName: "Satoshi",
        companyName: null,
        memo: index === 0 ? "希望日:   " : null,
        customerEmail: null,
        timeSlots: [],
      })),
    ])

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(mocks.prisma.bookingGroup.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { customer: { userId: "user_1" } },
    }))
    expect(body.bookings.slice(0, 2)).toMatchObject([
      {
        id: "group_1",
        statusLabel: "受付済み",
        requestedDates: ["7/10(金)、1日間"],
      },
      {
        id: "group_2",
        statusLabel: "日程確定",
        requestedDates: ["2026-07-12"],
      },
    ])
    expect(body.bookings.slice(2).map((booking: { statusLabel: string }) => booking.statusLabel)).toEqual([
      "連携中",
      "要確認",
      "キャンセル",
      "CUSTOM",
    ])
    expect(body.bookings.slice(2).every((booking: { requestedDates: string[] }) => booking.requestedDates.length === 0)).toBe(true)
  })
})
