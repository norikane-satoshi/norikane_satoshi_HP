import { expect, test } from "@playwright/test"

import { createBookingForUser, prismaForE2E, testUserEmail, upsertUser } from "./booking-test-utils"

const prefix = `booking-smoke-${Date.now()}`

test.describe("booking personal smoke", () => {
  test("personal booking reaches done without a red-band error and creates one BookingGroup", async ({ page }) => {
    const prisma = prismaForE2E()
    const user = await upsertUser(prisma, testUserEmail, "E2E Satoshi")
    await prisma.bookingGroup.deleteMany({ where: { projectTitle: { startsWith: prefix } } })
    await createBookingForUser(prisma, user, {
      prefix,
      label: "existing",
      start: "2026-05-20T01:00:00.000Z",
      end: "2026-05-20T02:00:00.000Z",
    })

    const authResponse = await page.goto("/api/dev/auth-bypass")
    expect(authResponse?.status()).toBe(200)
    const bookingHtmlResponse = await page.request.get("/booking")
    expect(bookingHtmlResponse.status()).toBe(200)
    const bookingHtml = await bookingHtmlResponse.text()
    expect(bookingHtml).toContain('data-testid="booking-month-skeleton"')
    expect(bookingHtml).toContain('data-state="pending"')

    const freeBusyUrl = "/api/calendar/free-busy?start=2026-05-01T00:00:00.000Z&end=2026-06-01T00:00:00.000Z"
    const cachedBeforeSubmit = await page.request.get(freeBusyUrl)
    expect(cachedBeforeSubmit.status()).toBe(200)

    await page.goto("/booking")
    await expect(page.locator(".booking-calendar__booking-event")).toHaveCount(1)
    await expect(page.getByTestId("booking-month-skeleton")).toHaveCount(0)
    await page.waitForTimeout(750)
    await expect(page.locator(".booking-calendar__booking-event")).toHaveCount(1)
    await page.getByRole("button", { name: "週" }).click()
    await page.locator(".fc-timegrid-slot-lane").first().waitFor()

    const slot = page.locator(".fc-timegrid-slot-lane").first()
    const box = await slot.boundingBox()
    expect(box).not.toBeNull()
    if (!box) throw new Error("timegrid slot box was not available")

    await page.mouse.move(box.x + box.width / 2, box.y + 4)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height * 2 + 8, { steps: 8 })
    await page.mouse.up()

    await expect(page.getByTestId("booking-action-panel")).toBeVisible()
    await page.getByRole("button", { name: "本予約" }).click()

    await expect(page.getByLabel("案件名")).toBeVisible()
    await page.getByLabel("案件名").fill(`${prefix} personal`)
    await page.getByLabel("納期").fill("2026-06-30")
    await page.getByLabel("会社名").fill("NCS")
    await page.getByLabel("担当者氏名").fill("E2E Satoshi")
    await page.getByLabel("連絡用メール").fill("e2e-contact@example.com")
    await page.getByLabel("電話番号").fill("09000000000")
    await page.getByLabel("補足メモ").fill("e2e smoke")
    await page.getByRole("checkbox").check()

    await page.getByRole("button", { name: "申込内容を確認" }).click()
    await expect(page.getByRole("heading", { name: "申込内容の確認" })).toBeVisible()
    await page.getByRole("button", { name: "予約を申し込む" }).click()

    await expect(page.getByRole("heading", { name: "予約を受け付けました" })).toBeVisible()
    await expect(page.getByText("予約申込で予期せぬエラーが発生しました")).toHaveCount(0)

    const afterSubmit = await page.request.get(freeBusyUrl)
    expect(afterSubmit.status()).toBe(200)
    const afterSubmitJson = (await afterSubmit.json()) as { bookings: { title: string }[] }
    expect(afterSubmitJson.bookings.some((booking) => booking.title === `${prefix} personal`)).toBe(true)

    await page.goto("/booking")
    await expect(page.locator(".booking-calendar__booking-event")).toHaveCount(2)

    const count = await prisma.bookingGroup.count({
      where: { projectTitle: { startsWith: prefix } },
    })
    expect(count).toBe(2)

    await prisma.bookingGroup.deleteMany({ where: { projectTitle: { startsWith: prefix } } })
    await prisma.user.deleteMany({ where: { email: testUserEmail } })
    await prisma.$disconnect()
  })
})
