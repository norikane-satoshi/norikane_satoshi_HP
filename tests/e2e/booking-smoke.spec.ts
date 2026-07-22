import { expect, test } from "@playwright/test"

import { bookingApiSchema } from "@/lib/booking/domain/api-schema"
import { createBookingFromApiInput } from "@/lib/booking/server/create-booking"
import {
  createBookingForUser,
  e2eCurrentWeekRange,
  e2eCurrentWeekdayOffset,
  e2eSlot,
  prismaForE2E,
  testUserEmail,
  upsertUser,
} from "./booking-test-utils"

const prefix = `booking-smoke-${Date.now()}`
const bookingWeek = e2eCurrentWeekRange()
const bookingWeekdayOffset = e2eCurrentWeekdayOffset()
const existingSlot = e2eSlot(bookingWeekdayOffset, 1)
const bookingWeekSelectionDate = existingSlot.date

function addDaysToDateKey(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split("-").map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + days))
  return date.toISOString().slice(0, 10)
}

function displayDateKey(dateKey: string) {
  const [, month, day] = dateKey.split("-").map(Number)
  return `${month}/${day}`
}

test.describe("booking personal smoke", () => {
  test("personal booking saves a date consultation request without creating a calendar event", async ({ page }) => {
    const prisma = prismaForE2E()
    const user = await upsertUser(prisma, testUserEmail, "E2E Satoshi")
    await prisma.bookingGroup.deleteMany({ where: { projectTitle: { startsWith: prefix } } })
    await createBookingForUser(prisma, user, {
      prefix,
      label: "existing",
      start: existingSlot.start,
      end: existingSlot.end,
    })
    await page.route("**/api/booking", async (route) => {
      if (route.request().method() !== "POST") {
        await route.fallback()
        return
      }
      const input = bookingApiSchema.parse(route.request().postDataJSON())
      const calendarId = process.env.GOOGLE_CALENDAR_BUSY_SOURCE_ID
      delete process.env.GOOGLE_CALENDAR_BUSY_SOURCE_ID
      try {
        const result = await createBookingFromApiInput({
          input,
          userId: user.id,
          userEmail: user.email,
        })
        await route.fulfill({
          status: result.status,
          contentType: "application/json",
          body: JSON.stringify(result.body),
        })
      } finally {
        if (calendarId === undefined) delete process.env.GOOGLE_CALENDAR_BUSY_SOURCE_ID
        else process.env.GOOGLE_CALENDAR_BUSY_SOURCE_ID = calendarId
      }
    })

    const authResponse = await page.goto("/api/dev/auth-bypass")
    expect(authResponse?.status()).toBe(200)
    const bookingHtmlResponse = await page.request.get("/booking")
    expect(bookingHtmlResponse.status()).toBe(200)
    const bookingHtml = await bookingHtmlResponse.text()
    expect(bookingHtml).toContain('data-testid="booking-month-skeleton"')
    expect(bookingHtml).toContain('data-state="ready"')
    expect(bookingHtml).toContain('data-kind="lock"')

    const freeBusyUrl = `/api/calendar/free-busy?start=${bookingWeek.startIso}&end=${bookingWeek.endIso}`
    const cachedBeforeSubmit = await page.request.get(freeBusyUrl)
    expect(cachedBeforeSubmit.status()).toBe(200)
    const cachedBeforeSubmitJson = (await cachedBeforeSubmit.json()) as { bookings: { title: string }[] }
    expect(cachedBeforeSubmitJson.bookings.some((booking) => booking.title === `${prefix} existing`)).toBe(true)

    await page.goto("/booking")
    await expect(page.locator(".booking-calendar__booking-event")).toHaveCount(1)
    await expect(page.getByTestId("booking-month-skeleton")).toHaveCount(0)
    await page.waitForTimeout(750)
    await expect(page.locator(".booking-calendar__booking-event")).toHaveCount(1)
    await expect(page.getByRole("button", { name: "週" })).toHaveCount(0)
    const firstRequestedDate = addDaysToDateKey(bookingWeekSelectionDate, 1)
    await page.locator(`.fc-daygrid-day[data-date="${firstRequestedDate}"] .fc-daygrid-day-number`).click()
    await expect(page.locator(".fc-dayGridMonth-view")).toBeVisible()
    await expect(page.getByTestId("booking-date-request-panel")).toBeVisible()
    await expect(page.getByTestId("booking-month-slot-option")).toHaveCount(0)
    await expect(page.getByTestId("booking-action-panel")).toHaveCount(0)
    const skippedDate = addDaysToDateKey(firstRequestedDate, 1)
    const laterDate = addDaysToDateKey(firstRequestedDate, 7)
    await page.locator(`.fc-daygrid-day[data-date="${laterDate}"] .fc-daygrid-day-number`).click()
    await expect(page.getByTestId("booking-date-request-summary")).toContainText("2日間")
    await expect(page.getByTestId("booking-date-request-summary")).toContainText(displayDateKey(firstRequestedDate))
    await expect(page.getByTestId("booking-date-request-summary")).toContainText(displayDateKey(laterDate))
    await expect(page.getByTestId("booking-date-request-summary")).not.toContainText(displayDateKey(skippedDate))
    await expect(page.locator(`.fc-daygrid-day[data-date="${skippedDate}"].booking-calendar__selected-date`)).toHaveCount(0)
    await expect(page.getByTestId("booking-date-request-chips")).toHaveCount(0)
    await page.getByRole("button", { name: "この日程で相談する" }).click()

    await expect(page.getByLabel("案件名")).toBeVisible()
    await page.getByLabel("案件名").fill(`${prefix} personal`)
    await page.getByLabel("納期").fill("2026-06-30")
    await page.getByLabel("会社名").fill("NCS Long Company Name " + "VeryLongSegment".repeat(5))
    await page.getByLabel("氏名", { exact: true }).fill("E2E Satoshi")
    await expect(page.getByLabel("メール", { exact: true })).toHaveValue(testUserEmail)
    await page.getByLabel("TEL(任意)").fill("09000000000")
    await page.getByLabel(/補足/).fill(`e2e smoke https://example.com/${"very-long-url-segment".repeat(10)}`)
    await page.getByRole("checkbox").check()

    await page.getByRole("button", { name: "相談内容を確認" }).click()
    await expect(page.getByRole("heading", { name: "日程相談内容の確認" })).toBeVisible()
    const confirmText = await page.locator(".booking-confirm").innerText()
    expect(confirmText).toContain("希望日")
    expect(confirmText).toContain("氏名")
    expect(confirmText).toContain("メール")
    expect(confirmText).toContain("TEL")
    expect(confirmText).toContain("補足")
    expect(confirmText).not.toContain("相談希望日")
    expect(confirmText).not.toContain("担当者氏名")
    expect(confirmText).not.toContain("メールアドレス")
    expect(confirmText).not.toContain("電話番号")
    expect(confirmText).not.toContain("補足メモ")
    const overflowingConfirmNodes = await page.evaluate(() => {
      const viewportWidth = document.documentElement.clientWidth
      return Array.from(document.querySelectorAll(".booking-confirm, .booking-confirm *"))
        .map((node) => {
          const rect = (node as HTMLElement).getBoundingClientRect()
          return { tag: node.nodeName, className: (node as HTMLElement).className, left: rect.left, right: rect.right }
        })
        .filter((rect) => rect.left < -1 || rect.right > viewportWidth + 1)
    })
    expect(overflowingConfirmNodes).toEqual([])
    await page.getByRole("button", { name: "日程相談を送信" }).click()

    await expect(page.getByRole("heading", { name: "日程相談を受け付けました" })).toBeVisible()
    await expect(page.getByText("確認メールをお送りしました。内容を確認後、直接ご連絡します。")).toBeVisible()
    await expect(page.getByRole("link", { name: "マイページで予約一覧を見る" })).toHaveAttribute("href", "/booking/history")
    const overflowingDoneNodes = await page.evaluate(() => {
      const viewportWidth = document.documentElement.clientWidth
      return Array.from(document.querySelectorAll(".booking-done, .booking-done *"))
        .map((node) => {
          const rect = (node as HTMLElement).getBoundingClientRect()
          return { tag: node.nodeName, className: (node as HTMLElement).className, left: rect.left, right: rect.right }
        })
        .filter((rect) => rect.left < -1 || rect.right > viewportWidth + 1)
    })
    expect(overflowingDoneNodes).toEqual([])
    await expect(page.getByText("カレンダー連携に一時的な問題が発生しています。時間をおいて再度お試しください")).toHaveCount(0)
    await expect(page.getByText("予約申込で予期せぬエラーが発生しました")).toHaveCount(0)

    const afterSubmit = await page.request.get(freeBusyUrl)
    expect(afterSubmit.status()).toBe(200)
    const afterSubmitJson = (await afterSubmit.json()) as { bookings: { title: string }[] }
    expect(afterSubmitJson.bookings.some((booking) => booking.title === `${prefix} personal`)).toBe(false)

    await page.goto("/booking")
    await expect(page.locator(".booking-calendar__booking-event").first()).toBeVisible()

    const count = await prisma.bookingGroup.count({
      where: { projectTitle: { startsWith: prefix } },
    })
    expect(count).toBe(2)
    const failedCount = await prisma.bookingGroup.count({
      where: { projectTitle: `${prefix} personal`, status: "FAILED" },
    })
    expect(failedCount).toBe(0)
    const scheduleRequestCount = await prisma.bookingGroup.count({
      where: { projectTitle: `${prefix} personal`, status: "NEEDS_SCHEDULE" },
    })
    expect(scheduleRequestCount).toBe(1)
    await page.goto("/booking/history")
    await expect(page.getByRole("heading", { name: "予約一覧" })).toBeVisible()
    const historyCard = page.locator(".booking-history__card", { hasText: `${prefix} personal` })
    await expect(historyCard).toBeVisible()
    await expect(historyCard).toContainText("受付済み")
    await expect(historyCard).toContainText("希望日一覧")
    const scheduleRequest = await prisma.bookingGroup.findFirst({
      where: { projectTitle: `${prefix} personal`, status: "NEEDS_SCHEDULE" },
      select: { memo: true, timeSlots: { select: { id: true } } },
    })
    expect(scheduleRequest?.memo).toContain(displayDateKey(firstRequestedDate))
    expect(scheduleRequest?.memo).toContain(displayDateKey(laterDate))
    expect(scheduleRequest?.memo).not.toContain(displayDateKey(skippedDate))
    expect(scheduleRequest?.timeSlots).toHaveLength(0)

    await prisma.bookingGroup.deleteMany({ where: { projectTitle: { startsWith: prefix } } })
    await prisma.user.deleteMany({ where: { email: testUserEmail } })
    await prisma.$disconnect()
  })
})
