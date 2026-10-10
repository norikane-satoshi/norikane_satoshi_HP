import { afterEach, describe, expect, it, vi } from "vitest"

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

async function configWithInheritedProduction() {
  vi.stubEnv("TURSO_DATABASE_URL", "libsql://production-db.example")
  vi.stubEnv("TURSO_AUTH_TOKEN", "production-auth")
  vi.stubEnv("PRISMA_MIGRATE_DATABASE_URL", "libsql://production-migrations.example")
  vi.stubEnv("E2E_DATABASE_URL", "file:./test-results/isolated-booking.db")
  vi.stubEnv("E2E_BASE_URL", "http://localhost:41241")
  vi.stubEnv("E2E_REUSE_SERVER", "true")
  const { default: config } = await import("../../../playwright.config")
  return config
}

describe("Playwright booking isolation", () => {
  it("replaces inherited production persistence and forces its own write-disabled server", async () => {
    const config = await configWithInheritedProduction()
    expect(process.env.TURSO_DATABASE_URL).toBe("file:./test-results/isolated-booking.db")
    expect(process.env.PRISMA_MIGRATE_DATABASE_URL).toBe(process.env.TURSO_DATABASE_URL)
    expect(process.env.TURSO_AUTH_TOKEN).toBe("")
    expect(process.env.BOOKING_EXTERNAL_WRITES).toBe("disabled")
    expect(config.webServer).toMatchObject({
      reuseExistingServer: false,
      env: {
        TURSO_DATABASE_URL: "file:./test-results/isolated-booking.db",
        PRISMA_MIGRATE_DATABASE_URL: "file:./test-results/isolated-booking.db",
        BOOKING_EXTERNAL_WRITES: "disabled",
        TURSO_AUTH_TOKEN: "",
        NOTION_TOKEN: "",
      },
    })
  })

  it("rejects an explicitly selected remote E2E database before tests can mutate it", async () => {
    vi.stubEnv("E2E_BASE_URL", "http://localhost:41241")
    vi.stubEnv("E2E_DATABASE_URL", "libsql://production-db.example")
    await expect(import("../../../playwright.config")).rejects.toThrow("isolated local file database")
  })

  it("rejects an external verification URL", async () => {
    vi.stubEnv("E2E_BASE_URL", "https://production.example")
    await expect(import("../../../playwright.config")).rejects.toThrow("own local verification server")
  })
})
