import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PrismaClient } from "@prisma/client"
import { PrismaLibSql } from "@prisma/adapter-libsql"

const state = vi.hoisted(() => ({ prisma: undefined as unknown as PrismaClient }))
vi.mock("@/lib/prisma", () => ({ get prisma() { return state.prisma } }))
import { verifyEmail } from "@/lib/auth/server/verify-email"

let fixtureDirectory: string
beforeAll(async () => {
  fixtureDirectory = await mkdtemp(join(tmpdir(), "hp-auth-verification-"))
  state.prisma = new PrismaClient({ adapter: new PrismaLibSql({ url: `file:${join(fixtureDirectory, "verification.db")}` }) })
  await state.prisma.$executeRawUnsafe(`CREATE TABLE User (
    id TEXT PRIMARY KEY, email TEXT UNIQUE, name TEXT, image TEXT,
    emailVerified DATETIME, passwordHash TEXT, tokenVersion INTEGER NOT NULL DEFAULT 0,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`)
})
beforeEach(async () => { await state.prisma.user.deleteMany() })
afterAll(async () => {
  await state.prisma.$disconnect()
  await rm(fixtureDirectory, { recursive: true, force: true })
})

describe("email verification database invariant", () => {
  it("atomically verifies an unverified account and discards its pending password", async () => {
    await state.prisma.user.create({ data: { id: "pending", email: "owner@example.com", passwordHash: "pending-fixture-hash" } })
    await verifyEmail({ id: "pending" })
    expect(await state.prisma.user.findUnique({ where: { id: "pending" } })).toMatchObject({ emailVerified: expect.any(Date), passwordHash: null })
  })

  it("preserves an already verified password and verification date", async () => {
    const emailVerified = new Date("2026-01-01T00:00:00Z")
    await state.prisma.user.create({ data: { id: "verified", emailVerified, passwordHash: "verified-fixture-hash" } })
    expect(await verifyEmail({ id: "verified" })).toEqual({ count: 0 })
    expect(await state.prisma.user.findUnique({ where: { id: "verified" } })).toMatchObject({ emailVerified, passwordHash: "verified-fixture-hash" })
  })

  it("prevents a pending signup write from restoring a password after verification", async () => {
    await state.prisma.user.create({ data: { id: "pending", email: "owner@example.com", passwordHash: "pending-fixture-hash" } })
    await verifyEmail({ email: "owner@example.com" })
    expect(await state.prisma.user.updateMany({ where: { id: "pending", emailVerified: null }, data: { passwordHash: "replacement-fixture-hash" } })).toEqual({ count: 0 })
    expect(await state.prisma.user.findUnique({ where: { id: "pending" } })).toMatchObject({ passwordHash: null })
  })

  it("does not verify a concurrently changed email address", async () => {
    await state.prisma.user.create({ data: { id: "pending", email: "changed@example.com", passwordHash: "pending-fixture-hash" } })
    expect(await verifyEmail({ id: "pending", email: "owner@example.com" })).toEqual({ count: 0 })
    expect(await state.prisma.user.findUnique({ where: { id: "pending" } })).toMatchObject({ emailVerified: null, passwordHash: "pending-fixture-hash" })
  })
})
