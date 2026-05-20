import { NextResponse, type NextRequest } from "next/server"
import { prisma } from "@/lib/prisma"
import { limitByIp } from "@/lib/rate-limit/server"

type RouteContext = {
  params: Promise<{ token: string }>
}

export async function GET(request: NextRequest, ctx: RouteContext) {
  const { token } = await ctx.params
  const ipLimit = await limitByIp("verifyEmailIp", request)
  if (ipLimit.limited) {
    const response = NextResponse.redirect(
      new URL("/login?verifyError=rate_limited", request.url),
      303,
    )
    ipLimit.headers.forEach((value, key) => response.headers.set(key, value))
    return response
  }

  const record = await prisma.verificationToken.findUnique({ where: { token } })
  if (!record) {
    return NextResponse.redirect(
      new URL("/login?verifyError=invalid_or_expired", request.url),
      303,
    )
  }
  if (record.expires.getTime() < Date.now()) {
    await prisma.verificationToken.delete({ where: { token } })
    return NextResponse.redirect(
      new URL("/login?verifyError=invalid_or_expired", request.url),
      303,
    )
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { email: record.identifier },
      data: { emailVerified: new Date() },
    }),
    prisma.verificationToken.delete({ where: { token } }),
  ])

  return NextResponse.redirect(new URL("/login?verified=1", request.url), 303)
}
