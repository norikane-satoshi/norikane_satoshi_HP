// Step 0 PR 適用後・Phase 1 系 PR 実装前に Turso 本番と Preview で 1 回だけ実行する。

import { createHash } from "node:crypto"
import { PrismaClient } from "@prisma/client"
import { PrismaLibSql } from "@prisma/adapter-libsql"
import { config as loadDotenv } from "dotenv"

loadDotenv({ path: ".env.local", override: false, quiet: true })
loadDotenv({ path: ".env", override: false, quiet: true })

const DRY_RUN = process.argv.includes("--dry-run")
const INVITATION_TTL_MS = 72 * 3600 * 1000

function createPrismaClient(): PrismaClient {
  const url = process.env.TURSO_DATABASE_URL
  const authToken = process.env.TURSO_AUTH_TOKEN
  if (!url) {
    throw new Error("TURSO_DATABASE_URL is not set")
  }
  return new PrismaClient({
    adapter: new PrismaLibSql({ url, authToken }),
  })
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

function defaultInvitationExpiry(createdAt: Date, now: Date): Date {
  return new Date(Math.max(createdAt.getTime() + INVITATION_TTL_MS, now.getTime() + INVITATION_TTL_MS))
}

async function main(): Promise<void> {
  if (!process.env.TURSO_DATABASE_URL && DRY_RUN) {
    console.log("abort: TURSO_DATABASE_URL is not set")
    return
  }

  const prisma = createPrismaClient()
  try {
    const ownerMemberships = await prisma.teamMember.findMany({
      where: {
        role: { not: "OWNER" },
      },
      select: {
        id: true,
        userId: true,
        team: {
          select: {
            createdByUserId: true,
          },
        },
      },
    })

    const ownerMembershipIds = ownerMemberships
      .filter((membership) => membership.userId === membership.team.createdByUserId)
      .map((membership) => membership.id)

    const invitations = await prisma.teamInvitation.findMany({
      where: {
        tokenHash: null,
      },
      select: {
        id: true,
        token: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: "asc",
      },
    })

    console.log(`TeamMember to upgrade: ${ownerMembershipIds.length}`)
    console.log(`TeamInvitation to backfill: ${invitations.length}`)

    if (DRY_RUN) return

    if (ownerMembershipIds.length > 0) {
      await prisma.teamMember.updateMany({
        where: {
          id: { in: ownerMembershipIds },
        },
        data: {
          role: "OWNER",
        },
      })
    }

    const now = new Date()
    for (const invitation of invitations) {
      await prisma.teamInvitation.updateMany({
        where: {
          id: invitation.id,
          tokenHash: null,
        },
        data: {
          tokenHash: hashToken(invitation.token),
          expiresAt: defaultInvitationExpiry(invitation.createdAt, now),
        },
      })
    }
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
