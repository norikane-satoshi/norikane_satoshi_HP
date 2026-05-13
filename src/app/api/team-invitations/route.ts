import { randomBytes } from "node:crypto"
import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"

import { auth } from "@/auth"
import { requireTeamMembership } from "@/lib/booking/team-access"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const createInvitationSchema = z.object({
  teamId: z.string().min(1),
})

function unauthorized() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 })
}

function createToken(): string {
  return randomBytes(32).toString("base64url")
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

  const parsed = createInvitationSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", issues: parsed.error.issues }, { status: 400 })
  }

  const team = await requireTeamMembership(userId, parsed.data.teamId)
  if (!team) return NextResponse.json({ error: "not_found" }, { status: 404 })

  const invitation = await prisma.teamInvitation.create({
    data: {
      teamId: team.id,
      createdByUserId: userId,
      token: createToken(),
    },
    select: { token: true },
  })

  const url = new URL("/api/team-invitations/accept", request.nextUrl.origin)
  url.searchParams.set("token", invitation.token)

  return NextResponse.json({ url: url.toString(), token: invitation.token })
}
