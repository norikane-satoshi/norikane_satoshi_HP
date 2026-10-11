import { homedir } from "node:os"
import path from "node:path"

import { PrismaClient } from "@prisma/client"
import { PrismaLibSql } from "@prisma/adapter-libsql"
import { config as loadDotenv } from "dotenv"
import { assertDatabaseTargetAllowed } from "../../src/lib/database-target-policy.mjs"

loadDotenv({ path: ".env.local", override: false, quiet: true })
loadDotenv({
  path: path.join(homedir(), "projects", "norikane_satoshi_HP", ".env.local"),
  override: false,
  quiet: true,
})
loadDotenv({ path: ".env", override: false, quiet: true })

type LocalPrismaEnv = Readonly<Record<string, string | undefined>>

type LocalPrismaConfig = {
  url: string
  authToken?: string
}

export function createLocalPrismaClient(): PrismaClient {
  const adapter = new PrismaLibSql(resolveLocalPrismaConfig(process.env))
  return new PrismaClient({ adapter })
}

export function resolveLocalPrismaConfig(env: LocalPrismaEnv): LocalPrismaConfig {
  const tursoUrl = present(env.TURSO_DATABASE_URL)
  const url = tursoUrl ?? present(env.PRISMA_MIGRATE_DATABASE_URL) ?? "file:./dev.db"
  assertDatabaseTargetAllowed({ ...env, TURSO_DATABASE_URL: url })
  if (tursoUrl) {
    const authToken = present(env.TURSO_AUTH_TOKEN)
    return authToken ? { url: tursoUrl, authToken } : { url: tursoUrl }
  }

  return {
    url,
  }
}

function present(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}
