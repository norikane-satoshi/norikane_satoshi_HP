import { prisma } from "@/lib/prisma"

export type TeamForSettings = Awaited<ReturnType<typeof listTeamsForUser>>[number]

export async function listTeamsForUser(userId: string) {
  return prisma.team.findMany({
    where: {
      members: {
        some: { userId },
      },
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      createdAt: true,
      members: {
        orderBy: { createdAt: "asc" },
        select: {
          userId: true,
          createdAt: true,
          user: {
            select: {
              name: true,
              email: true,
              image: true,
            },
          },
        },
      },
    },
  })
}

export async function isTeamMember(userId: string, teamId: string): Promise<boolean> {
  const member = await prisma.teamMember.findUnique({
    where: {
      userId_teamId: { userId, teamId },
    },
    select: { id: true },
  })
  return member !== null
}

export async function requireTeamMembership(userId: string, teamId: string) {
  const team = await prisma.team.findFirst({
    where: {
      id: teamId,
      members: {
        some: { userId },
      },
    },
    select: { id: true, name: true },
  })

  return team
}

export async function listTeamMemberUserIds(userId: string, teamId: string): Promise<string[] | null> {
  const team = await prisma.team.findFirst({
    where: {
      id: teamId,
      members: {
        some: { userId },
      },
    },
    select: {
      members: {
        select: { userId: true },
      },
    },
  })

  if (!team) return null
  return team.members.map((member) => member.userId)
}

export function serializeTeam(team: TeamForSettings) {
  return {
    id: team.id,
    name: team.name,
    createdAt: team.createdAt.toISOString(),
    members: team.members.map((member) => ({
      userId: member.userId,
      name: member.user.name,
      email: member.user.email,
      image: member.user.image,
      joinedAt: member.createdAt.toISOString(),
    })),
  }
}
