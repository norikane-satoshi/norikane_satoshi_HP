import { expect, test, type Page } from "@playwright/test"

const assistantName = "AI 相談窓口"

async function clearWidgetState(page: Page) {
  await page.addInitScript(() => window.localStorage.clear())
}

async function clearWidgetStateOnce(page: Page) {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem("chatbot-e2e-cleared") === "true") return
    window.localStorage.clear()
    window.sessionStorage.setItem("chatbot-e2e-cleared", "true")
  })
}

async function expectChatbotOpen(page: Page) {
  await expect(page.getByRole("complementary", { name: assistantName })).toBeVisible()
  await expect(page.getByLabel("相談内容")).toBeVisible()
}

async function revealMinimizedLauncher(page: Page) {
  await page.evaluate(() => window.scrollTo(0, Math.ceil(window.innerHeight * 0.3)))
  return page.getByRole("button", { name: "AI 相談窓口を開く" })
}

test.describe("root chatbot entry", () => {
  test("shows the chatbot widget on the root page after the scroll trigger", async ({ page }) => {
    await clearWidgetState(page)

    const response = await page.goto("/")
    expect(response?.status()).toBe(200)
    await expect(page.getByRole("complementary", { name: assistantName })).toHaveCount(0)

    const launcher = await revealMinimizedLauncher(page)
    await expect(launcher).toBeVisible()
    await expect(launcher).toHaveAttribute("data-attention", "true")
    await expect(launcher).toHaveClass(/chatbot-minimized-attention/)

    await launcher.click()
    await expectChatbotOpen(page)
    await expect(page.getByText("のりかね映像設計室のご相談窓口")).toBeVisible()
  })

  test("opens the chatbot from the legacy contact hash", async ({ page }) => {
    await clearWidgetState(page)

    const response = await page.goto("/#contact")
    expect(response?.status()).toBe(200)

    await expectChatbotOpen(page)
  })

  test("submits a chatbot message from the minimized launcher", async ({ page }) => {
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
    await expect(page.getByRole("button", { name: "お問い合わせ" })).toHaveCount(0)
    const launcher = await revealMinimizedLauncher(page)
    await launcher.click()

    await expectChatbotOpen(page)
    await page.getByLabel("相談内容").fill("Web CM の相談です")
    await page.getByRole("button", { name: "送信" }).click()
    await expect(page.getByRole("region", { name: "最終媒体を教えてください" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Web" })).toBeVisible()
    expect(postedMessage).toBe("Web CM の相談です")
  })

  test("keeps desktop side peek available from the chatbot shell", async ({ page }) => {
    await clearWidgetState(page)
    await page.setViewportSize({ width: 1280, height: 900 })

    const response = await page.goto("/#contact")
    expect(response?.status()).toBe(200)
    const chatbot = page.getByRole("complementary", { name: assistantName })
    await expectChatbotOpen(page)

    await chatbot.getByRole("button", { name: "サイドピーク表示に切り替え" }).click()
    await expect(chatbot.getByRole("button", { name: "フローティング表示に切り替え" })).toBeVisible()
    await expect(chatbot.getByRole("button", { name: "サイドピーク幅を変更" })).toBeVisible()
    await expect.poll(() => page.evaluate(() => document.body.classList.contains("chatbot-side-peek-active"))).toBe(true)
  })

  test("opens mobile full-screen, keeps choice panels usable, and restores after reload", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await clearWidgetStateOnce(page)
    await page.route("**/api/chatbot/message", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          conversationId: "mobile-fullscreen-conversation",
          assistantMessage: {
            role: "assistant",
            content: "追加作業を選んでください",
            createdAt: new Date("2026-05-28T00:00:00.000Z").toISOString(),
          },
          tier: "tier-2-hosted-chrome-notion-ai",
          ui: {
            kind: "choice-panel",
            choiceSet: {
              id: "additional-work",
              question: "追加作業を選んでください",
              selectionMode: "multiple",
              choices: [
                { id: "retouch", label: "消し物/レタッチ" },
                { id: "skin-retouch", label: "肌修正" },
                { id: "other", label: "その他" },
              ],
            },
          },
        }),
      })
    })

    const response = await page.goto("/#contact")
    expect(response?.status()).toBe(200)
    const chatbot = page.getByRole("complementary", { name: assistantName })
    await expectChatbotOpen(page)
    await expect(chatbot.getByRole("button", { name: "サイドピーク表示に切り替え" })).toHaveCount(0)

    await chatbot.getByRole("button", { name: "全画面表示に切り替え" }).click()
    await expect(chatbot.getByRole("button", { name: "通常表示に戻す" })).toBeVisible()
    await expect.poll(async () => (await chatbot.boundingBox())?.width).toBeGreaterThanOrEqual(389)

    await chatbot.getByLabel("相談内容").fill("Web CM の相談です")
    await chatbot.getByRole("button", { name: "送信" }).click()
    await expect(chatbot.getByRole("region", { name: "追加作業を選んでください" })).toBeVisible()
    await chatbot.getByRole("button", { name: "その他" }).click()
    await chatbot.getByLabel("その他の内容").fill("短尺版も相談したい")
    await expect(chatbot.getByRole("button", { name: "選択を送信" })).toBeVisible()

    await page.reload()
    const restoredChatbot = page.getByRole("complementary", { name: assistantName })
    await expect(restoredChatbot.getByRole("button", { name: "通常表示に戻す" })).toBeVisible()
    await expect(restoredChatbot.getByRole("region", { name: "追加作業を選んでください" })).toBeVisible()

    await restoredChatbot.getByRole("button", { name: "通常表示に戻す" }).click()
    await expect(restoredChatbot.getByRole("button", { name: "全画面表示に切り替え" })).toBeVisible()
  })
})
