import { PrismaLibSql } from "@prisma/adapter-libsql"
import { PrismaClient, type User } from "@prisma/client"
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

export async function createBookingForUser(
  prisma: PrismaClient,
  user: User,
  input: { prefix: string; label: string; start: string; end: string },
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
      status: "CONFIRMED",
      projectTitle: `${input.prefix} ${input.label}`,
      contactName: user.name ?? input.label,
      contactEmail: user.email,
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
