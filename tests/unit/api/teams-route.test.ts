import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  prisma: {
    team: {
      findMany: vi.fn(),
      create: vi.fn(),
      findFirst: vi.fn(),
      delete: vi.fn(),
    },
    teamMember: {
      deleteMany: vi.fn(),
    },
  },
}))

vi.mock("@/auth", () => ({ auth: mocks.auth }))
vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }))

import { GET, POST } from "@/app/api/teams/route"
import { DELETE as DELETE_TEAM } from "@/app/api/teams/[teamId]/route"
import { DELETE as LEAVE_TEAM } from "@/app/api/teams/[teamId]/membership/route"

describe("GET /api/teams", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns serialized teams from Prisma for the authenticated user", async () => {
    const createdAt = new Date("2026-06-10T01:00:00.000Z")
    mocks.auth.mockResolvedValue({ user: { id: "user_1" } })
    mocks.prisma.team.findMany.mockResolvedValue([
      {
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
      },
    ])

    const response = await GET()
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(mocks.prisma.team.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { members: { some: { userId: "user_1" } } },
      }),
    )
    expect(json).toEqual({
      teams: [
        {
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
        },
      ],
    })
  })

  it("returns 401 when unauthenticated", async () => {
    mocks.auth.mockResolvedValue(null)

    const response = await GET()

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" })
    expect(mocks.prisma.team.findMany).not.toHaveBeenCalled()
  })
})

describe("POST /api/teams", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("creates a team for the authenticated user", async () => {
    const createdAt = new Date("2026-06-10T01:00:00.000Z")
    mocks.auth.mockResolvedValue({ user: { id: "user_1" } })
    mocks.prisma.team.create.mockResolvedValue({ id: "team_1" })
    mocks.prisma.team.findMany.mockResolvedValue([
      {
        id: "team_1",
        name: "Studio",
        createdAt,
        members: [
          {
            userId: "user_1",
            createdAt,
            user: { name: "Satoshi", email: "satoshi@example.com", image: null },
          },
        ],
      },
    ])

    const response = await POST(new NextRequest("http://localhost/api/teams", {
      method: "POST",
      body: JSON.stringify({ name: "Studio" }),
    }))
    const json = await response.json()

    expect(response.status).toBe(201)
    expect(json.teamId).toBe("team_1")
    expect(json.teams).toHaveLength(1)
  })

  it("rejects invalid team names", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "user_1" } })

    const response = await POST(new NextRequest("http://localhost/api/teams", {
      method: "POST",
      body: JSON.stringify({ name: "" }),
    }))

    expect(response.status).toBe(400)
  })
})

describe("team deletion routes", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("deletes a team when the user is a member", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "user_1" } })
    mocks.prisma.team.findFirst.mockResolvedValue({ id: "team_1", name: "Studio" })
    mocks.prisma.team.delete.mockResolvedValue({})

    const response = await DELETE_TEAM(new Request("http://localhost/api/teams/team_1"), {
      params: Promise.resolve({ teamId: "team_1" }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ status: "deleted" })
    expect(mocks.prisma.team.delete).toHaveBeenCalledWith({ where: { id: "team_1" } })
  })

  it("returns 404 when deleting a team outside membership", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "user_1" } })
    mocks.prisma.team.findFirst.mockResolvedValue(null)

    const response = await DELETE_TEAM(new Request("http://localhost/api/teams/team_1"), {
      params: Promise.resolve({ teamId: "team_1" }),
    })

    expect(response.status).toBe(404)
  })

  it("leaves a team membership", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "user_1" } })
    mocks.prisma.teamMember.deleteMany.mockResolvedValue({ count: 1 })

    const response = await LEAVE_TEAM(new Request("http://localhost/api/teams/team_1/membership"), {
      params: Promise.resolve({ teamId: "team_1" }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ status: "left" })
  })

  it("returns 404 when no membership is removed", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "user_1" } })
    mocks.prisma.teamMember.deleteMany.mockResolvedValue({ count: 0 })

    const response = await LEAVE_TEAM(new Request("http://localhost/api/teams/team_1/membership"), {
      params: Promise.resolve({ teamId: "team_1" }),
    })

    expect(response.status).toBe(404)
  })
})
