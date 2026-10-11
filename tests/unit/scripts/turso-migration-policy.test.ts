import { describe, expect, it } from "vitest"

import { decideTursoMigrationExecution } from "../../../scripts/lib/turso-migration-policy"

describe("Turso migration execution policy", () => {
  it.each(["preview", "development", undefined])(
    "blocks Vercel %s builds from mutating the database",
    (vercelEnv) => {
      expect(
        decideTursoMigrationExecution({
          VERCEL: "1",
          VERCEL_ENV: vercelEnv,
        })
      ).toEqual({ action: "skip", reason: "vercel-non-production" })
    }
  )

  it("allows Vercel Production builds", () => {
    expect(
      decideTursoMigrationExecution({
        NODE_ENV: "production",
        VERCEL: "1",
        VERCEL_ENV: "production",
        TURSO_DATABASE_URL: "libsql://norikane-studio-norituku.aws-ap-northeast-1.turso.io",
      })
    ).toEqual({ action: "run", reason: "local-or-production" })
  })

  it("allows an explicit local migration run", () => {
    expect(decideTursoMigrationExecution({})).toEqual({
      action: "run",
      reason: "local-or-production",
    })
  })

  it.each([
    {},
    { NODE_ENV: "production" },
    { NODE_ENV: "production", VERCEL: "1", VERCEL_ENV: "preview" },
  ])("rejects production migrations from non-Production before opening a client: %j", (env) => {
    expect(() => decideTursoMigrationExecution({
      ...env,
      TURSO_DATABASE_URL: "libsql://norikane-studio-norituku.aws-ap-northeast-1.turso.io",
    })).toThrow("production_database_access_disabled")
  })

  it("allows a manual migration to the dedicated preview database", () => {
    expect(decideTursoMigrationExecution({
      TURSO_DATABASE_URL: "libsql://norikane-studio-preview-norituku.aws-ap-northeast-1.turso.io",
    })).toEqual({ action: "run", reason: "local-or-production" })
  })

  it("keeps automatic Preview migrations skipped with the isolated database", () => {
    expect(decideTursoMigrationExecution({
      NODE_ENV: "production", VERCEL: "1", VERCEL_ENV: "preview",
      TURSO_DATABASE_URL: "libsql://norikane-studio-preview-norituku.aws-ap-northeast-1.turso.io",
    })).toEqual({ action: "skip", reason: "vercel-non-production" })
  })
})
