import { expect, test } from "@playwright/test"

test.skip(process.env.NEXT_PUBLIC_ENABLE_CHATBOT !== "true", "requires enabled chatbot flag")

test("renders Booking Order prefill fields without cross-field leakage", async ({ page }) => {
  await page.route("**/api/chatbot/message", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        conversationId: "conv_prefill_e2e",
        assistantMessage: {
          role: "assistant",
          content: "候補日時から予約できます",
          createdAt: "2026-07-05T00:00:00.000Z",
        },
        tier: "tier-2-hosted-chrome-notion-ai",
        ui: {
          kind: "booking-card",
          suggestedSlots: [
            {
              start: "2026-07-10T01:00:00.000Z",
              end: "2026-07-10T02:00:00.000Z",
              label: "7月10日 午前",
            },
          ],
          jobContext: {
            jobKind: "live-60m",
            finalMedium: "live",
            projectLengthMinutes: 150,
            workSite: "remote-grading",
            documentaryAttachment: { kind: "none" },
            workflowEstimate: { stages: [], totalMinDays: 1, totalMaxDays: 1, riskFlags: [] },
          },
          bookingPrefill: {
            contactName: "田中 太郎",
            companyName: "株式会社サンプル",
            contactEmail: "client@example.jp",
            memo: "共有事項: 当日立ち会い希望",
          },
        },
      }),
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

  await page.goto("/#contact")
  const chatbot = page.getByRole("complementary", { name: "AI 相談窓口" })
  await expect(chatbot).toBeVisible()

  await chatbot.getByLabel("相談内容").fill("ライブ案件の予約相談です。田中 太郎、株式会社サンプル、client@example.jp です。")
  await chatbot.getByRole("button", { name: "送信" }).click()

  await expect(chatbot.getByText("候補日時から予約できます")).toBeVisible()
  await expect(chatbot.getByLabel("案件名")).toHaveValue("")
  await expect(chatbot.getByLabel("氏名")).toHaveValue("田中 太郎")
  await expect(chatbot.getByLabel("会社名")).toHaveValue("株式会社サンプル")
  await expect(chatbot.getByLabel("メール")).toHaveValue("client@example.jp")
  await expect(chatbot.getByLabel("補足")).toHaveValue(
    "共有事項: 当日立ち会い希望\n尺: 2.5h\n作業場所: リモート",
  )
})
