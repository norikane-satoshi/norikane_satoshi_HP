import { NextRequest } from "next/server"
import { afterEach, describe, expect, it, vi } from "vitest"

function request(body: unknown) {
  return new NextRequest("http://localhost/api/chatbot/booking-candidates", {
    method: "POST",
    body: JSON.stringify(body),
  })
}

function validRequest(overrides: Record<string, unknown> = {}) {
  return {
    jobContext: {
      jobKind: "live-60m",
      finalMedium: "live",
      workSite: "remote-grading",
      documentaryAttachment: { kind: "none" },
      publicReleaseDate: "2026-07-31",
      preferredStartDate: "2026-07-01",
    },
    workflowEstimate: {
      stages: [{ stage: "attended", minDays: 2, maxDays: 2 }],
      totalMinDays: 2,
      totalMaxDays: 2,
      riskFlags: [],
    },
    month: "2026-08",
    ...overrides,
  }
}

async function loadPost() {
  vi.resetModules()
  const findCandidateCalendar = vi.fn().mockResolvedValue({
    candidates: [
      {
        start: "2026-08-03T15:00:00.000Z",
        end: "2026-08-04T15:00:00.000Z",
        label: "2026-08-04 単日",
      },
    ],
    busyDateKeys: [],
  })

  vi.doMock("@/lib/chatbot/server/availability-finder", () => ({ findCandidateCalendar }))

  const route = await import("./route")
  return { POST: route.POST, findCandidateCalendar }
}

afterEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
})

describe("POST /api/chatbot/booking-candidates", () => {
  it("loads the requested display month without hard-filtering by the due month", async () => {
    const route = await loadPost()

    const response = await route.POST(request(validRequest()))

    expect(response.status).toBe(200)
    const args = route.findCandidateCalendar.mock.calls[0]?.[0]
    expect(args).toMatchObject({
      notBefore: "2026-08-01",
      busyFrom: "2026-08-01",
      candidateLimit: 31,
    })
    expect(args).not.toHaveProperty("desiredDeadline")
    await expect(response.json()).resolves.toMatchObject({
      candidates: [{ label: "2026-08-04 単日" }],
    })
  })
})
