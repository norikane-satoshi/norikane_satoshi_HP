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

async function expectMonthCellRatio(page: Page, maxRatio: number) {
  const dayFrameBox = await page.locator(".fc-daygrid-day:not(.fc-day-other) .fc-daygrid-day-frame").first().boundingBox()
  expect(dayFrameBox).not.toBeNull()
  expect(dayFrameBox!.height / dayFrameBox!.width).toBeLessThanOrEqual(maxRatio)
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
    notionWorkBusyRanges?: { start: string; end: string }[]
    dateOnlyBusyDateKeys?: string[]
    tentativeDateKeys?: string[]
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
    const notionWorkBusyRanges = (options.notionWorkBusyRanges ?? []).map((range) => ({
      ...range,
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
          ...notionWorkBusyRanges,
          ...dateOnlyBusy,
        ],
        bookings: [],
        tentativeDateKeys: options.tentativeDateKeys ?? [],
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
    notionWorkBusyRanges?: { start: string; end: string }[]
    dateOnlyBusyDateKeys?: string[]
    tentativeDateKeys?: string[]
    path?: string
  } = {},
) {
  await stubBookingCalendarApis(page, options)
  let authResponse = await page.goto("/api/dev/auth-bypass")
  if (authResponse?.status() === 404) {
    const prisma = prismaForE2E()
    await upsertUser(prisma, testUserEmail, "E2E Satoshi")
    await prisma.$disconnect()
    authResponse = await page.goto("/api/dev/auth-bypass")
  }
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
    await expectMonthCellRatio(page, 1.5)
    await expect(page.getByText(/海の日|山の日/)).toHaveCount(0)

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
  await expectMonthCellRatio(page, 1.1)
  await expect(page.getByText(/海の日|山の日/)).toHaveCount(0)
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
  await expect(page.getByText(/海の日|山の日/)).toHaveCount(0)

  const lockedCell = page.locator(`.fc-daygrid-day[data-date="${lockedDate}"]`)
  await expect(lockedCell).toHaveClass(/booking-calendar__locked-date/)
  await expect(lockedCell).toHaveAttribute("aria-disabled", "true")
  await expect(lockedCell.locator(".booking-calendar__date-lock")).toHaveCount(1)
  await expect(lockedCell.locator(".booking-calendar__date-lock svg")).toHaveCount(1)
  await expect(lockedCell.locator(".booking-calendar__date-lock")).not.toContainText(/用|予約不可|予約|不|本/)
  await expect(lockedCell.locator(".fc-event.booking-calendar__busy:not(.booking-calendar__date-lock)")).toHaveCount(0)
  const lockedNumberBox = await lockedCell.locator(".booking-calendar__day-number").boundingBox()
  const lockedIconBox = await lockedCell.locator(".booking-calendar__date-lock").boundingBox()
  expect(lockedNumberBox).not.toBeNull()
  expect(lockedIconBox).not.toBeNull()
  expect(lockedIconBox!.y).toBeGreaterThan(lockedNumberBox!.y)
  const lockVisibleMs = await page.waitForFunction(
    () => (window as Window & { __bookingTimeToLockVisibleMs?: number }).__bookingTimeToLockVisibleMs,
    null,
    { timeout: 5000 },
  )
  expect(await lockVisibleMs.jsonValue()).toBeGreaterThan(0)
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
  await expect(page.locator(`.fc-daygrid-day[data-date="${dateOnlyScheduleDate}"] .booking-calendar__busy-pill`)).toHaveCount(0)
  await expect(page.getByTestId("booking-date-request-summary")).toContainText(displayDateKey(dateOnlyScheduleDate))
  await expect(page.getByTestId("booking-date-request-chips")).toHaveCount(0)
  await page.getByRole("button", { name: "この日程で相談する" }).click()
  await expect(page.getByLabel("案件名")).toBeVisible()
  await page.getByLabel("案件名").fill("Timed IB work lock E2E")
  await page.getByLabel("会社名").fill("NCS")
  await page.getByLabel("氏名", { exact: true }).fill("E2E Satoshi")
  await page.getByLabel("TEL(任意)").fill("09000000000")
  await expect(page.locator(".booking-choice--terms").getByRole("link", { name: /利用規約/ })).toHaveAttribute("href", "/terms")
  await expect(page.locator(".booking-choice--terms").getByRole("link", { name: /プライバシーポリシー/ })).toHaveAttribute("href", "/privacy")
  await page.getByRole("checkbox").check()
  await page.getByRole("button", { name: "相談内容を確認" }).click()
  await expect(page.locator(".booking-confirm__list")).toContainText("納期(任意)")
  await expect(page.locator(".booking-confirm__list")).toContainText("補足(任意)")
  await page.getByRole("button", { name: "日程相談を送信" }).click()

  expect(submittedBodies).toHaveLength(1)
  expect(submittedBodies[0]).toMatchObject({
    requestedDates: [dateOnlyScheduleDate],
    selectedSlots: [],
    dueDate: "",
    memo: "",
  })
  expect(JSON.stringify(submittedBodies[0])).not.toContain(lockedDate)
  expect(JSON.stringify(submittedBodies[0])).not.toContain(todayDate)
  expect(JSON.stringify(submittedBodies[0])).not.toContain(pastDate)
})

test("LINE LIFF booking entry uses the same month-only candidate flow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openAuthenticatedBooking(page, { path: "/line/booking" })
  await expect(page.getByRole("button", { name: /友だち追加/ })).toHaveCount(0)
  await expect(page.getByText("ログイン状態")).toHaveCount(0)
  await expect(page.getByText("ログアウト")).toHaveCount(0)
  await expect(page.locator("#booking-team-scope")).toHaveCount(0)
  await expect(page.getByLabel("表示対象")).toHaveCount(0)
  await expect(page.getByRole("button", { name: "週" })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "日", exact: true })).toHaveCount(0)
  const selectableDate = page.locator(
    '.fc-daygrid-day:not(.fc-day-other):not(.booking-calendar__locked-date):not(.booking-calendar__past-or-today-date)[aria-disabled="false"]',
  ).first()
  await selectableDate.locator(".fc-daygrid-day-number").click()
  await expect(page.locator(".fc-dayGridMonth-view")).toBeVisible()
  await expect(page.getByTestId("booking-date-request-panel")).toBeVisible()
  await expect(page.getByTestId("booking-month-slot-option")).toHaveCount(0)
  const calendarSurfaceBox = await page.locator(".booking-calendar__surface").boundingBox()
  expect(calendarSurfaceBox).not.toBeNull()
  expect(calendarSurfaceBox!.width).toBeGreaterThanOrEqual(374)
  await expectMonthCellRatio(page, 1.5)
  await expect(page.getByText(/海の日|山の日/)).toHaveCount(0)
  await expect(page.getByTestId("booking-date-request-summary")).toContainText("1日間")
  await page.getByRole("button", { name: "この日程で相談する" }).click()
  await expect(page.getByLabel("案件名")).toBeVisible()
  await page.locator(".booking-choice--terms").getByRole("link", { name: /利用規約/ }).click()
  await expect(page).toHaveURL(/\/terms$/)
})

test("LINE LIFF booking entry locks the confirmed IB work ranges through free-busy", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-07-19T12:00:00+09:00"))
  await page.setViewportSize({ width: 390, height: 844 })
  const freeBusyRequests: string[] = []
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/calendar/free-busy") {
      freeBusyRequests.push(request.url())
    }
  })

  await openAuthenticatedBooking(page, {
    path: "/line/booking",
    notionWorkBusyRanges: [
      { start: "2026-09-19T00:00:00+09:00", end: "2026-10-03T23:59:00+09:00" },
      { start: "2026-12-01T00:00:00+09:00", end: "2026-12-31T23:59:00+09:00" },
    ],
  })

  for (let index = 0; index < 2; index += 1) {
    await page.locator(".fc-next-button").click()
  }
  await expect(page.locator(".fc-toolbar-title")).toHaveText("2026年9月")
  const sepOctDates = Array.from({ length: 15 }, (_, index) => addDaysToDateKey("2026-09-19", index))
  for (const date of sepOctDates) {
    const cell = page.locator(`.fc-daygrid-day[data-date="${date}"]`)
    await expect(cell).toHaveClass(/booking-calendar__locked-date/)
    await expect(cell).toHaveAttribute("aria-disabled", "true")
  }
  const septemberBusyBlocks = page.locator([
    '[data-block-start="2026-09-19"]',
    '[data-block-start="2026-09-20"]',
    '[data-block-start="2026-09-27"]',
  ].join(", "))
  await expect(septemberBusyBlocks).toHaveCount(3)
  await expect(septemberBusyBlocks.locator("svg")).toHaveCount(3)
  await expect(septemberBusyBlocks).toHaveText(["", "", ""])
  await expect(page.locator('[data-block-start="2026-09-19"]')).toHaveAttribute("data-block-end", "2026-09-19")
  await expect(page.locator('[data-block-start="2026-09-20"]')).toHaveAttribute("data-block-end", "2026-09-26")
  await expect(page.locator('[data-block-start="2026-09-27"]')).toHaveAttribute("data-block-end", "2026-10-03")
  const weekBlockBox = await page.locator('[data-block-start="2026-09-20"]').boundingBox()
  const oneDayBox = await page.locator('.fc-daygrid-day[data-date="2026-09-20"] .fc-daygrid-day-frame').boundingBox()
  expect(weekBlockBox).not.toBeNull()
  expect(oneDayBox).not.toBeNull()
  expect(weekBlockBox!.width).toBeGreaterThan(oneDayBox!.width * 6)
  expect(weekBlockBox!.y + weekBlockBox!.height).toBeLessThanOrEqual(oneDayBox!.y + oneDayBox!.height + 1)
  await expect(page.locator('.fc-daygrid-day[data-date="2026-09-20"] .fc-daygrid-day-frame')).toHaveCSS("overflow", "visible")
  await page.locator('.fc-daygrid-day[data-date="2026-09-19"] .fc-daygrid-day-number').click()
  await expect(page.locator('.fc-daygrid-day[data-date="2026-09-19"].booking-calendar__selected-date')).toHaveCount(0)

  for (let index = 0; index < 3; index += 1) {
    await page.locator(".fc-next-button").click()
  }
  await expect(page.locator(".fc-toolbar-title")).toHaveText("2026年12月")
  const decemberDates = Array.from({ length: 31 }, (_, index) => addDaysToDateKey("2026-12-01", index))
  for (const date of decemberDates) {
    const cell = page.locator(`.fc-daygrid-day[data-date="${date}"]`)
    await expect(cell).toHaveClass(/booking-calendar__locked-date/)
    await expect(cell).toHaveAttribute("aria-disabled", "true")
  }
  const decemberBusyBlocks = page.locator(".booking-calendar__availability-block--busy")
  await expect(decemberBusyBlocks).toHaveCount(5)
  await expect(decemberBusyBlocks.locator("svg")).toHaveCount(5)
  await page.locator('.fc-daygrid-day[data-date="2026-12-31"] .fc-daygrid-day-number').click()
  await expect(page.locator('.fc-daygrid-day[data-date="2026-12-31"].booking-calendar__selected-date')).toHaveCount(0)
  const requestedRanges = freeBusyRequests.map((requestUrl) => {
    const url = new URL(requestUrl)
    return {
      start: new Date(url.searchParams.get("start") ?? "").getTime(),
      end: new Date(url.searchParams.get("end") ?? "").getTime(),
    }
  })
  expect(requestedRanges.some((range) => (
    range.start < new Date("2026-10-04T00:00:00+09:00").getTime() &&
    range.end > new Date("2026-09-19T00:00:00+09:00").getTime()
  ))).toBe(true)
  expect(requestedRanges.some((range) => (
    range.start < new Date("2027-01-01T00:00:00+09:00").getTime() &&
    range.end > new Date("2026-12-01T00:00:00+09:00").getTime()
  ))).toBe(true)
  expect(freeBusyRequests.every((requestUrl) => new URL(requestUrl).searchParams.get("includeTentative") === "true")).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test("LINE LIFF booking entry shows tentative holds as selectable connected blocks", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-07-19T12:00:00+09:00"))
  await page.setViewportSize({ width: 390, height: 844 })
  await openAuthenticatedBooking(page, {
    path: "/line/booking",
    tentativeDateKeys: ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-12"],
  })

  for (let index = 0; index < 3; index += 1) {
    await page.locator(".fc-next-button").click()
  }
  await expect(page.locator(".fc-toolbar-title")).toHaveText("2026年10月")
  const tentativeBlocks = page.locator(".booking-calendar__availability-block--tentative")
  await expect(tentativeBlocks).toHaveCount(2)
  await expect(tentativeBlocks.locator("svg")).toHaveCount(2)
  await expect(tentativeBlocks).toHaveText(["仮キープ", "仮キープ"])
  await expect(page.locator('[data-block-start="2026-10-05"]')).toHaveAttribute("data-block-end", "2026-10-07")
  const tentativeBlockBox = await page.locator('[data-block-start="2026-10-05"]').boundingBox()
  const tentativeFrameBox = await page.locator('.fc-daygrid-day[data-date="2026-10-05"] .fc-daygrid-day-frame').boundingBox()
  expect(tentativeBlockBox).not.toBeNull()
  expect(tentativeFrameBox).not.toBeNull()
  expect(tentativeBlockBox!.y + tentativeBlockBox!.height).toBeLessThanOrEqual(tentativeFrameBox!.y + tentativeFrameBox!.height + 1)

  const tentativeCell = page.locator('.fc-daygrid-day[data-date="2026-10-05"]')
  await expect(tentativeCell).toHaveAttribute("data-booking-tentative", "true")
  await expect(tentativeCell).not.toHaveClass(/booking-calendar__locked-date/)
  await expect(tentativeCell).toHaveAttribute("aria-disabled", "false")
  await tentativeCell.locator(".fc-daygrid-day-number").click()
  await expect(tentativeCell).toHaveClass(/booking-calendar__selected-date/)
  await expect(page.getByTestId("booking-date-request-summary")).toContainText("10/5")
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})
