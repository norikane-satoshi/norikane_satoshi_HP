import { expect, test } from "@playwright/test"

test.skip(process.env.NEXT_PUBLIC_ENABLE_CHATBOT !== "true", "requires enabled chatbot flag")

const assistantCreatedAt = "2026-05-26T00:00:00.000Z"

function assistantResponse(content: string, ui: Record<string, unknown>) {
  return {
    conversationId: "conv_e2e",
    assistantMessage: {
      role: "assistant",
      content,
      createdAt: assistantCreatedAt,
    },
    tier: "tier-4-form-fallback",
    ui,
  }
}

test.describe("chatbot widget mocked API flow", () => {
  test("renders mocked message, choice panel, tier4 form, and login card without external services", async ({ page }) => {
    const blockedExternalRequests: string[] = []

    page.on("request", (request) => {
      const url = request.url()
      if (/(notion|ollama|resend|googleapis|generativelanguage|calendar\.google)/i.test(url)) {
        blockedExternalRequests.push(url)
      }
    })

    await page.route("**/api/chatbot/message", async (route) => {
      const payload = route.request().postDataJSON() as { message?: string }
      const message = payload.message ?? ""

      if (message.includes("選択:")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(assistantResponse("フォームに切り替えます", { kind: "tier4-inquiry-form" })),
        })
        return
      }

      if (message.includes("予約")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(
            assistantResponse("候補日時から予約できます", {
              kind: "booking-card",
              suggestedSlots: [
                {
                  start: "2026-07-10T01:00:00.000Z",
                  end: "2026-07-10T02:00:00.000Z",
                  label: "7月10日 午前",
                },
              ],
              jobContext: {
                finalMedium: "web",
                workSite: "remote-grading",
                documentaryAttachment: { kind: "none" },
                workflowEstimate: { stages: [], totalMinDays: 1, totalMaxDays: 1, riskFlags: [] },
              },
            }),
          ),
        })
        return
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          assistantResponse("最終媒体を選んでください", {
            kind: "choice-panel",
            choiceSet: {
              id: "final-medium",
              question: "最終媒体を教えてください",
              choices: [
                { id: "web", label: "Web 配信" },
                { id: "cinema", label: "劇場上映" },
              ],
            },
          }),
        ),
      })
    })

    await page.route("**/api/chatbot/submit-inquiry", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      })
    })

    await page.route("**/api/chatbot/booking-candidates", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          candidates: [
            {
              start: "2026-07-10T01:00:00.000Z",
              end: "2026-07-10T02:00:00.000Z",
              label: "7月10日 午前",
            },
          ],
          busyDateKeys: [],
        }),
      })
    })

    await page.route("**/api/chatbot/create-booking-from-chat", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          bookingGroupId: "booking_e2e",
          bookingIds: ["booking_e2e_1"],
          scheduleLabel: "7/10(金)",
        }),
      })
    })

    await page.goto("/#contact")
    const chatbot = page.getByRole("complementary", { name: "AI 相談窓口" })
    await expect(chatbot).toBeVisible()

    await chatbot.getByLabel("相談内容").fill("相談したいです")
    await chatbot.getByRole("button", { name: "送信" }).click()
    await expect(chatbot.getByText("相談したいです")).toBeVisible()
    await expect(chatbot.getByText("最終媒体を選んでください")).toBeVisible()
    await expect(chatbot.getByRole("button", { name: "Web 配信" })).toBeVisible()

    await chatbot.getByRole("button", { name: "Web 配信" }).click()
    await expect(chatbot.getByLabel("問い合わせフォーム")).toBeVisible()
    await chatbot.getByLabel("氏名").fill("田中")
    await chatbot.getByLabel("メールアドレス").fill("client@example.com")
    await chatbot.getByLabel("問い合わせフォーム").getByRole("button", { name: "送信" }).click()
    await expect(chatbot.getByText("送信しました。担当者からの返信をお待ちください。")).toBeVisible()

    await chatbot.getByLabel("相談内容").fill("予約したいです")
    await chatbot.getByRole("button", { name: "送信" }).click()
    await expect(chatbot.getByText("候補日時から予約できます")).toBeVisible()
    await expect(chatbot.getByRole("button", { name: "2026-07-10 選択可" })).toHaveAttribute("aria-pressed", "true")
    await chatbot.getByLabel("案件名").fill("E2E booking")
    await chatbot.getByLabel("担当者氏名").fill("田中")
    await chatbot.getByLabel("メールアドレス").fill("client@example.com")
    await chatbot.getByRole("checkbox").check()
    await chatbot.getByRole("button", { name: "予約内容を送信" }).click()
    await expect(chatbot.getByRole("heading", { name: "予約を受け付けました" })).toBeVisible()
    expect(blockedExternalRequests).toEqual([])
  })
})
