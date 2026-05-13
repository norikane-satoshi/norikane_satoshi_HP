import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { sendPasswordResetEmail } from "@/lib/auth/email"
import { newToken, PASSWORD_RESET_TTL_MS } from "@/lib/auth/tokens"

const forgotSchema = z.object({
  email: z.string().email(),
})

export async function POST(request: NextRequest) {
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
  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } })

  if (user && user.emailVerified) {
    const token = newToken()
    const expires = new Date(Date.now() + PASSWORD_RESET_TTL_MS)
    await prisma.passwordResetToken.deleteMany({ where: { identifier: normalizedEmail } })
    await prisma.passwordResetToken.create({
      data: { identifier: normalizedEmail, token, expires },
    })
    await sendPasswordResetEmail({ to: normalizedEmail, token })
  }

  return NextResponse.json({ ok: true })
}
