import { expect, test } from "@playwright/test"

const trainerUrl =
  "https://www.blackmagicdesign.com/jp/products/davinciresolve/training#partners"

test("DaVinci Resolve trainer link uses the verified Blackmagic partners anchor", async ({ page }) => {
  const response = await page.goto("/")
  expect(response?.status()).toBe(200)

  const link = page.getByRole("link", { name: "DaVinci Resolve 認定トレーナー" })
  await expect(link).toHaveAttribute("href", trainerUrl)
  await expect(link).not.toHaveAttribute("href", /:~:text=/)
  await expect(link).not.toHaveAttribute("href", /#TrainingType/)
  await expect(link).toHaveAttribute("target", "_blank")
  await expect(link).toHaveAttribute("rel", "noopener noreferrer")
})
