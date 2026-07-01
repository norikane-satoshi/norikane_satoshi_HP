import { expect, test, type Page } from "@playwright/test"

import { prismaForE2E, testUserEmail, upsertUser } from "./booking-test-utils"

async function stubBookingCalendarApis(page: Page) {
  await page.route("**/api/calendar/free-busy**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ busy: [], bookings: [] }),
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

async function openAuthenticatedBooking(page: Page) {
  await stubBookingCalendarApis(page)
  const prisma = prismaForE2E()
  await upsertUser(prisma, testUserEmail, "E2E Satoshi")
  await prisma.$disconnect()
  const authResponse = await page.goto("/api/dev/auth-bypass")
  expect(authResponse?.status()).toBe(200)
  await page.goto("/booking")
  await expect(page.getByTestId("booking-month-skeleton")).toHaveCount(0)
  await expect(page.locator(".fc-daygrid-day-number").first()).toBeVisible()
}

test.describe("booking calendar mobile layout and selection", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  })

  test("uses mobile day flow without Japanese day suffix and creates a draft slot by touch", async ({ page }) => {
    await openAuthenticatedBooking(page)

    await expect(page.getByRole("button", { name: "週" })).toHaveCount(0)
    const dayNumberTexts = await page.locator(".fc-daygrid-day-number").allTextContents()
    expect(dayNumberTexts.length).toBeGreaterThan(0)
    expect(dayNumberTexts.every((text) => !text.includes("日"))).toBe(true)

    const targetDay = page.locator(".fc-daygrid-day:not(.fc-day-other)").first()
    const targetDate = await targetDay.getAttribute("data-date")
    expect(targetDate).toBeTruthy()
    await targetDay.locator(".fc-daygrid-day-number").click()

    await expect(page.getByRole("button", { name: "日", exact: true })).toHaveAttribute("aria-pressed", "true")
    await expect(page.locator(".fc-timeGridDay-view")).toBeVisible()

    const timeGridBody = page.locator(".fc-timeGridDay-view .fc-timegrid-body").first()
    await expect(timeGridBody).toBeVisible()
    const timeGridBox = await timeGridBody.boundingBox()
    expect(timeGridBox).not.toBeNull()
    expect(timeGridBox!.height).toBeLessThanOrEqual(520)

    const dayColumn = page.locator(`.fc-timegrid-col[data-date="${targetDate}"]`).first()
    const slotLane = page.locator('.fc-timeGridDay-view .fc-timegrid-slot-lane[data-time="13:00:00"]').first()
    await dayColumn.waitFor()
    await slotLane.waitFor()
    await slotLane.scrollIntoViewIfNeeded()
    const dayBox = await dayColumn.boundingBox()
    const slotBox = await slotLane.boundingBox()
    expect(dayBox).not.toBeNull()
    expect(slotBox).not.toBeNull()
    if (!dayBox || !slotBox) throw new Error("mobile day slot target was not available")

    await page.touchscreen.tap(dayBox.x + dayBox.width / 2, slotBox.y + Math.min(slotBox.height / 2, 12))

    await expect(page.getByTestId("booking-action-panel")).toBeVisible()
    await page.getByRole("button", { name: "本予約" }).click()
    await expect(page.getByLabel("案件名")).toBeVisible()
  })
})

test("booking calendar desktop keeps the week view tab", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await openAuthenticatedBooking(page)
  await expect(page.getByRole("button", { name: "週" })).toBeVisible()
})
