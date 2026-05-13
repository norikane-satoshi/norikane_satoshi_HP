import { NextResponse, type NextRequest } from "next/server"
import bcrypt from "bcryptjs"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { sendVerificationEmail } from "@/lib/auth/email"
import { newToken, VERIFICATION_TOKEN_TTL_MS } from "@/lib/auth/tokens"

const BCRYPT_COST = 12

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(80).optional(),
})

export async function POST(request: NextRequest) {
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
}
