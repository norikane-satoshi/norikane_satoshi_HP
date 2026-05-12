import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"

import { auth } from "@/auth"
import { listTeamsForUser, serializeTeam } from "@/lib/booking/team-access"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const createTeamSchema = z.object({
  name: z.string().trim().min(1).max(80),
})

function unauthorized() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 })
}

export async function GET() {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return unauthorized()

  const teams = await listTeamsForUser(userId)
  return NextResponse.json({ teams: teams.map(serializeTeam) })
}

export async function POST(request: NextRequest) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return unauthorized()

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  }

  const parsed = createTeamSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", issues: parsed.error.issues }, { status: 400 })
  }

  const team = await prisma.team.create({
    data: {
      name: parsed.data.name,
      createdByUserId: userId,
      members: {
        create: { userId },
      },
    },
    select: { id: true },
  })

  const teams = await listTeamsForUser(userId)
  return NextResponse.json({ teamId: team.id, teams: teams.map(serializeTeam) }, { status: 201 })
}
