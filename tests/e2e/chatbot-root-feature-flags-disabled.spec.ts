import { expect, test } from "@playwright/test"

test.skip(
  process.env.NEXT_PUBLIC_ENABLE_CHATBOT !== "false" ||
    process.env.NEXT_PUBLIC_ENABLE_BOOKING !== "false",
  "requires disabled booking/chatbot flags",
)

test.describe("root disabled feature flags", () => {
  test("does not render booking or chatbot surfaces when both flags are false", async ({ page }) => {
    await page.goto("/")

    await expect(page.locator("section#schedule")).toHaveCount(0)
    await expect(page.getByRole("complementary", { name: "AI 相談窓口" })).toHaveCount(0)

    await page.goto("/#contact")
    await expect(page.getByRole("complementary", { name: "AI 相談窓口" })).toHaveCount(0)
  })
})
