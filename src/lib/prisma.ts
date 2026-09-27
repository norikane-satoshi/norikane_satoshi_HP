import { createHash } from "node:crypto"
import { PrismaClient } from "@prisma/client"
import { PrismaLibSql } from "@prisma/adapter-libsql"

declare global {
  // Next.js dev では HMR で module が再評価され、毎回 PrismaClient を作ると接続が増えていく。
  var __prisma: PrismaClient | undefined
  var __prismaConnectionFingerprint: string | undefined
}

function createPrismaClient(url: string | undefined, authToken: string | undefined): PrismaClient {
  if (!url) {
    throw new Error("TURSO_DATABASE_URL is not set")
  }
  const adapter = new PrismaLibSql({ url, authToken })
  return new PrismaClient({ adapter })
}

const prismaUrl = process.env.TURSO_DATABASE_URL
const prismaAuthToken = process.env.TURSO_AUTH_TOKEN
const prismaConnectionFingerprint = createHash("sha256")
  .update(`${prismaUrl ?? ""}\0${prismaAuthToken ?? ""}`)
  .digest("hex")
const cachedPrisma = globalThis.__prismaConnectionFingerprint === prismaConnectionFingerprint
  ? globalThis.__prisma
  : undefined

export const prisma: PrismaClient = cachedPrisma ?? createPrismaClient(prismaUrl, prismaAuthToken)

if (process.env.NODE_ENV !== "production") {
  if (globalThis.__prisma && globalThis.__prisma !== prisma) {
    void globalThis.__prisma.$disconnect().catch(() => undefined)
  }
  globalThis.__prisma = prisma
  globalThis.__prismaConnectionFingerprint = prismaConnectionFingerprint
}
