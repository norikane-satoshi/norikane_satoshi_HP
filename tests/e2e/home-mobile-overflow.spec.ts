import { expect, test } from "@playwright/test"

test.describe("home mobile overflow", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
  })

  test("keeps page-level horizontal overflow out of the mobile viewport", async ({ page }) => {
    const response = await page.goto("/")
    expect(response?.status()).toBe(200)

    const viewport = await page.evaluate(() => window.innerWidth)
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)

    expect(scrollWidth).toBeLessThanOrEqual(viewport)
  })

  test("wraps long note card titles within the rendered card width", async ({ page }) => {
    const response = await page.goto("/")
    expect(response?.status()).toBe(200)

    const title = page.locator("#philosophy a.glass-card-sm--hp-note h3").first()
    await expect(title).toBeVisible()
    await title.evaluate((element) => {
      element.textContent = "カラーコレクションの因数分解とポストプロダクションワークフロー設計を横断する長いノートタイトル"
    })

    const metrics = await title.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }))

    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth)
  })
})
