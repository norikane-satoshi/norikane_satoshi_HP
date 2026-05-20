import { expect, test } from "@playwright/test"

import {
  addSessionCookie,
  cleanupBookingE2E,
  createBookingForUser,
  createTeamWithMembers,
  hasBooking,
  jsonRequest,
  prismaForE2E,
  sessionCookieFor,
  upsertUser,
  type BookingJson,
} from "./booking-test-utils"

const prefix = `booking-leave-${Date.now()}`

test.describe("booking team leave", () => {
  test("member leaves a channel without deleting personal booking history", async ({ page, request }) => {
    const prisma = prismaForE2E()
    const userA = await upsertUser(prisma, `${prefix}-a@example.com`, "Leave A")
    const userB = await upsertUser(prisma, `${prefix}-b@example.com`, "Leave B")

    try {
      const team = await createTeamWithMembers(prisma, {
        name: `${prefix} channel`,
        owner: userA,
        members: [userB],
      })
      const bookingA = await createBookingForUser(prisma, userA, {
        prefix,
        label: "A booking",
        start: "2026-05-25T01:00:00.000Z",
        end: "2026-05-25T02:00:00.000Z",
      })
      const bookingB = await createBookingForUser(prisma, userB, {
        prefix,
        label: "B booking",
        start: "2026-05-26T01:00:00.000Z",
        end: "2026-05-26T02:00:00.000Z",
      })

      await addSessionCookie(page.context(), userB)
      await page.goto("/booking/settings")
      await expect(page.locator("#team-select")).toContainText(team.name)
      await page.getByRole("button", { name: "抜ける" }).click()
      await expect(page.getByText("チャンネルから退出しました。")).toBeVisible()
      await expect(page.locator("#team-select")).not.toContainText(team.name)

      const cookieA = await sessionCookieFor(userA)
      const cookieB = await sessionCookieFor(userB)
      const teamAfterLeave = await jsonRequest(
        request,
        "get",
        `/api/calendar/free-busy?start=2026-05-01T00:00:00.000Z&end=2026-06-01T00:00:00.000Z&teamId=${team.id}`,
        cookieA,
      )
      expect(teamAfterLeave.response.status()).toBe(200)
      expect(hasBooking((teamAfterLeave.json as BookingJson).bookings, bookingA.id)).toBe(true)
      expect(hasBooking((teamAfterLeave.json as BookingJson).bookings, bookingB.id)).toBe(false)

      const personalB = await jsonRequest(
        request,
        "get",
        "/api/calendar/free-busy?start=2026-05-01T00:00:00.000Z&end=2026-06-01T00:00:00.000Z",
        cookieB,
      )
      expect(personalB.response.status()).toBe(200)
      expect(hasBooking((personalB.json as BookingJson).bookings, bookingB.id)).toBe(true)
    } finally {
      await cleanupBookingE2E(prisma, { prefix, emails: [userA.email, userB.email] })
      await prisma.$disconnect()
    }
  })
})
