import { expect, test, type Page } from "@playwright/test"

import { prismaForE2E, testUserEmail, upsertUser } from "./booking-test-utils"

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10)
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000)
}

function buildDailyBusySlots(startIso: string, endIso: string) {
  const start = new Date(startIso)
  const end = new Date(endIso)
  const busy = []
  for (let cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate())); cursor < end; cursor = addDays(cursor, 1)) {
    const date = isoDate(cursor)
    busy.push({
      start: `${date}T13:00:00`,
      end: `${date}T13:30:00`,
      summary: "E2E unavailable",
      bufferBeforeHours: 0,
      bufferAfterHours: 0,
    })
  }
  return busy
}

async function stubBookingCalendarApis(page: Page, options: { dailyBusy?: boolean } = {}) {
  await page.route("**/api/calendar/free-busy**", async (route) => {
    const url = new URL(route.request().url())
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        busy: options.dailyBusy ? buildDailyBusySlots(url.searchParams.get("start") ?? "", url.searchParams.get("end") ?? "") : [],
        bookings: [],
      }),
    })
  })
  await page.route("**/api/booking/conflicts", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ verdict: "ok" }),
    })
  })
}

async function openAuthenticatedBooking(page: Page, options: { dailyBusy?: boolean; path?: string } = {}) {
  await stubBookingCalendarApis(page, options)
  const prisma = prismaForE2E()
  await upsertUser(prisma, testUserEmail, "E2E Satoshi")
  await prisma.$disconnect()
  const authResponse = await page.goto("/api/dev/auth-bypass")
  expect(authResponse?.status()).toBe(200)
  await page.goto(options.path ?? "/booking")
  await expect(page.getByTestId("booking-month-skeleton")).toHaveCount(0)
  await expect(page.locator(".fc-daygrid-day-number").first()).toBeVisible()
}

test.describe("booking calendar mobile layout and selection", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  })

  test("uses month-only mobile flow without Japanese day suffix and creates a draft slot from candidate chips", async ({ page }) => {
    await openAuthenticatedBooking(page, { dailyBusy: true })

    await expect(page.getByRole("button", { name: "週" })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "日", exact: true })).toHaveCount(0)
    const dayNumberTexts = await page.locator(".fc-daygrid-day-number").allTextContents()
    expect(dayNumberTexts.length).toBeGreaterThan(0)
    expect(dayNumberTexts.every((text) => !text.includes("日"))).toBe(true)
    const calendarSurfaceBox = await page.locator(".booking-calendar__surface").boundingBox()
    expect(calendarSurfaceBox).not.toBeNull()
    expect(calendarSurfaceBox!.width).toBeGreaterThanOrEqual(374)

    const targetDay = page.locator(".fc-daygrid-day:not(.fc-day-other)").first()
    const targetDate = await targetDay.getAttribute("data-date")
    expect(targetDate).toBeTruthy()
    await targetDay.locator(".fc-daygrid-day-number").click()

    await expect(page.locator(".fc-dayGridMonth-view")).toBeVisible()
    await expect(page.getByTestId("booking-month-slots")).toBeVisible()
    const blockedSlot = page.getByTestId("booking-month-slot-option").filter({ hasText: "13:00 - 13:30" })
    await expect(blockedSlot).toBeDisabled()
    await expect(blockedSlot).toContainText("既存予定")
    await expect(page.getByTestId("booking-action-panel")).toHaveCount(0)

    await page.getByTestId("booking-month-slot-option").filter({ hasText: "14:00 - 14:30" }).click()

    const actionPanel = page.getByTestId("booking-action-panel")
    await expect(actionPanel).toBeVisible()
    const actionPanelBox = await actionPanel.boundingBox()
    expect(actionPanelBox).not.toBeNull()
    if (!actionPanelBox) throw new Error("mobile sticky action panel was not visible")
    expect(actionPanelBox.y).toBeGreaterThanOrEqual(0)
    expect(actionPanelBox.y + actionPanelBox.height).toBeLessThanOrEqual(844)
    await page.getByRole("button", { name: "本予約" }).click()
    await expect(page.getByLabel("案件名")).toBeVisible()
  })
})

test("booking calendar desktop hides view tabs and reaches the booking form from month candidates", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await openAuthenticatedBooking(page)
  await expect(page.getByRole("button", { name: "週" })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "日", exact: true })).toHaveCount(0)
  const targetDay = page.locator(".fc-daygrid-day:not(.fc-day-other)").first()
  await targetDay.locator(".fc-daygrid-day-number").click()
  await expect(page.locator(".fc-dayGridMonth-view")).toBeVisible()
  await expect(page.getByTestId("booking-month-slots")).toBeVisible()
  await page.getByTestId("booking-month-slot-option").filter({ hasText: "14:00 - 14:30" }).click()
  await page.getByRole("button", { name: "本予約" }).click()
  await expect(page.getByLabel("案件名")).toBeVisible()
})

test("LINE LIFF booking entry uses the same month-only candidate flow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openAuthenticatedBooking(page, { dailyBusy: true, path: "/line/booking" })
  await expect(page.getByRole("button", { name: "週" })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "日", exact: true })).toHaveCount(0)
  await page.locator(".fc-daygrid-day:not(.fc-day-other)").first().locator(".fc-daygrid-day-number").click()
  await expect(page.locator(".fc-dayGridMonth-view")).toBeVisible()
  await expect(page.getByTestId("booking-month-slots")).toBeVisible()
  const calendarSurfaceBox = await page.locator(".booking-calendar__surface").boundingBox()
  expect(calendarSurfaceBox).not.toBeNull()
  expect(calendarSurfaceBox!.width).toBeGreaterThanOrEqual(374)
  await expect(page.getByTestId("booking-month-slot-option").filter({ hasText: "13:00 - 13:30" })).toBeDisabled()
  await page.getByTestId("booking-month-slot-option").filter({ hasText: "14:00 - 14:30" }).click()
  const actionPanel = page.getByTestId("booking-action-panel")
  await expect(actionPanel).toBeVisible()
  const actionPanelBox = await actionPanel.boundingBox()
  expect(actionPanelBox).not.toBeNull()
  if (!actionPanelBox) throw new Error("LINE LIFF sticky action panel was not visible")
  expect(actionPanelBox.y + actionPanelBox.height).toBeLessThanOrEqual(844)
  await page.getByRole("button", { name: "本予約" }).click()
  await expect(page.getByLabel("案件名")).toBeVisible()
})
