import { defineConfig } from "prisma/config"
import { config as loadDotenv } from "dotenv"

// Prisma CLI は .env のみ自動ロード。.env.local も読ませて TURSO_* / DATABASE_URL を拾う。
// override:false で既存 process.env を尊重する。
loadDotenv({ path: ".env.local", override: false, quiet: true })
loadDotenv({ path: ".env", override: false, quiet: true })

// Prisma 7 の schema engine は libsql:// を直接話せないため、migration 生成・適用は
// ローカル file: SQLite に対して行う。本番 Turso への反映は scripts/turso-migrate-deploy.ts
// が migrations フォルダの SQL を libsql adapter 経由で流す。
const localDevUrl = "file:./dev.db"
const datasourceUrl = process.env.PRISMA_MIGRATE_DATABASE_URL ?? localDevUrl

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: datasourceUrl,
  },
})
