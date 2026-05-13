import { NextResponse } from "next/server"

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function unauthorized() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 })
}

export async function DELETE(_request: Request, context: { params: Promise<{ teamId: string }> }) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return unauthorized()

  const { teamId } = await context.params
  const result = await prisma.teamMember.deleteMany({
    where: { teamId, userId },
  })

  if (result.count === 0) return NextResponse.json({ error: "not_found" }, { status: 404 })
  return NextResponse.json({ status: "left" })
}
