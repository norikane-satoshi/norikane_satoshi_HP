import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  prisma: {
    team: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    teamMember: {
      findUnique: vi.fn(),
    },
  },
}))

vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }))

import {
  isTeamMember,
  listTeamMemberUserIds,
  listTeamsForUser,
  requireTeamMembership,
  serializeTeam,
} from "@/lib/booking/team-access"

describe("isTeamMember", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns true for members", async () => {
    mocks.prisma.teamMember.findUnique.mockResolvedValue({ id: "membership_1" })

    await expect(isTeamMember("user_1", "team_1")).resolves.toBe(true)
  })

  it("returns false for non-members", async () => {
    mocks.prisma.teamMember.findUnique.mockResolvedValue(null)

    await expect(isTeamMember("user_1", "team_2")).resolves.toBe(false)
  })

  it("treats null teamId lookups as non-members at the boundary", async () => {
    mocks.prisma.teamMember.findUnique.mockResolvedValue(null)

    await expect(isTeamMember("user_1", null as unknown as string)).resolves.toBe(false)
    expect(mocks.prisma.teamMember.findUnique).toHaveBeenCalledWith({
      where: { userId_teamId: { userId: "user_1", teamId: null } },
      select: { id: true },
    })
  })
})

describe("team access listing helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("lists teams for a user and serializes member metadata", async () => {
    const createdAt = new Date("2026-06-10T01:00:00.000Z")
    const team = {
      id: "team_1",
      name: "Studio",
      createdAt,
      members: [
        {
          userId: "user_1",
          createdAt,
          user: {
            name: "Satoshi",
            email: "satoshi@example.com",
            image: null,
          },
        },
      ],
    }
    mocks.prisma.team.findMany.mockResolvedValue([team])

    await expect(listTeamsForUser("user_1")).resolves.toEqual([team])
    expect(serializeTeam(team)).toEqual({
      id: "team_1",
      name: "Studio",
      createdAt: createdAt.toISOString(),
      members: [
        {
          userId: "user_1",
          name: "Satoshi",
          email: "satoshi@example.com",
          image: null,
          joinedAt: createdAt.toISOString(),
        },
      ],
    })
  })

  it("requires membership and returns member user ids", async () => {
    mocks.prisma.team.findFirst
      .mockResolvedValueOnce({ id: "team_1", name: "Studio" })
      .mockResolvedValueOnce({ members: [{ userId: "user_1" }, { userId: "user_2" }] })
      .mockResolvedValueOnce(null)

    await expect(requireTeamMembership("user_1", "team_1")).resolves.toEqual({ id: "team_1", name: "Studio" })
    await expect(listTeamMemberUserIds("user_1", "team_1")).resolves.toEqual(["user_1", "user_2"])
    await expect(listTeamMemberUserIds("user_1", "team_missing")).resolves.toBeNull()
  })
})
