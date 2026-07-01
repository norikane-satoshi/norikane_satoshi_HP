import { expect, test } from "@playwright/test"

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

    const authResponse = await page.goto("/api/dev/auth-bypass")
    expect(authResponse?.status()).toBe(200)
    const bookingHtmlResponse = await page.request.get("/booking")
    expect(bookingHtmlResponse.status()).toBe(200)
    const bookingHtml = await bookingHtmlResponse.text()
    expect(bookingHtml).toContain('data-testid="booking-month-skeleton"')
    expect(bookingHtml).toContain('data-state="pending"')

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
    await page.locator(`.fc-daygrid-day[data-date="${bookingWeekSelectionDate}"] .fc-daygrid-day-number`).click()
    await expect(page.locator(".fc-dayGridMonth-view")).toBeVisible()
    await expect(page.getByTestId("booking-date-request-panel")).toBeVisible()
    await expect(page.getByTestId("booking-month-slot-option")).toHaveCount(0)
    await expect(page.getByTestId("booking-action-panel")).toHaveCount(0)
    await page.locator(`.fc-daygrid-day[data-date="${bookingWeekSelectionDate}"] .fc-daygrid-day-number`).click()
    await expect(page.getByTestId("booking-date-request-summary")).toContainText("1日間")
    await page.getByRole("button", { name: "この日程で相談する" }).click()

    await expect(page.getByLabel("案件名")).toBeVisible()
    await page.getByLabel("案件名").fill(`${prefix} personal`)
    await page.getByLabel("納期").fill("2026-06-30")
    await page.getByLabel("会社名").fill("NCS")
    await page.getByLabel("担当者氏名").fill("E2E Satoshi")
    await expect(page.getByLabel("メールアドレス")).toHaveValue(testUserEmail)
    await page.getByLabel("電話番号(任意)").fill("09000000000")
    await page.getByLabel("補足メモ").fill("e2e smoke")
    await page.getByRole("checkbox").check()

    await page.getByRole("button", { name: "相談内容を確認" }).click()
    await expect(page.getByRole("heading", { name: "日程相談内容の確認" })).toBeVisible()
    await page.getByRole("button", { name: "日程相談を送信" }).click()

    await expect(page.getByRole("heading", { name: "日程相談を受け付けました" })).toBeVisible()
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

    await prisma.bookingGroup.deleteMany({ where: { projectTitle: { startsWith: prefix } } })
    await prisma.user.deleteMany({ where: { email: testUserEmail } })
    await prisma.$disconnect()
  })
})
