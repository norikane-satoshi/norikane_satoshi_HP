import { expect, test, type Page } from "@playwright/test"

const assistantName = "AI 相談窓口"

async function clearWidgetState(page: Page) {
  await page.addInitScript(() => window.localStorage.clear())
}

async function expectChatbotOpen(page: Page) {
  await expect(page.getByRole("complementary", { name: assistantName })).toBeVisible()
  await expect(page.getByLabel("相談内容")).toBeVisible()
}

test.describe("root chatbot entry", () => {
  test("shows the chatbot widget on the root page after the scroll trigger", async ({ page }) => {
    await clearWidgetState(page)

    const response = await page.goto("/")
    expect(response?.status()).toBe(200)
    await expect(page.getByRole("complementary", { name: assistantName })).toHaveCount(0)

    await page.evaluate(() => window.scrollTo(0, Math.ceil(window.innerHeight * 0.3)))

    await expectChatbotOpen(page)
    await expect(page.getByText("のりかね映像設計室のご相談窓口")).toBeVisible()
  })

  test("opens the chatbot from the legacy contact hash", async ({ page }) => {
    await clearWidgetState(page)

    const response = await page.goto("/#contact")
    expect(response?.status()).toBe(200)

    await expectChatbotOpen(page)
  })

  test("opens the chatbot from the header contact action", async ({ page }) => {
    await clearWidgetState(page)
    let postedMessage: string | undefined
    await page.route("**/api/chatbot/message", async (route) => {
      const requestBody = route.request().postDataJSON() as { message?: string }
      postedMessage = requestBody.message
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          conversationId: "root-entry-conversation",
          assistantMessage: {
            role: "assistant",
            content: "最終媒体を教えてください",
            createdAt: new Date("2026-05-28T00:00:00.000Z").toISOString(),
          },
          tier: "tier-4-form-fallback",
          ui: {
            kind: "choice-panel",
            choiceSet: {
              id: "final-medium",
              question: "最終媒体を教えてください",
              choices: [{ id: "web", label: "Web" }],
            },
          },
        }),
      })
    })

    const response = await page.goto("/")
    expect(response?.status()).toBe(200)
    await page.getByRole("button", { name: "お問い合わせ" }).click()

    await expectChatbotOpen(page)
    await page.getByLabel("相談内容").fill("Web CM の相談です")
    await page.getByRole("button", { name: "送信" }).click()
    await expect(page.getByText("Local debug: Actual: Tier 4 form fallback (tier-4-form-fallback)")).toBeVisible()
    await expect(page.getByRole("region", { name: "最終媒体を教えてください" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Web" })).toBeVisible()
    expect(postedMessage).toBe("Web CM の相談です")
  })

  test("keeps chat state across legal page navigation and browser back", async ({ page }) => {
    await page.route("**/api/chatbot/message", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          conversationId: "persisted-e2e-conversation",
          assistantMessage: {
            role: "assistant",
            content: '<lang primary="ja-JP"/>空き状況の候補を確認します。',
            createdAt: new Date("2026-05-28T00:00:00.000Z").toISOString(),
          },
          tier: "tier-3-ollama-deepseek",
          ui: { kind: "none" },
        }),
      })
    })

    await page.goto("/")
    await page.getByRole("button", { name: "お問い合わせ" }).click()
    await page.getByLabel("相談内容").fill("Web CM の相談です")
    await page.getByRole("button", { name: "送信" }).click()

    await expect(page.getByText("空き状況の候補を確認します。")).toBeVisible()
    await expect(page.getByText("<lang")).toHaveCount(0)

    await page.goto("/privacy")
    await expect(page.getByRole("heading", { name: "プライバシーポリシー" })).toBeVisible()
    await page.goBack()

    await expectChatbotOpen(page)
    await expect(page.getByText("Web CM の相談です")).toBeVisible()
    await expect(page.getByText("空き状況の候補を確認します。")).toBeVisible()

    await page.goto("/terms")
    await expect(page.getByRole("heading", { name: "利用規約" })).toBeVisible()
    await page.goBack()
    await expect(page.getByText("Web CM の相談です")).toBeVisible()
  })

  test("keeps Enter as newline, submits with Cmd Enter, and shows pending state", async ({ page }) => {
    await clearWidgetState(page)
    let postedMessage: string | undefined
    await page.route("**/api/chatbot/message", async (route) => {
      postedMessage = (route.request().postDataJSON() as { message?: string }).message
      await new Promise((resolve) => setTimeout(resolve, 150))
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          conversationId: "input-e2e-conversation",
          assistantMessage: {
            role: "assistant",
            content: "受け取りました。",
            createdAt: new Date("2026-05-28T00:00:00.000Z").toISOString(),
          },
          tier: "tier-3-ollama-deepseek",
          ui: { kind: "none" },
        }),
      })
    })

    await page.goto("/")
    await page.getByRole("button", { name: "お問い合わせ" }).click()
    const input = page.getByLabel("相談内容")
    await input.fill("1行目")
    await input.press("Enter")
    await input.fill("1行目\n2行目")
    await input.press(process.platform === "darwin" ? "Meta+Enter" : "Control+Enter")

    await expect(page.getByRole("status", { name: "応答を作成中" })).toBeVisible()
    await expect(page.getByText("受け取りました。")).toBeVisible()
    expect(postedMessage).toBe("1行目\n2行目")
  })
})
