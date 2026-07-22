import { expect, test, type Page } from "@playwright/test"

import { prismaForE2E, testUserEmail, upsertUser } from "./booking-test-utils"

const emptyFreeBusy = { busy: [], bookings: [] }

async function openBooking(page: Page) {
  await page.route("**/api/calendar/free-busy**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(emptyFreeBusy) })
  })
  const prisma = prismaForE2E()
  await upsertUser(prisma, testUserEmail, "E2E Satoshi")
  await prisma.$disconnect()
  await page.goto("/api/dev/auth-bypass")
  await page.goto("/booking")
  await expect(page.locator(".fc-daygrid-day-number").first()).toBeVisible()
}

test("booking displays the overlay only while an uncached month is loading without layout shift", async ({ page }) => {
  await openBooking(page)
  const surface = page.locator(".booking-calendar__surface")
  const before = await surface.boundingBox()
  expect(before).not.toBeNull()

  let delayRequests = false
  await page.unroute("**/api/calendar/free-busy**")
  await page.route("**/api/calendar/free-busy**", async (route) => {
    if (delayRequests) await new Promise((resolve) => setTimeout(resolve, 350))
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(emptyFreeBusy) })
  })
  delayRequests = true

  await page.locator(".fc-next-button").click()
  await page.locator(".fc-next-button").click()
  const overlay = page.getByTestId("booking-calendar-loading")
  await expect(overlay).toBeVisible()
  const during = await surface.boundingBox()
  expect(during).toEqual(before)
  await expect(overlay).toHaveCount(0)

  delayRequests = false
  await page.locator(".fc-prev-button").click()
  await expect(overlay).toHaveCount(0)
})

test("public availability shows a delayed navigation overlay without layout shift", async ({ page }) => {
  await page.goto("/availability-calendar")
  await expect(page.getByTestId("public-availability-calendar")).toBeVisible()
  const calendar = page.getByTestId("public-availability-calendar")
  const before = await calendar.boundingBox()
  expect(before).not.toBeNull()

  let shouldDelay = false
  await page.route("**/availability-calendar**", async (route) => {
    if (shouldDelay && route.request().url().includes("month=")) {
      await new Promise((resolve) => setTimeout(resolve, 350))
    }
    await route.continue()
  })
  shouldDelay = true
  await page.getByRole("button", { name: "翌月" }).click()
  const overlay = page.getByTestId("public-availability-calendar-loading")
  await expect(overlay).toBeVisible()
  const during = await calendar.boundingBox()
  expect(during).toEqual(before)
  await expect(overlay).toHaveCount(0)
})

test("calendar loading overlays preserve the 390px layouts", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openBooking(page)
  let delayRequests = false
  await page.unroute("**/api/calendar/free-busy**")
  await page.route("**/api/calendar/free-busy**", async (route) => {
    if (delayRequests) await new Promise((resolve) => setTimeout(resolve, 350))
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(emptyFreeBusy) })
  })
  delayRequests = true
  await page.locator(".fc-next-button").click()
  await page.locator(".fc-next-button").click()
  await expect(page.getByTestId("booking-calendar-loading")).toBeVisible()
  expect(await page.locator(".booking-calendar__surface").evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true)
  await expect(page.getByTestId("booking-calendar-loading")).toHaveCount(0)

  await page.goto("/availability-calendar")
  let shouldDelay = false
  await page.route("**/availability-calendar**", async (route) => {
    if (shouldDelay && route.request().url().includes("month=")) {
      await new Promise((resolve) => setTimeout(resolve, 350))
    }
    await route.continue()
  })
  shouldDelay = true
  await page.getByRole("button", { name: "翌月" }).click()
  await expect(page.getByTestId("public-availability-calendar-loading")).toBeVisible()
  expect(await page.getByTestId("public-availability-calendar").evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true)
  await expect(page.getByTestId("public-availability-calendar-loading")).toHaveCount(0)
})
