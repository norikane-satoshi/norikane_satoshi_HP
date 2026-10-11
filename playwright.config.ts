import { defineConfig, devices } from "@playwright/test"

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:41241"
const serverUrl = new URL(baseURL)
if (!["localhost", "127.0.0.1", "[::1]"].includes(serverUrl.hostname)) {
  throw new Error("E2E requires its own local verification server")
}
const devPort = serverUrl.port || "41241"
const e2eDatabaseUrl = process.env.E2E_DATABASE_URL ?? "file:./test-results/e2e.db"
if (!e2eDatabaseUrl.startsWith("file:")) throw new Error("E2E requires an isolated local file database")
const authSecret = process.env.AUTH_SECRET ?? "booking-e2e-auth-secret"
const calendarId = process.env.GOOGLE_CALENDAR_BUSY_SOURCE_ID ?? "e2e-calendar"
const bookingFlag = process.env.NEXT_PUBLIC_ENABLE_BOOKING ?? "true"
const chatbotFlag = process.env.NEXT_PUBLIC_ENABLE_CHATBOT ?? "true"

process.env.BOOKING_EXTERNAL_WRITES = "disabled"
process.env.TURSO_AUTH_TOKEN = ""
process.env.TURSO_DATABASE_URL = e2eDatabaseUrl
process.env.AUTH_SECRET = authSecret
process.env.GOOGLE_CALENDAR_BUSY_SOURCE_ID = calendarId
process.env.PRISMA_MIGRATE_DATABASE_URL = e2eDatabaseUrl
process.env.NEXT_PUBLIC_ENABLE_BOOKING = bookingFlag
process.env.NEXT_PUBLIC_ENABLE_CHATBOT = chatbotFlag

const verificationEnv = {
  TURSO_DATABASE_URL: e2eDatabaseUrl,
  TURSO_AUTH_TOKEN: "",
  AUTH_SECRET: authSecret,
  GOOGLE_CALENDAR_BUSY_SOURCE_ID: calendarId,
  PRISMA_MIGRATE_DATABASE_URL: e2eDatabaseUrl,
  NEXT_PUBLIC_ENABLE_BOOKING: bookingFlag,
  NEXT_PUBLIC_ENABLE_CHATBOT: chatbotFlag,
  NOTION_TOKEN: "",
  BOOKING_EXTERNAL_WRITES: "disabled",
  PORT: devPort,
}

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  outputDir: ".playwright/test-results",
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "mkdir -p .playwright test-results && corepack pnpm exec prisma migrate deploy && corepack pnpm dev --webpack",
    env: verificationEnv,
    url: baseURL,
    timeout: 120_000,
    reuseExistingServer: false,
  },
})
