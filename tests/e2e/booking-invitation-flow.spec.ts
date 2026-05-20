import { expect, test } from "@playwright/test"

import {
  addSessionCookie,
  cleanupBookingE2E,
  createBookingForUser,
  hasBooking,
  jsonRequest,
  prismaForE2E,
  sessionCookieFor,
  upsertUser,
  type BookingJson,
} from "./booking-test-utils"

const prefix = `booking-invite-${Date.now()}`

test.describe("booking invitation flow", () => {
  test("invited user accepts a channel and can view the owner's booking in the channel scope", async ({ page, request }) => {
    const prisma = prismaForE2E()
    const teamName = `${prefix} channel`
    const userA = await upsertUser(prisma, `${prefix}-a@example.com`, "Invite A")
    const userB = await upsertUser(prisma, `${prefix}-b@example.com`, "Invite B")

    try {
      const bookingA = await createBookingForUser(prisma, userA, {
        prefix,
        label: "A booking",
        start: "2026-05-24T01:00:00.000Z",
        end: "2026-05-24T02:00:00.000Z",
      })

      await addSessionCookie(page.context(), userA)
      await page.goto("/booking/settings")
      await page.getByLabel("新規チャンネル").fill(teamName)
      await page.getByRole("button", { name: "作成" }).click()
      await expect(page.getByText("チャンネルを作成しました。")).toBeVisible()
      await expect(page.locator("#team-select")).toContainText(teamName)

      await page.getByRole("button", { name: "招待リンク発行" }).click()
      await expect(page.getByText("招待リンクを発行しました。")).toBeVisible()
      const invitationUrl = await page.locator(".booking-settings__copy-row input").inputValue()
      expect(invitationUrl).toContain("/api/team-invitations/accept?token=")

      await page.context().clearCookies()
      await addSessionCookie(page.context(), userB)
      await page.goto(invitationUrl)
      await expect(page).toHaveURL(/\/booking\/settings\?invite=accepted/)
      await expect(page.locator("#team-select")).toContainText(teamName)

      await page.goto("/booking")
      const scope = page.locator("#booking-team-scope")
      await expect(scope).toContainText(teamName)
      await scope.selectOption({ label: teamName })
      await expect(page.locator(".booking-calendar__booking-event")).toHaveCount(1)

      const cookieB = await sessionCookieFor(userB)
      const teams = await jsonRequest(request, "get", "/api/teams", cookieB)
      const teamId = (teams.json.teams as { id: string; name: string }[]).find((team) => team.name === teamName)?.id
      expect(teamId).toBeTruthy()
      const busy = await jsonRequest(
        request,
        "get",
        `/api/calendar/free-busy?start=2026-05-01T00:00:00.000Z&end=2026-06-01T00:00:00.000Z&teamId=${teamId}`,
        cookieB,
      )
      expect(busy.response.status()).toBe(200)
      expect(hasBooking((busy.json as BookingJson).bookings, bookingA.id)).toBe(true)
    } finally {
      await cleanupBookingE2E(prisma, { prefix, emails: [userA.email, userB.email] })
      await prisma.$disconnect()
    }
  })
})
