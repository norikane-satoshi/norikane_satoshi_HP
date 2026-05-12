import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  requireTeamMembership: vi.fn(),
  prisma: {
    teamInvitation: {
      create: vi.fn(),
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
  },
  tx: {
    teamInvitation: {
      updateMany: vi.fn(),
    },
    teamMember: {
      upsert: vi.fn(),
    },
  },
}))

vi.mock("@/auth", () => ({ auth: mocks.auth }))
vi.mock("@/lib/booking/team-access", () => ({
  requireTeamMembership: mocks.requireTeamMembership,
}))
vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }))

import { POST } from "@/app/api/team-invitations/route"
import { GET } from "@/app/api/team-invitations/accept/route"

function postRequest(body: unknown) {
  return new NextRequest("http://localhost/api/team-invitations", {
    method: "POST",
    body: JSON.stringify(body),
  })
}

function acceptRequest(token: string) {
  return new NextRequest(`http://localhost/api/team-invitations/accept?token=${token}`)
}

describe("POST /api/team-invitations", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("creates a one-use invitation token for a team member", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "user_1" } })
    mocks.requireTeamMembership.mockResolvedValue({ id: "team_1", name: "Studio" })
    mocks.prisma.teamInvitation.create.mockResolvedValue({ token: "token_1" })

    const response = await POST(postRequest({ teamId: "team_1" }))
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(mocks.prisma.teamInvitation.create).toHaveBeenCalledWith({
      data: {
        teamId: "team_1",
        createdByUserId: "user_1",
        token: expect.any(String),
      },
      select: { token: true },
    })
    expect(json).toEqual({
      token: "token_1",
      url: "http://localhost/api/team-invitations/accept?token=token_1",
    })
  })

  it("returns 401 when invitation creation is unauthenticated", async () => {
    mocks.auth.mockResolvedValue(null)

    const response = await POST(postRequest({ teamId: "team_1" }))

    expect(response.status).toBe(401)
  })

  it("returns 404 when the creator is not a team member", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "user_1" } })
    mocks.requireTeamMembership.mockResolvedValue(null)

    const response = await POST(postRequest({ teamId: "team_1" }))

    expect(response.status).toBe(404)
  })
})

describe("GET /api/team-invitations/accept", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.prisma.$transaction.mockImplementation((callback: (tx: typeof mocks.tx) => Promise<unknown>) => callback(mocks.tx))
  })

  it("accepts an unused token and redirects back to settings", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "user_2" } })
    mocks.prisma.teamInvitation.findUnique.mockResolvedValue({
      id: "invite_1",
      teamId: "team_1",
      usedAt: null,
    })
    mocks.tx.teamInvitation.updateMany.mockResolvedValue({ count: 1 })
    mocks.tx.teamMember.upsert.mockResolvedValue({})

    const response = await GET(acceptRequest("token_1"))

    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toBe("http://localhost/booking/settings?invite=accepted")
    expect(mocks.tx.teamMember.upsert).toHaveBeenCalledWith({
      where: { userId_teamId: { userId: "user_2", teamId: "team_1" } },
      update: {},
      create: { userId: "user_2", teamId: "team_1" },
    })
  })

  it("redirects unauthenticated users to login with callback", async () => {
    mocks.auth.mockResolvedValue(null)

    const response = await GET(acceptRequest("token_1"))

    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toBe(
      "http://localhost/login?callbackUrl=%2Fapi%2Fteam-invitations%2Faccept%3Ftoken%3Dtoken_1",
    )
  })

  it("redirects missing tokens as invalid", async () => {
    const response = await GET(new NextRequest("http://localhost/api/team-invitations/accept"))

    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toBe("http://localhost/booking/settings?invite=invalid")
  })

  it("redirects used tokens as used", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "user_2" } })
    mocks.prisma.teamInvitation.findUnique.mockResolvedValue({
      id: "invite_1",
      teamId: "team_1",
      usedAt: new Date("2026-06-10T01:00:00.000Z"),
    })

    const response = await GET(acceptRequest("token_1"))

    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toBe("http://localhost/booking/settings?invite=used")
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  })

  it("redirects invalid tokens as invalid", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "user_2" } })
    mocks.prisma.teamInvitation.findUnique.mockResolvedValue(null)

    const response = await GET(acceptRequest("bad_token"))

    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toBe("http://localhost/booking/settings?invite=invalid")
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  })
})
