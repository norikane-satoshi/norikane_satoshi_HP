import { PrismaClient } from "@prisma/client"
import { PrismaLibSql } from "@prisma/adapter-libsql"
import { config as loadDotenv } from "dotenv"

loadDotenv({ path: ".env.local", override: false, quiet: true })
loadDotenv({ path: ".env", override: false, quiet: true })

export function createLocalPrismaClient(): PrismaClient {
  const url = process.env.PRISMA_MIGRATE_DATABASE_URL ?? "file:./dev.db"
  const adapter = new PrismaLibSql({ url })
  return new PrismaClient({ adapter })
}
