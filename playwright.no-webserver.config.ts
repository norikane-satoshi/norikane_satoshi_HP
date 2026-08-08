import { defineConfig, devices } from "@playwright/test"

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:41244"
const e2eDatabaseUrl = process.env.TURSO_DATABASE_URL ?? "file:test-results/e2e-libsql.db"
const authSecret = process.env.AUTH_SECRET ?? "booking-e2e-auth-secret"
const calendarId = process.env.GOOGLE_CALENDAR_BUSY_SOURCE_ID ?? "e2e-calendar"

process.env.E2E_BASE_URL = baseURL
process.env.TURSO_DATABASE_URL = e2eDatabaseUrl
process.env.AUTH_SECRET = authSecret
process.env.GOOGLE_CALENDAR_BUSY_SOURCE_ID = calendarId
process.env.PRISMA_MIGRATE_DATABASE_URL ??= e2eDatabaseUrl

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
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
})
