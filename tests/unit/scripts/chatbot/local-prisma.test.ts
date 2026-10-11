import { describe, expect, it } from "vitest"

import { resolveLocalPrismaConfig } from "@/../scripts/chatbot/local-prisma"

describe("local chatbot Prisma config", () => {
  it("uses the same Turso database as the app runtime when available", () => {
    expect(
      resolveLocalPrismaConfig({
        TURSO_DATABASE_URL: "libsql://example.turso.io",
        TURSO_AUTH_TOKEN: "token",
        PRISMA_MIGRATE_DATABASE_URL: "file:./dev.db",
      }),
    ).toEqual({
      url: "libsql://example.turso.io",
      authToken: "token",
    })
  })

  it("falls back to the migrate database when Turso is not configured", () => {
    expect(
      resolveLocalPrismaConfig({
        PRISMA_MIGRATE_DATABASE_URL: "file:/tmp/dev.db",
      }),
    ).toEqual({
      url: "file:/tmp/dev.db",
    })
  })

  it.each(["TURSO_DATABASE_URL", "PRISMA_MIGRATE_DATABASE_URL"])(
    "rejects an inherited production URL in %s",
    (key) => {
      expect(() => resolveLocalPrismaConfig({
        [key]: "libsql://norikane-studio-norituku.aws-ap-northeast-1.turso.io",
      })).toThrow("production_database_access_disabled")
    },
  )
})
