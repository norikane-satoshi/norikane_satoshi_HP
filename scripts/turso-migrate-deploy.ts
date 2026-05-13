// Prisma 7 schema engine は libsql:// を直接話せないため、prisma migrate dev は
// ローカル file: SQLite に対して migration.sql を生成し、本番 Turso への反映は
// このスクリプトが libsql client 経由で SQL を直接流す。
//
// 既適用 migration は libsql 上の _prisma_migrations_applied に記録して二重適用を防ぐ。
// `prisma migrate` が管理する _prisma_migrations テーブルは file: 側に閉じる。
//
// 使い方:
//   npx tsx scripts/turso-migrate-deploy.ts            # .env.local の TURSO_* に対して実行
//   PRISMA_MIGRATE_DATABASE_URL=... 等は無視。常に TURSO_DATABASE_URL を見る。

import { readFile, readdir } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createClient } from "@libsql/client"
import { config as loadDotenv } from "dotenv"

loadDotenv({ path: ".env.local", override: false, quiet: true })
loadDotenv({ path: ".env", override: false, quiet: true })

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = path.resolve(__dirname, "..", "prisma", "migrations")
const APPLIED_TABLE = "_prisma_migrations_applied"

type MigrationDir = {
  name: string
  sqlPath: string
}

async function listMigrations(): Promise<MigrationDir[]> {
  const entries = await readdir(MIGRATIONS_DIR, { withFileTypes: true })
  const dirs = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((n) => /^\d{14}_/.test(n))
    .sort()
  return dirs.map((name) => ({
    name,
    sqlPath: path.join(MIGRATIONS_DIR, name, "migration.sql"),
  }))
}

function splitStatements(sql: string): string[] {
  const stripped = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
  return stripped
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

async function main(): Promise<void> {
  const url = process.env.TURSO_DATABASE_URL
  const authToken = process.env.TURSO_AUTH_TOKEN
  if (!url) throw new Error("TURSO_DATABASE_URL is not set")

  const client = createClient({ url, authToken })

  await client.execute(
    `CREATE TABLE IF NOT EXISTS ${APPLIED_TABLE} (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  )

  const applied = new Set<string>()
  const rs = await client.execute(`SELECT name FROM ${APPLIED_TABLE}`)
  for (const row of rs.rows) {
    const name = (row as Record<string, unknown>).name
    if (typeof name === "string") applied.add(name)
  }

  const migrations = await listMigrations()
  let appliedCount = 0
  for (const m of migrations) {
    if (applied.has(m.name)) continue
    const sql = await readFile(m.sqlPath, "utf-8")
    const statements = splitStatements(sql)
    console.log(`[apply] ${m.name} (${statements.length} statements)`)
    for (const stmt of statements) {
      await client.execute(stmt)
    }
    await client.execute({
      sql: `INSERT INTO ${APPLIED_TABLE}(name) VALUES (?)`,
      args: [m.name],
    })
    appliedCount += 1
  }

  if (appliedCount === 0) {
    console.log("[ok] no pending migrations")
  } else {
    console.log(`[ok] applied ${appliedCount} migration(s)`)
  }
  client.close()
}

main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
