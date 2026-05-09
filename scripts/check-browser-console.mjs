import { chromium } from "playwright"
import { config as loadDotenv } from "dotenv"
import { createClient } from "@libsql/client"

const [, , targetUrl, waitSecondsArg = "5", clickSelector] = process.argv

if (!targetUrl) {
  console.error("Usage: pnpm check:console <url> [waitSeconds] [postNavigateClickSelector]")
  process.exit(2)
}

const waitSeconds = Number(waitSecondsArg)
if (!Number.isFinite(waitSeconds) || waitSeconds < 0) {
  console.error("waitSeconds must be a non-negative number")
  process.exit(2)
}

const browser = await chromium.launch({ headless: true })

try {
  const context = await browser.newContext()
  const page = await context.newPage()
  const scenarioResults = []
  let activeScenario = null

  page.on("console", (msg) => {
    activeScenario?.consoleMessages.push({
      type: msg.type(),
      text: msg.text(),
      location: msg.location(),
    })
  })

  page.on("pageerror", (error) => {
    activeScenario?.pageErrors.push({
      name: error.name,
      message: error.message,
      stack: error.stack ?? null,
    })
  })

  page.on("requestfailed", (request) => {
    activeScenario?.requestFailures.push({
      url: request.url(),
      method: request.method(),
      resourceType: request.resourceType(),
      failureText: request.failure()?.errorText ?? null,
    })
  })

  const url = new URL(targetUrl)
  const consoleRunId = `E2E Booking Console ${Date.now()}`
  await page.goto(`${url.origin}/api/dev/auth-bypass`, { waitUntil: "networkidle" })

  async function cleanupConsoleBookings() {
    loadDotenv({ path: ".env.local", override: false, quiet: true })
    loadDotenv({ path: ".env", override: false, quiet: true })
    const dbUrl = process.env.TURSO_DATABASE_URL
    if (!dbUrl) return

    const client = createClient({ url: dbUrl, authToken: process.env.TURSO_AUTH_TOKEN })
    const groups = await client.execute({
      sql: "SELECT id FROM BookingGroup WHERE projectTitle LIKE ?",
      args: ["E2E Booking Console %"],
    })
    const ids = groups.rows.map((row) => String(row.id)).filter(Boolean)
    for (const id of ids) {
      await client.execute({ sql: "DELETE FROM BookingTimeSlot WHERE bookingGroupId = ?", args: [id] })
      await client.execute({ sql: "DELETE FROM BookingGroup WHERE id = ?", args: [id] })
    }
    client.close()
  }

  async function clearBookingDrafts() {
    await page.evaluate(() => {
      window.sessionStorage.removeItem("booking-draft-session")
      Object.keys(window.localStorage)
        .filter((key) => key.startsWith("booking-draft-"))
        .forEach((key) => window.localStorage.removeItem(key))
    })
  }

  async function seedBookingDraft(step = "form", valid = false) {
    await page.evaluate(({ draftStep, validDraft, runId }) => {
      const start = new Date(Date.now() + 1000 * 60 * 60 * 24 * 120)
      const end = new Date(start.getTime() + 1000 * 60 * 60)
      const selectedSlot = {
        start: start.toISOString(),
        end: end.toISOString(),
      }
      const payload = {
        formData: {
          bookingKind: "confirmed",
          projectTitle: validDraft ? runId : "",
          dueDate: "",
          companyName: "",
          contactName: validDraft ? "Console Tester" : "",
          sessionEmail: "norikane.satoshi@gmail.com",
          contactEmail: "",
          phone: "",
          memo: "",
          agreed: validDraft,
        },
        selectedSlot,
        selectedSlots: [selectedSlot],
        step: draftStep,
        savedAt: Date.now(),
      }
      window.sessionStorage.setItem("booking-draft-session", JSON.stringify(payload))
    }, { draftStep: step, validDraft: valid, runId: consoleRunId })
  }

  async function runScenario(name, action) {
    activeScenario = {
      name,
      consoleMessages: [],
      pageErrors: [],
      requestFailures: [],
    }
    await clearBookingDrafts()
    await action()
    await page.waitForTimeout(waitSeconds * 1000)
    const consoleErrorCount = activeScenario.consoleMessages.filter((message) => message.type === "error").length
    scenarioResults.push({
      name,
      consoleErrorCount,
      pageErrorCount: activeScenario.pageErrors.length,
      requestFailureCount: activeScenario.requestFailures.length,
      consoleMessages: activeScenario.consoleMessages,
      pageErrors: activeScenario.pageErrors,
      requestFailures: activeScenario.requestFailures,
    })
    activeScenario = null
  }

  const isBookingSuite = url.pathname === "/booking" && !clickSelector

  if (isBookingSuite) {
    await cleanupConsoleBookings()
    await runScenario("s1-calendar-month", async () => {
      await page.goto(`${url.origin}/booking?step=calendar`, { waitUntil: "networkidle" })
      await page.locator(".booking-calendar__surface").waitFor()
    })

    await runScenario("s2-calendar-week", async () => {
      await page.goto(`${url.origin}/booking?step=calendar`, { waitUntil: "networkidle" })
      await page.locator("[data-view=\"week\"]").click()
      await page.locator(".fc-timeGridWeek-view").waitFor()
    })

    await runScenario("s3-calendar-day", async () => {
      await page.goto(`${url.origin}/booking?step=calendar`, { waitUntil: "networkidle" })
      await page.locator("[data-view=\"day\"]").click()
      await page.locator(".fc-timeGridDay-view").waitFor()
    })

    await runScenario("s4-form-initial", async () => {
      await page.goto(`${url.origin}/booking?step=form`, { waitUntil: "networkidle" })
      await page.locator(".booking-form").waitFor()
    })

    await runScenario("s5-form-valid", async () => {
      await seedBookingDraft("form")
      await page.goto(`${url.origin}/booking?step=form`, { waitUntil: "networkidle" })
      await page.locator("input[name=\"projectTitle\"]").fill("Console check")
      await page.locator("input[name=\"contactName\"]").fill("Console Tester")
      await page.locator("input[name=\"agreed\"]").check()
      await page.locator(".booking-footer__primary").waitFor({ state: "visible" })
      await page.waitForFunction(() => {
        const button = document.querySelector(".booking-footer__primary")
        return button instanceof HTMLButtonElement && !button.disabled
      })
    })

    await runScenario("s6-confirm", async () => {
      await seedBookingDraft("confirm")
      await page.goto(`${url.origin}/booking?step=confirm`, { waitUntil: "networkidle" })
      await page.locator(".booking-confirm").waitFor()
    })

    await runScenario("s7-done", async () => {
      await seedBookingDraft("done")
      await page.goto(`${url.origin}/booking?step=done`, { waitUntil: "networkidle" })
      await page.locator(".booking-done").waitFor()
    })

    await runScenario("s8-confirm-submit-done", async () => {
      await seedBookingDraft("confirm", true)
      await page.goto(`${url.origin}/booking?step=confirm`, { waitUntil: "networkidle" })
      await page.locator(".booking-confirm").waitFor()
      await page.locator(".booking-footer__primary").click()
      await page.locator(".booking-done").waitFor()
      await cleanupConsoleBookings()
    })
  } else {
    await runScenario("single", async () => {
      await page.goto(targetUrl, { waitUntil: "networkidle" })

      if (clickSelector) {
        await page.locator(clickSelector).click()
      }
    })
  }

  const result = { scenarios: scenarioResults }
  console.log(JSON.stringify(result, null, 2))

  if (
    scenarioResults.some(
      (scenario) =>
        scenario.consoleErrorCount > 0 ||
        scenario.pageErrorCount > 0 ||
        scenario.requestFailureCount > 0,
    )
  ) {
    process.exitCode = 1
  }
} finally {
  await browser.close()
}
