import { expect, test } from "@playwright/test"

const trainerUrl =
  "https://www.blackmagicdesign.com/jp/products/davinciresolve/training#partners"
const trainerBaseUrl =
  "https://www.blackmagicdesign.com/jp/products/davinciresolve/training"

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

test("DaVinci Resolve trainer click reapplies the partners anchor after delayed page layout", async ({
  page,
  context,
}) => {
  await context.route(`${trainerBaseUrl}*`, async (route) => {
    await route.fulfill({
      contentType: "text/html",
      body: `<!doctype html>
        <html>
          <head><title>Blackmagic Design training mock</title></head>
          <body>
            <main id="root">
              <div style="height: 3600px">Training page loading</div>
            </main>
            <script>
              window.openerWasNull = window.opener === null;
              setTimeout(() => {
                const partners = document.createElement("section");
                partners.id = "partners";
                partners.textContent = "Training Type Country Prefecture";
                partners.style.height = "400px";
                document.getElementById("root").appendChild(partners);
              }, 900);
            </script>
          </body>
        </html>`,
    })
  })

  const response = await page.goto("/")
  expect(response?.status()).toBe(200)

  const link = page.getByRole("link", { name: "DaVinci Resolve 認定トレーナー" })
  const popupPromise = page.waitForEvent("popup")
  await link.click()
  const popup = await popupPromise

  await expect.poll(() => popup.url(), { timeout: 10_000 }).toBe(trainerUrl)
  await expect
    .poll(
      async () =>
        popup.evaluate(() => {
          const partners = document.querySelector("#partners")
          if (!partners) {
            return null
          }
          return Math.round(partners.getBoundingClientRect().top)
        }),
      { timeout: 10_000 },
    )
    .toBeLessThanOrEqual(8)
  await expect.poll(() => popup.evaluate(() => window.opener === null)).toBe(true)
  await expect
    .poll(() => popup.evaluate(() => (window as typeof window & { openerWasNull?: boolean }).openerWasNull))
    .toBe(true)
})
