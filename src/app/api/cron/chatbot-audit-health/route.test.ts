import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    chatbotAuditEvent: {
      findMany: mocks.findMany,
    },
  },
}))

vi.mock("@/lib/chatbot/server/build-info", () => ({
  getChatbotBuildSha: () => "current-build",
}))

import { GET } from "./route"

function request(token = "secret") {
  return new NextRequest("https://norikane.studio/api/cron/chatbot-audit-health", {
    headers: { authorization: `Bearer ${token}` },
  })
}

function event(
  totalServer: number,
  buildSha = "current-build",
  tier = "tier-1-hosted-chrome-notion-ai",
) {
  return {
    buildSha,
    tier,
    payloadJson: JSON.stringify({ stageTimings: { totalServer } }),
  }
}

describe("GET /api/cron/chatbot-audit-health", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    vi.stubEnv("CRON_SECRET", "secret")
  })

  it("rejects requests without the cron bearer token", async () => {
    const response = await GET(request("wrong"))

    expect(response.status).toBe(401)
    expect(mocks.findMany).not.toHaveBeenCalled()
  })

  it("reports insufficient data instead of a false pass", async () => {
    mocks.findMany.mockResolvedValue(Array.from({ length: 4 }, () => event(30_000)))

    const response = await GET(request())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      status: "insufficient-data",
      sampleCount: 4,
      violations: ["sample-count"],
    })
  })

  it("returns a failing status when the observed p95 exceeds budget", async () => {
    mocks.findMany.mockResolvedValue(Array.from({ length: 5 }, () => event(50_000)))

    const response = await GET(request())

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      status: "regressed",
      sampleCount: 5,
      violations: ["tier-1-hosted-chrome-notion-ai:totalServer"],
    })
  })

  it("does not mix old build samples into the current build performance verdict", async () => {
    mocks.findMany.mockResolvedValue([
      ...Array.from({ length: 4 }, () => event(30_000)),
      event(80_000, "old-build"),
    ])

    const response = await GET(request())

    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ buildSha: "current-build" }),
    }))
    await expect(response.json()).resolves.toMatchObject({
      status: "insufficient-data",
      sampleCount: 4,
      currentBuildSha: "current-build",
      observedBuildShas: ["current-build"],
    })
  })

  it("evaluates Tier 2 fallback samples against the Tier 2 baseline", async () => {
    mocks.findMany.mockResolvedValue(Array.from(
      { length: 5 },
      () => event(8_000, "current-build", "tier-2-gemini-flash"),
    ))

    const response = await GET(request())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      status: "within-budget",
      sampleCount: 5,
      scenarios: {
        "tier-1-hosted-chrome-notion-ai": {
          status: "insufficient-data",
          sampleCount: 0,
        },
        "tier-2-gemini-flash": {
          status: "within-budget",
          sampleCount: 5,
          observedP95Ms: { totalServer: 8_000 },
        },
      },
    })
  })
})
