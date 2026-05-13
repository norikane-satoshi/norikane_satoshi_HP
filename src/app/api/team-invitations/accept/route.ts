import { NextResponse, type NextRequest } from "next/server"

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function settingsRedirect(request: NextRequest, invite: string) {
  const url = new URL("/booking/settings", request.nextUrl.origin)
  url.searchParams.set("invite", invite)
  return NextResponse.redirect(url)
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token")
  if (!token) return settingsRedirect(request, "invalid")

  const session = await auth()
  const userId = session?.user?.id
  if (!userId) {
    const loginUrl = new URL("/login", request.nextUrl.origin)
    loginUrl.searchParams.set("callbackUrl", `/api/team-invitations/accept?token=${encodeURIComponent(token)}`)
    return NextResponse.redirect(loginUrl)
  }

  const invitation = await prisma.teamInvitation.findUnique({
    where: { token },
    select: { id: true, teamId: true, usedAt: true },
  })

  if (!invitation) return settingsRedirect(request, "invalid")
  if (invitation.usedAt) return settingsRedirect(request, "used")

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.teamInvitation.updateMany({
      where: { id: invitation.id, usedAt: null },
      data: { usedAt: new Date(), usedByUserId: userId },
    })
    if (updated.count === 0) return "used" as const

    await tx.teamMember.upsert({
      where: {
        userId_teamId: { userId, teamId: invitation.teamId },
      },
      update: {},
      create: {
        userId,
        teamId: invitation.teamId,
      },
    })

    return "accepted" as const
  })

  return settingsRedirect(request, result)
}
