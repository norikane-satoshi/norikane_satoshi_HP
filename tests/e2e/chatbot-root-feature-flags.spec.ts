import { expect, test } from "@playwright/test"

test.skip(
  process.env.NEXT_PUBLIC_ENABLE_CHATBOT !== "true" ||
    process.env.NEXT_PUBLIC_ENABLE_BOOKING !== "true",
  "requires enabled booking/chatbot flags",
)

test.describe("root chatbot and legal links", () => {
  test("renders the root page with booking and chatbot surfaces enabled", async ({ page }) => {
    await page.goto("/")

    await expect(page.getByRole("heading", { name: "フリーランスカラリスト" })).toBeVisible()
    await expect(page.locator("section#schedule")).toBeVisible()
    await expect(page.getByRole("button", { name: "お問い合わせ" }).first()).toBeVisible()
  })

  test("opens the chatbot from #contact and exposes the security/legal links", async ({ page }) => {
    await page.goto("/#contact")

    const chatbot = page.getByRole("complementary", { name: "AI 相談窓口" })
    await expect(chatbot).toBeVisible()
    await expect(chatbot.getByText("ご相談や案件依頼はこちらです。")).toBeVisible()

    await chatbot.getByRole("button", { name: "安全に扱います" }).click()
    await expect(chatbot.getByRole("link", { name: "プライバシーポリシー" })).toHaveAttribute("href", "/privacy")
    await expect(chatbot.getByRole("link", { name: "利用規約" })).toHaveAttribute("href", "/terms")
    await expect(page.locator("section#schedule")).toBeVisible()
  })

  test("opens the chatbot from the desktop contact nav", async ({ page }) => {
    await page.goto("/")
    await page.getByRole("button", { name: "お問い合わせ" }).first().click()

    await expect(page.getByRole("complementary", { name: "AI 相談窓口" })).toBeVisible()
  })

  test("renders legal pages from the footer links", async ({ page }) => {
    await page.goto("/")

    const footer = page.locator("footer")
    await expect(footer.getByRole("link", { name: "プライバシーポリシー" })).toHaveAttribute("href", "/privacy")
    await expect(footer.getByRole("link", { name: "利用規約" })).toHaveAttribute("href", "/terms")

    await footer.getByRole("link", { name: "プライバシーポリシー" }).click()
    await expect(page).toHaveURL(/\/privacy$/)
    await expect(page.getByRole("heading", { name: "プライバシーポリシー" })).toBeVisible()

    await page.goto("/")
    await page.locator("footer").getByRole("link", { name: "利用規約" }).click()
    await expect(page).toHaveURL(/\/terms$/)
    await expect(page.getByRole("heading", { name: "利用規約" })).toBeVisible()
  })

  test("renders legal pages directly", async ({ page }) => {
    await page.goto("/privacy")
    await expect(page.getByRole("heading", { name: "プライバシーポリシー" })).toBeVisible()

    await page.goto("/terms")
    await expect(page.getByRole("heading", { name: "利用規約" })).toBeVisible()
  })
})
