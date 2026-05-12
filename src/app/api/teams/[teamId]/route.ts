import { NextResponse } from "next/server"

import { auth } from "@/auth"
import { requireTeamMembership } from "@/lib/booking/team-access"
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
  const team = await requireTeamMembership(userId, teamId)
  if (!team) return NextResponse.json({ error: "not_found" }, { status: 404 })

  await prisma.team.delete({
    where: { id: teamId },
  })

  return NextResponse.json({ status: "deleted" })
}
