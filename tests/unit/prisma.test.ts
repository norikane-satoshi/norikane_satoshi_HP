import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const prismaMocks = vi.hoisted(() => ({
  adapters: [] as Array<{ url?: string; authToken?: string }>,
  disconnect: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@prisma/adapter-libsql", () => ({
  PrismaLibSql: class PrismaLibSql {
    constructor(options: { url?: string; authToken?: string }) {
      prismaMocks.adapters.push(options)
    }
  },
}))

vi.mock("@prisma/client", () => ({
  PrismaClient: class PrismaClient {
    $disconnect = prismaMocks.disconnect
  },
}))

type PrismaGlobal = typeof globalThis & {
  __prisma?: unknown
  __prismaConnectionFingerprint?: string
}

const prismaGlobal = globalThis as PrismaGlobal

describe("Prisma client HMR cache", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv("TURSO_DATABASE_URL", "libsql://database.example")
    vi.stubEnv("TURSO_AUTH_TOKEN", "token-one")
    delete prismaGlobal.__prisma
    delete prismaGlobal.__prismaConnectionFingerprint
    prismaMocks.adapters.length = 0
    prismaMocks.disconnect.mockClear()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    delete prismaGlobal.__prisma
    delete prismaGlobal.__prismaConnectionFingerprint
  })

  it("reuses the client when the database credentials are unchanged", async () => {
    const first = await import("@/lib/prisma")
    vi.resetModules()
    const second = await import("@/lib/prisma")

    expect(second.prisma).toBe(first.prisma)
    expect(prismaMocks.adapters).toHaveLength(1)
    expect(prismaMocks.disconnect).not.toHaveBeenCalled()
  })

  it("replaces the client when only the auth token changes", async () => {
    const first = await import("@/lib/prisma")
    vi.resetModules()
    vi.stubEnv("TURSO_AUTH_TOKEN", "token-two")
    const second = await import("@/lib/prisma")

    expect(second.prisma).not.toBe(first.prisma)
    expect(prismaMocks.adapters).toEqual([
      { url: "libsql://database.example", authToken: "token-one" },
      { url: "libsql://database.example", authToken: "token-two" },
    ])
    expect(prismaMocks.disconnect).toHaveBeenCalledOnce()
  })
})
