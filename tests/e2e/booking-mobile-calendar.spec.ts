import { expect, test, type Page } from "@playwright/test"

import { prismaForE2E, testUserEmail, upsertUser } from "./booking-test-utils"

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10)
}

function localDateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000)
}

function addDaysToDateKey(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split("-").map(Number)
  return isoDate(new Date(Date.UTC(year, month - 1, day + days)))
}

function currentDateKey() {
  return localDateKey(new Date())
}

function displayDateKey(dateKey: string) {
  const [, month, day] = dateKey.split("-").map(Number)
  return `${month}/${day}`
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

async function stubBookingCalendarApis(
  page: Page,
  options: {
    dailyBusy?: boolean
    googleBusyDateKeys?: string[]
    notionWorkBusyDateKeys?: string[]
    dateOnlyBusyDateKeys?: string[]
  } = {},
) {
  await page.route("**/api/calendar/free-busy**", async (route) => {
    const url = new URL(route.request().url())
    const googleBusy = (options.googleBusyDateKeys ?? []).map((date) => ({
      start: `${date}T10:00:00+09:00`,
      end: `${date}T10:30:00+09:00`,
      summary: "Google busy",
      source: "google_calendar",
      bufferBeforeHours: 0,
      bufferAfterHours: 0,
    }))
    const notionWorkBusy = (options.notionWorkBusyDateKeys ?? []).map((date) => ({
      start: `${date}T13:00:00+09:00`,
      end: `${date}T13:30:00+09:00`,
      summary: "IB_仕事",
      source: "notion_work",
      bufferBeforeHours: 0,
      bufferAfterHours: 0,
    }))
    const dateOnlyBusy = (options.dateOnlyBusyDateKeys ?? []).map((date) => ({
      start: date,
      end: addDaysToDateKey(date, 1),
      summary: "Date-only schedule",
      source: "notion_work",
      bufferBeforeHours: 0,
      bufferAfterHours: 0,
    }))
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        busy: [
          ...(options.dailyBusy ? buildDailyBusySlots(url.searchParams.get("start") ?? "", url.searchParams.get("end") ?? "") : []),
          ...googleBusy,
          ...notionWorkBusy,
          ...dateOnlyBusy,
        ],
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

async function openAuthenticatedBooking(
  page: Page,
  options: {
    dailyBusy?: boolean
    googleBusyDateKeys?: string[]
    notionWorkBusyDateKeys?: string[]
    dateOnlyBusyDateKeys?: string[]
    path?: string
  } = {},
) {
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

  test("uses month-only mobile flow and toggles non-contiguous date requests", async ({ page }) => {
    await openAuthenticatedBooking(page)

    await expect(page.getByRole("button", { name: "週" })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "日", exact: true })).toHaveCount(0)
    const dayNumberTexts = await page.locator(".fc-daygrid-day-number").allTextContents()
    expect(dayNumberTexts.length).toBeGreaterThan(0)
    expect(dayNumberTexts.every((text) => !text.includes("日"))).toBe(true)
    const calendarSurfaceBox = await page.locator(".booking-calendar__surface").boundingBox()
    expect(calendarSurfaceBox).not.toBeNull()
    expect(calendarSurfaceBox!.width).toBeGreaterThanOrEqual(374)

    const targetDate = addDaysToDateKey(currentDateKey(), 1)
    const targetDay = page.locator(`.fc-daygrid-day[data-date="${targetDate}"]`)
    await targetDay.locator(".fc-daygrid-day-number").click()

    await expect(page.locator(".fc-dayGridMonth-view")).toBeVisible()
    await expect(page.getByTestId("booking-date-request-panel")).toBeVisible()
    await expect(page.getByTestId("booking-month-slot-option")).toHaveCount(0)
    await expect(page.getByTestId("booking-action-panel")).toHaveCount(0)

    const skippedDate = addDaysToDateKey(targetDate, 1)
    const laterDate = addDaysToDateKey(targetDate, 7)
    await page.locator(`.fc-daygrid-day[data-date="${laterDate}"] .fc-daygrid-day-number`).click()

    await expect(page.getByTestId("booking-date-request-summary")).toContainText("2日間")
    await expect(page.getByTestId("booking-date-request-summary")).not.toContainText(displayDateKey(skippedDate))
    await expect(page.locator(".booking-calendar__selected-date")).toHaveCount(2)
    await expect(page.locator(`.fc-daygrid-day[data-date="${skippedDate}"].booking-calendar__selected-date`)).toHaveCount(0)
    await expect(page.getByTestId("booking-date-request-chips")).toHaveCount(0)

    await page.locator(`.fc-daygrid-day[data-date="${targetDate}"] .fc-daygrid-day-number`).click()
    await expect(page.getByTestId("booking-date-request-summary")).toContainText("1日間")
    await expect(page.locator(".booking-calendar__selected-date")).toHaveCount(1)
    await page.locator(`.fc-daygrid-day[data-date="${targetDate}"] .fc-daygrid-day-number`).click()
    await expect(page.getByTestId("booking-date-request-summary")).toContainText("2日間")
    await expect(page.locator(".booking-calendar__selected-date")).toHaveCount(2)
    const panelBox = await page.getByTestId("booking-date-request-panel").boundingBox()
    expect(panelBox).not.toBeNull()
    expect(panelBox!.width).toBeGreaterThanOrEqual(374)
    await page.getByRole("button", { name: "この日程で相談する" }).click()
    await expect(page.getByLabel("案件名")).toBeVisible()
  })
})

test("booking calendar desktop hides view tabs and reaches the booking form from month candidates", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await openAuthenticatedBooking(page)
  await expect(page.getByRole("button", { name: "週" })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "日", exact: true })).toHaveCount(0)
  const targetDate = addDaysToDateKey(currentDateKey(), 1)
  const targetDay = page.locator(`.fc-daygrid-day[data-date="${targetDate}"]`)
  await targetDay.locator(".fc-daygrid-day-number").click()
  await expect(page.locator(".fc-dayGridMonth-view")).toBeVisible()
  await expect(page.getByTestId("booking-date-request-panel")).toBeVisible()
  await expect(page.getByTestId("booking-month-slot-option")).toHaveCount(0)
  await page.locator(`.fc-daygrid-day[data-date="${addDaysToDateKey(targetDate, 1)}"] .fc-daygrid-day-number`).click()
  await expect(page.getByTestId("booking-date-request-summary")).toContainText("2日間")
  await expect(page.locator(".booking-calendar__selected-date")).toHaveCount(2)
  await page.getByRole("button", { name: "この日程で相談する" }).click()
  await expect(page.getByLabel("案件名")).toBeVisible()
})

test("booking calendar locks timed IB work dates without blocking date-only schedule days", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  const todayDate = currentDateKey()
  const pastDate = addDaysToDateKey(todayDate, -1)
  const lockedDate = addDaysToDateKey(todayDate, 2)
  const dateOnlyScheduleDate = addDaysToDateKey(todayDate, 3)
  const submittedBodies: unknown[] = []
  await page.route("**/api/booking", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback()
      return
    }
    submittedBodies.push(route.request().postDataJSON())
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ bookingGroupId: "booking_e2e_lock" }),
    })
  })
  await openAuthenticatedBooking(page, {
    googleBusyDateKeys: [lockedDate, lockedDate],
    notionWorkBusyDateKeys: [lockedDate, lockedDate],
    dateOnlyBusyDateKeys: [dateOnlyScheduleDate],
  })

  const lockedCell = page.locator(`.fc-daygrid-day[data-date="${lockedDate}"]`)
  await expect(lockedCell).toHaveClass(/booking-calendar__locked-date/)
  await expect(lockedCell).toHaveAttribute("aria-disabled", "true")
  await expect(lockedCell.locator(".booking-calendar__date-lock")).toHaveCount(1)
  await expect(lockedCell.locator(".fc-event.booking-calendar__busy:not(.booking-calendar__date-lock)")).toHaveCount(0)
  await lockedCell.locator(".fc-daygrid-day-number").click()
  await expect(page.locator(`.fc-daygrid-day[data-date="${lockedDate}"].booking-calendar__selected-date`)).toHaveCount(0)
  await expect(page.getByTestId("booking-date-request-summary")).toContainText("未選択")

  const todayCell = page.locator(`.fc-daygrid-day[data-date="${todayDate}"]`)
  await expect(todayCell).toHaveClass(/booking-calendar__past-or-today-date/)
  await expect(todayCell).toHaveAttribute("aria-disabled", "true")
  await todayCell.locator(".fc-daygrid-day-number").click()
  await expect(page.locator(`.fc-daygrid-day[data-date="${todayDate}"].booking-calendar__selected-date`)).toHaveCount(0)

  const pastCell = page.locator(`.fc-daygrid-day[data-date="${pastDate}"]`)
  await expect(pastCell).toHaveClass(/booking-calendar__past-or-today-date/)
  await expect(pastCell).toHaveAttribute("aria-disabled", "true")
  await pastCell.locator(".fc-daygrid-day-number").click()
  await expect(page.locator(`.fc-daygrid-day[data-date="${pastDate}"].booking-calendar__selected-date`)).toHaveCount(0)

  await page.locator(`.fc-daygrid-day[data-date="${dateOnlyScheduleDate}"] .fc-daygrid-day-number`).click()
  await expect(page.locator(`.fc-daygrid-day[data-date="${dateOnlyScheduleDate}"].booking-calendar__selected-date`)).toHaveCount(1)
  await expect(page.locator(`.fc-daygrid-day[data-date="${dateOnlyScheduleDate}"].booking-calendar__locked-date`)).toHaveCount(0)
  await expect(page.getByTestId("booking-date-request-summary")).toContainText(displayDateKey(dateOnlyScheduleDate))
  await expect(page.getByTestId("booking-date-request-chips")).toHaveCount(0)
  await page.getByRole("button", { name: "この日程で相談する" }).click()
  await expect(page.getByLabel("案件名")).toBeVisible()
  await page.getByLabel("案件名").fill("Timed IB work lock E2E")
  await page.getByLabel("納期").fill("2026-07-31")
  await page.getByLabel("会社名").fill("NCS")
  await page.getByLabel("担当者氏名").fill("E2E Satoshi")
  await page.getByLabel("電話番号(任意)").fill("09000000000")
  await page.getByLabel("補足メモ").fill("date lock e2e")
  await page.getByRole("checkbox").check()
  await page.getByRole("button", { name: "相談内容を確認" }).click()
  await page.getByRole("button", { name: "日程相談を送信" }).click()

  expect(submittedBodies).toHaveLength(1)
  expect(submittedBodies[0]).toMatchObject({
    requestedDates: [dateOnlyScheduleDate],
    selectedSlots: [],
  })
  expect(JSON.stringify(submittedBodies[0])).not.toContain(lockedDate)
  expect(JSON.stringify(submittedBodies[0])).not.toContain(todayDate)
  expect(JSON.stringify(submittedBodies[0])).not.toContain(pastDate)
})

test("LINE LIFF booking entry uses the same month-only candidate flow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openAuthenticatedBooking(page, { path: "/line/booking" })
  await expect(page.getByRole("button", { name: "週" })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "日", exact: true })).toHaveCount(0)
  await page.locator(`.fc-daygrid-day[data-date="${addDaysToDateKey(currentDateKey(), 1)}"] .fc-daygrid-day-number`).click()
  await expect(page.locator(".fc-dayGridMonth-view")).toBeVisible()
  await expect(page.getByTestId("booking-date-request-panel")).toBeVisible()
  await expect(page.getByTestId("booking-month-slot-option")).toHaveCount(0)
  const calendarSurfaceBox = await page.locator(".booking-calendar__surface").boundingBox()
  expect(calendarSurfaceBox).not.toBeNull()
  expect(calendarSurfaceBox!.width).toBeGreaterThanOrEqual(374)
  await expect(page.getByTestId("booking-date-request-summary")).toContainText("1日間")
  await page.getByRole("button", { name: "この日程で相談する" }).click()
  await expect(page.getByLabel("案件名")).toBeVisible()
})
