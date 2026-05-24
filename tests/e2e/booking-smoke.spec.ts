import { expect, test } from "@playwright/test"

import { createBookingForUser, prismaForE2E, testUserEmail, upsertUser } from "./booking-test-utils"

const prefix = `booking-smoke-${Date.now()}`
const bookingWeekStartIso = "2026-05-24T00:00:00.000Z"
const bookingWeekEndIso = "2026-05-31T00:00:00.000Z"
const bookingWeekSelectionDate = "2026-05-25"

test.describe("booking personal smoke", () => {
  test("personal booking surfaces calendar failure and marks the pending group failed", async ({ page }) => {
    const prisma = prismaForE2E()
    const user = await upsertUser(prisma, testUserEmail, "E2E Satoshi")
    await prisma.bookingGroup.deleteMany({ where: { projectTitle: { startsWith: prefix } } })
    await createBookingForUser(prisma, user, {
      prefix,
      label: "existing",
      start: `${bookingWeekSelectionDate}T01:00:00.000Z`,
      end: `${bookingWeekSelectionDate}T02:00:00.000Z`,
    })

    const authResponse = await page.goto("/api/dev/auth-bypass")
    expect(authResponse?.status()).toBe(200)
    const bookingHtmlResponse = await page.request.get("/booking")
    expect(bookingHtmlResponse.status()).toBe(200)
    const bookingHtml = await bookingHtmlResponse.text()
    expect(bookingHtml).toContain('data-testid="booking-month-skeleton"')
    expect(bookingHtml).toContain('data-state="pending"')

    const freeBusyUrl = `/api/calendar/free-busy?start=${bookingWeekStartIso}&end=${bookingWeekEndIso}`
    const cachedBeforeSubmit = await page.request.get(freeBusyUrl)
    expect(cachedBeforeSubmit.status()).toBe(200)

    await page.goto("/booking")
    await expect(page.locator(".booking-calendar__booking-event")).toHaveCount(1)
    await expect(page.getByTestId("booking-month-skeleton")).toHaveCount(0)
    await page.waitForTimeout(750)
    await expect(page.locator(".booking-calendar__booking-event")).toHaveCount(1)
    await page.getByRole("button", { name: "週" }).click()
    await page.locator(".fc-timegrid-slot-lane").first().waitFor()

    const dayColumn = page.locator(`.fc-timegrid-col[data-date="${bookingWeekSelectionDate}"]`).first()
    const slotLane = page.locator('.fc-timegrid-slot-lane[data-time="13:00:00"]').first()
    await dayColumn.waitFor()
    await slotLane.waitFor()
    await slotLane.scrollIntoViewIfNeeded()
    const dayBox = await dayColumn.boundingBox()
    const slotBox = await slotLane.boundingBox()
    expect(dayBox).not.toBeNull()
    expect(slotBox).not.toBeNull()
    if (!dayBox || !slotBox) throw new Error("timegrid selection target was not available")

    await page.mouse.move(dayBox.x + dayBox.width / 2, slotBox.y + 4)
    await page.mouse.down()
    await page.mouse.move(dayBox.x + dayBox.width / 2, slotBox.y + slotBox.height * 2 + 8, { steps: 8 })
    await page.mouse.up()

    await expect(page.getByTestId("booking-action-panel")).toBeVisible()
    await page.getByRole("button", { name: "本予約" }).click()

    await expect(page.getByLabel("案件名")).toBeVisible()
    await page.getByLabel("案件名").fill(`${prefix} personal`)
    await page.getByLabel("納期").fill("2026-06-30")
    await page.getByLabel("会社名").fill("NCS")
    await page.getByLabel("担当者氏名").fill("E2E Satoshi")
    await expect(page.getByLabel("メールアドレス")).toHaveValue(testUserEmail)
    await page.getByLabel("電話番号(任意)").fill("09000000000")
    await page.getByLabel("補足メモ").fill("e2e smoke")
    await page.getByRole("checkbox").check()

    await page.getByRole("button", { name: "申込内容を確認" }).click()
    await expect(page.getByRole("heading", { name: "申込内容の確認" })).toBeVisible()
    await page.getByRole("button", { name: "予約を申し込む" }).click()

    await expect(page.getByText("カレンダー連携に一時的な問題が発生しています。時間をおいて再度お試しください")).toBeVisible()
    await expect(page.getByRole("heading", { name: "予約を受け付けました" })).toHaveCount(0)
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
    expect(failedCount).toBe(1)

    await prisma.bookingGroup.deleteMany({ where: { projectTitle: { startsWith: prefix } } })
    await prisma.user.deleteMany({ where: { email: testUserEmail } })
    await prisma.$disconnect()
  })
})
