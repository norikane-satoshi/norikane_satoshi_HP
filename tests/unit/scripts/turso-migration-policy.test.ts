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
        VERCEL: "1",
        VERCEL_ENV: "production",
      })
    ).toEqual({ action: "run", reason: "local-or-production" })
  })

  it("allows an explicit local migration run", () => {
    expect(decideTursoMigrationExecution({})).toEqual({
      action: "run",
      reason: "local-or-production",
    })
  })
})
