import { expect, test, type Page } from "@playwright/test"

const targetCurves =
  '[data-diagram-slug="correction-reversibility"] [data-correction-reversibility-curve]'
const controlMathCurves =
  '[data-diagram-slug="correction-control-math"] svg polyline[stroke-width="3.5"]'

async function renderedStrokeWidths(page: Page, selector: string) {
  return page.locator(selector).evaluateAll((elements) =>
    elements.map((element) => {
      const computed = window.getComputedStyle(element).strokeWidth
      const value = Number.parseFloat(computed)
      if (!Number.isFinite(value)) {
        return Number.parseFloat(element.getAttribute("stroke-width") ?? "")
      }
      return value
    }),
  )
}

test("correction reversibility RGB curves are thicker only on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 })
  const desktopResponse = await page.goto("/notes/correction")
  test.skip(desktopResponse?.status() === 404, "/notes/correction is not available in this environment")
  expect(desktopResponse?.status()).toBe(200)

  await expect(page.locator(targetCurves)).toHaveCount(6)
  const desktopWidths = await renderedStrokeWidths(page, targetCurves)
  expect(desktopWidths.every((width) => width === 3.5)).toBe(true)

  await page.setViewportSize({ width: 375, height: 812 })
  await expect(page.locator(targetCurves)).toHaveCount(6)
  const mobileWidths = await renderedStrokeWidths(page, targetCurves)
  expect(mobileWidths.every((width) => width === 6)).toBe(true)

  expect(Math.min(...mobileWidths)).toBeGreaterThan(Math.max(...desktopWidths))

  const controlWidths = await renderedStrokeWidths(page, controlMathCurves)
  expect(controlWidths.length).toBeGreaterThan(0)
  expect(controlWidths.every((width) => width === 3.5)).toBe(true)
})
