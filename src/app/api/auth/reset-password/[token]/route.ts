import { NextResponse, type NextRequest } from "next/server"
import bcrypt from "bcryptjs"
import { z } from "zod"
import { enforceBodyLimit } from "@/lib/api/server/body-limit"
import { respondInternalError } from "@/lib/api/server/error-response"
import { prisma } from "@/lib/prisma"
import { invalidateTokenVersion } from "@/lib/auth/server/token-version-cache"

const BCRYPT_COST = 12

const resetSchema = z.object({
  password: z.string().min(8).max(128),
})

type RouteContext = {
  params: Promise<{ token: string }>
}

export async function POST(request: NextRequest, ctx: RouteContext) {
  const bodyLimit = enforceBodyLimit(request)
  if (bodyLimit) return bodyLimit

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

  try {
    const record = await prisma.passwordResetToken.findUnique({ where: { token } })
    if (!record) {
      return NextResponse.json({ error: "invalid or expired token" }, { status: 400 })
    }
    if (record.expires.getTime() < Date.now()) {
      await prisma.passwordResetToken.delete({ where: { token } })
      return NextResponse.json({ error: "invalid or expired token" }, { status: 400 })
    }

    const passwordHash = await bcrypt.hash(parsed.data.password, BCRYPT_COST)

    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { email: record.identifier },
        data: {
          passwordHash,
          emailVerified: new Date(),
          tokenVersion: { increment: 1 },
        },
        select: { id: true },
      })
      await tx.passwordResetToken.delete({ where: { token } })
      await tx.session.deleteMany({
        where: { user: { email: record.identifier } },
      })
      return updated
    })
    invalidateTokenVersion(result.id)

    return NextResponse.json({ ok: true })
  } catch (error) {
    return respondInternalError(error, "auth.reset-password")
  }
}
