import { PrismaLibSql } from "@prisma/adapter-libsql"
import { PrismaClient, type Prisma, type Team, type User } from "@prisma/client"
import type { APIRequestContext, BrowserContext } from "@playwright/test"
import { encode } from "next-auth/jwt"

export const testUserEmail = "norikane.satoshi@gmail.com"
export const cookieName = "authjs.session-token"

export function prismaForE2E() {
  const url = process.env.TURSO_DATABASE_URL
  if (!url) throw new Error("TURSO_DATABASE_URL is required for e2e")
  return new PrismaClient({
    adapter: new PrismaLibSql({ url, authToken: process.env.TURSO_AUTH_TOKEN }),
  })
}

export async function upsertUser(prisma: PrismaClient, email: string, name: string): Promise<User> {
  return prisma.user.upsert({
    where: { email },
    update: {
      name,
      emailVerified: new Date(),
    },
    create: {
      email,
      name,
      emailVerified: new Date(),
    },
  })
}

export async function sessionCookieFor(user: User) {
  const secret = process.env.AUTH_SECRET
  if (!secret) throw new Error("AUTH_SECRET is required for e2e")

  const value = await encode({
    token: {
      sub: user.id,
      email: user.email ?? undefined,
      name: user.name ?? undefined,
      picture: user.image ?? undefined,
    },
    secret,
    salt: cookieName,
    maxAge: 60 * 60,
  })

  return `${cookieName}=${value}`
}

export async function addSessionCookie(context: BrowserContext, user: User) {
  const cookie = await sessionCookieFor(user)
  const [, value] = cookie.split("=")
  const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:41241"

  await context.addCookies([
    {
      name: cookieName,
      value,
      url: baseURL,
      httpOnly: true,
      sameSite: "Lax",
      expires: Math.floor(Date.now() / 1000) + 60 * 60,
    },
  ])
}

export async function jsonRequest(
  request: APIRequestContext,
  method: "get" | "post" | "delete",
  path: string,
  cookie: string,
  body?: unknown,
) {
  const response = await request[method](path, {
    headers: {
      cookie,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    data: body,
    maxRedirects: 0,
  })
  const text = await response.text()
  return { response, json: text ? JSON.parse(text) : {} }
}

export function hasBooking(bookings: { bookingGroupId: string }[], bookingGroupId: string) {
  return bookings.some((booking) => booking.bookingGroupId === bookingGroupId)
}

export async function createTeamWithMembers(
  prisma: PrismaClient,
  input: { name: string; owner: User; members?: User[] },
): Promise<Team> {
  return prisma.team.create({
    data: {
      name: input.name,
      createdByUserId: input.owner.id,
      members: {
        create: [input.owner, ...(input.members ?? [])].map((user) => ({ userId: user.id })),
      },
    },
  })
}

export async function createBookingForUser(
  prisma: PrismaClient,
  user: User,
  input: { prefix: string; label: string; start: string; end: string; teamId?: string | null },
) {
  const customer = await prisma.customer.upsert({
    where: { userId: user.id },
    update: { displayName: user.name ?? input.label },
    create: {
      userId: user.id,
      displayName: user.name ?? input.label,
    },
  })

  return prisma.bookingGroup.create({
    data: {
      customerId: customer.id,
      teamId: input.teamId ?? null,
      status: "CONFIRMED",
      projectTitle: `${input.prefix} ${input.label}`,
      contactName: user.name ?? input.label,
      customerEmail: user.email,
      timeSlots: {
        create: {
          startTime: new Date(input.start),
          endTime: new Date(input.end),
          status: "CONFIRMED",
        },
      },
    },
    include: { timeSlots: true },
  })
}

export async function cleanupBookingE2E(
  prisma: PrismaClient,
  input: { prefix: string; emails: (string | null)[] },
) {
  await prisma.team.deleteMany({ where: { name: { startsWith: input.prefix } } })
  await prisma.bookingGroup.deleteMany({ where: { projectTitle: { startsWith: input.prefix } } })
  await prisma.user.deleteMany({
    where: {
      email: {
        in: input.emails.filter((email): email is string => Boolean(email)),
      },
    },
  })
}

export type BookingJson = {
  bookings: { bookingGroupId: string; title?: string }[]
}

export type TeamJson = {
  teams: { id: string; name: string; members: Prisma.JsonValue[] }[]
}
