import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { enforceBodyLimit } from "@/lib/api/server/body-limit"
import { respondInternalError } from "@/lib/api/server/error-response"
import { prisma } from "@/lib/prisma"
import { sendPasswordResetEmail } from "@/lib/auth/server/email"
import { randomDelay, timingSafeCompare } from "@/lib/auth/server/timing-safe"
import { newToken, PASSWORD_RESET_TTL_MS } from "@/lib/auth/server/tokens"
import { limitByIp, rateLimitEmailIdentifier, rateLimited } from "@/lib/rate-limit/server"

const forgotSchema = z.object({
  email: z.string().email().max(254),
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

  const parsed = forgotSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 })
  }

  const normalizedEmail = parsed.data.email.toLowerCase()
  try {
    const ipLimit = await limitByIp("forgotPasswordIp", request)
    if (ipLimit.limited) return ipLimit.response

    const emailLimit = await rateLimited(
      "forgotPasswordEmail",
      rateLimitEmailIdentifier(normalizedEmail),
    )
    if (emailLimit.limited) return emailLimit.response

    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } })

    if (user && user.emailVerified) {
      const token = newToken()
      const expires = new Date(Date.now() + PASSWORD_RESET_TTL_MS)
      await prisma.passwordResetToken.deleteMany({ where: { identifier: normalizedEmail } })
      await prisma.passwordResetToken.create({
        data: { identifier: normalizedEmail, token, expires },
      })
      await sendPasswordResetEmail({ to: normalizedEmail, token })
      await randomDelay()
    } else {
      await timingSafeCompare("dummy", null)
      await randomDelay()
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    return respondInternalError(error, "auth.forgot-password")
  }
}
