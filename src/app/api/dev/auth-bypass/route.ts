import { NextResponse } from "next/server"
import { encode } from "next-auth/jwt"

const COOKIE_NAME = "authjs.session-token"
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30
const TEST_USER_EMAIL = "norikane.satoshi@gmail.com"

export const dynamic = "force-dynamic"

export async function GET() {
  if (process.env.NODE_ENV === "production") return new Response("Not Found", { status: 404 })

  const secret = process.env.AUTH_SECRET
  if (!secret) return new Response("AUTH_SECRET is not set", { status: 500 })

  const { prisma } = await import("@/lib/prisma")
  const user = await prisma.user.findUnique({
    where: { email: TEST_USER_EMAIL },
    select: {
      id: true,
      email: true,
      name: true,
      image: true,
    },
  })

  if (!user) return new Response("Test user not found", { status: 404 })

  const sessionToken = await encode({
    token: {
      sub: user.id,
      email: user.email ?? undefined,
      name: user.name ?? undefined,
      picture: user.image ?? undefined,
    },
    secret,
    salt: COOKIE_NAME,
    maxAge: SESSION_MAX_AGE_SECONDS,
  })

  const response = NextResponse.json({ ok: true, userId: user.id })
  response.cookies.set(COOKIE_NAME, sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  })

  return response
}
