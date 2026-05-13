import { PrismaClient } from "@prisma/client"
import { PrismaLibSql } from "@prisma/adapter-libsql"

declare global {
  // Next.js dev では HMR で module が再評価され、毎回 PrismaClient を作ると接続が増えていく。
  var __prisma: PrismaClient | undefined
}

function createPrismaClient(): PrismaClient {
  const url = process.env.TURSO_DATABASE_URL
  const authToken = process.env.TURSO_AUTH_TOKEN
  if (!url) {
    throw new Error("TURSO_DATABASE_URL is not set")
  }
  const adapter = new PrismaLibSql({ url, authToken })
  return new PrismaClient({ adapter })
}

export const prisma: PrismaClient = globalThis.__prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== "production") {
  globalThis.__prisma = prisma
}
