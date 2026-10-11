import { describe, expect, it } from "vitest"
import { assertDatabaseTargetAllowed, getDatabaseTarget } from "@/lib/database-target-policy.mjs"

const productionUrl = "libsql://norikane-studio-norituku.aws-ap-northeast-1.turso.io"
const previewUrl = "libsql://norikane-studio-preview-norituku.aws-ap-northeast-1.turso.io"
const production = { NODE_ENV: "production", VERCEL: "1", VERCEL_ENV: "production" }

describe("database target isolation", () => {
  it.each([
    {},
    { NODE_ENV: "production" },
    { ...production, VERCEL: undefined },
    { ...production, VERCEL_ENV: "preview" },
    { ...production, VERCEL_ENV: "development" },
    { ...production, VERCEL_ENV: undefined },
    { ...production, NODE_ENV: "test" },
    { ...production, VITEST: "true" },
  ])("rejects production credentials outside deployed Production: %j", (env) => {
    expect(() => assertDatabaseTargetAllowed({
      ...env, TURSO_DATABASE_URL: productionUrl, TURSO_AUTH_TOKEN: "secret-token",
    })).toThrow(/^production_database_access_disabled$/)
  })

  it("keeps deployed Production connected to its existing database", () => {
    expect(() => assertDatabaseTargetAllowed({ ...production, TURSO_DATABASE_URL: productionUrl }))
      .not.toThrow()
  })

  it.each([
    "file:./dev.db",
    "file:/tmp/isolated.db",
    previewUrl,
    "libsql://another-dedicated-preview.turso.io",
  ])("allows isolated local and preview targets: %s", (url) => {
    expect(() => assertDatabaseTargetAllowed({
      NODE_ENV: "production", VERCEL: "1", VERCEL_ENV: "preview", TURSO_DATABASE_URL: url,
    })).not.toThrow()
  })

  it.each([
    productionUrl,
    "https://norikane-studio-norituku.turso.io",
    "libsql://%6eorikane-studio-norituku.aws-ap-northeast-1.turso.io",
    "libsql://NORIKANE-STUDIO-NORITUKU.aws-ap-northeast-1.turso.io.:443?authToken=secret",
  ])("recognizes the production database across endpoint forms: %s", (url) => {
    expect(getDatabaseTarget({ TURSO_DATABASE_URL: url })).toEqual({
      role: "production", identifier: "norikane-studio",
    })
    expect(() => assertDatabaseTargetAllowed({ TURSO_DATABASE_URL: url })).toThrow()
  })

  it("does not confuse the preview name with the production prefix", () => {
    expect(getDatabaseTarget({ TURSO_DATABASE_URL: previewUrl })).toEqual({
      role: "preview", identifier: "norikane-studio-preview",
    })
  })

  it.each([undefined, "", "secret-malformed-value", "https://private.example/path?token=secret"])(
    "returns only an allowlisted diagnostic for unrecognized URLs",
    (url) => {
      expect(getDatabaseTarget({ TURSO_DATABASE_URL: url, TURSO_AUTH_TOKEN: "secret-token" }))
        .toEqual({ role: "unknown", identifier: "unknown" })
    },
  )

  it("does not expose a SQLite path in diagnostics", () => {
    expect(getDatabaseTarget({ TURSO_DATABASE_URL: "file:/private/customer-data.db" })).toEqual({
      role: "local", identifier: "local-sqlite",
    })
  })
})
