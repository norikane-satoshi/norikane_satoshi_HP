import { NextResponse, type NextRequest } from "next/server"
import bcrypt from "bcryptjs"
import { z } from "zod"
import { prisma } from "@/lib/prisma"

const BCRYPT_COST = 12

const resetSchema = z.object({
  password: z.string().min(8).max(128),
})

type RouteContext = {
  params: Promise<{ token: string }>
}

export async function POST(request: NextRequest, ctx: RouteContext) {
  const { token } = await ctx.params

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 })
  }

  const parsed = resetSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "invalid payload" },
      { status: 400 }
    )
  }

  const record = await prisma.passwordResetToken.findUnique({ where: { token } })
  if (!record) {
    return NextResponse.json({ error: "invalid or expired token" }, { status: 400 })
  }
  if (record.expires.getTime() < Date.now()) {
    await prisma.passwordResetToken.delete({ where: { token } })
    return NextResponse.json({ error: "invalid or expired token" }, { status: 400 })
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, BCRYPT_COST)

  await prisma.$transaction([
    prisma.user.update({
      where: { email: record.identifier },
      data: { passwordHash, emailVerified: new Date() },
    }),
    prisma.passwordResetToken.delete({ where: { token } }),
    prisma.session.deleteMany({
      where: { user: { email: record.identifier } },
    }),
  ])

  return NextResponse.json({ ok: true })
}
