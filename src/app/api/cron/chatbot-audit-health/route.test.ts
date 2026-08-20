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

import { GET } from "./route"

function request(token = "secret") {
  return new NextRequest("https://norikane.studio/api/cron/chatbot-audit-health", {
    headers: { authorization: `Bearer ${token}` },
  })
}

function event(totalServer: number) {
  return {
    buildSha: "7eeaab886eb9e10a96743fc336a30f711beb553a",
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
      violations: ["totalServer"],
    })
  })
})
