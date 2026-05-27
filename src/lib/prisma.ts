import { PrismaClient } from "@prisma/client"
import { PrismaLibSql } from "@prisma/adapter-libsql"

declare global {
  // Next.js dev では HMR で module が再評価され、毎回 PrismaClient を作ると接続が増えていく。
  var __prisma: PrismaClient | undefined
  var __prismaUrl: string | undefined
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

const prismaUrl = process.env.TURSO_DATABASE_URL
const cachedPrisma = globalThis.__prismaUrl === prismaUrl ? globalThis.__prisma : undefined

export const prisma: PrismaClient = cachedPrisma ?? createPrismaClient()

if (process.env.NODE_ENV !== "production") {
  if (globalThis.__prisma && globalThis.__prisma !== prisma) {
    void globalThis.__prisma.$disconnect().catch(() => undefined)
  }
  globalThis.__prisma = prisma
  globalThis.__prismaUrl = prismaUrl
}
