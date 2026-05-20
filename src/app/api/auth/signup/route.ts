import { NextResponse, type NextRequest } from "next/server"
import bcrypt from "bcryptjs"
import { z } from "zod"
import { enforceBodyLimit } from "@/lib/api/server/body-limit"
import { respondInternalError } from "@/lib/api/server/error-response"
import { prisma } from "@/lib/prisma"
import { sendVerificationEmail } from "@/lib/auth/server/email"
import { timingSafeCompare } from "@/lib/auth/server/timing-safe"
import { newToken, VERIFICATION_TOKEN_TTL_MS } from "@/lib/auth/server/tokens"
import { limitByIp, rateLimitEmailIdentifier, rateLimited } from "@/lib/rate-limit/server"

const BCRYPT_COST = 12

const signupSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(80).optional(),
})

export async function POST(request: NextRequest) {
  const bodyLimit = enforceBodyLimit(request)
  if (bodyLimit) return bodyLimit

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 })
  }

  const parsed = signupSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "invalid payload" },
      { status: 400 }
    )
  }

  const { email, password, name } = parsed.data
  const normalizedEmail = email.toLowerCase()
  try {
    const ipLimit = await limitByIp("signupIp", request)
    if (ipLimit.limited) return ipLimit.response

    const emailLimit = await rateLimited("signupEmail", rateLimitEmailIdentifier(normalizedEmail))
    if (emailLimit.limited) return emailLimit.response

    const passwordHash = await bcrypt.hash(password, BCRYPT_COST)

    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } })

    let user = existing
    if (!user) {
      user = await prisma.user.create({
        data: { email: normalizedEmail, passwordHash, name: name ?? null },
      })
    } else if (!user.emailVerified) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash, name: name ?? user.name },
      })
    } else {
      await timingSafeCompare(password, user.passwordHash)
      return NextResponse.json({ ok: true })
    }

    const token = newToken()
    const expires = new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS)
    await prisma.verificationToken.deleteMany({ where: { identifier: normalizedEmail } })
    await prisma.verificationToken.create({
      data: { identifier: normalizedEmail, token, expires },
    })

    await sendVerificationEmail({ to: normalizedEmail, token })

    return NextResponse.json({ ok: true })
  } catch (error) {
    return respondInternalError(error, "auth.signup")
  }
}
