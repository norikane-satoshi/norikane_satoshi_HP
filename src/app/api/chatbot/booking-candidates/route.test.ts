import { NextRequest } from "next/server"
import { afterEach, describe, expect, it, vi } from "vitest"

function request(body: unknown) {
  return new NextRequest("http://localhost/api/chatbot/booking-candidates", {
    method: "POST",
    body: JSON.stringify(body),
  })
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    month: "2026-07",
    jobContext: {
      jobKind: "cm-30s",
      finalMedium: "web",
      workSite: "remote-grading",
      documentaryAttachment: { kind: "none" },
      publicReleaseDate: "2026-08-01",
    },
    workflowEstimate: {
      stages: [{ stage: "attended", minDays: 2, maxDays: 2 }],
      totalMinDays: 2,
      totalMaxDays: 2,
      riskFlags: [],
    },
    ...overrides,
  }
}

async function loadPost() {
  vi.resetModules()

  const findCandidateCalendar = vi.fn().mockResolvedValue({
    candidates: [
      {
        start: "2026-07-01T00:00:00.000Z",
        end: "2026-07-03T00:00:00.000Z",
        label: "2026-07-01 単日",
        available: true,
        note: "requiredDays=2; busyRatio=0.00",
      },
    ],
    busyDateKeys: ["2026-07-03"],
  })

  vi.doMock("@/lib/chatbot/server/availability-finder", () => ({ findCandidateCalendar }))

  const route = await import("./route")
  return {
    POST: route.POST,
    findCandidateCalendar,
  }
}

afterEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
})

describe("POST /api/chatbot/booking-candidates", () => {
  it("returns candidate windows for the requested month through the Notion-backed finder", async () => {
    const route = await loadPost()

    const response = await route.POST(request(validBody()))

    expect(response.status).toBe(200)
    expect(route.findCandidateCalendar).toHaveBeenCalledWith({
      jobContext: expect.objectContaining({ workSite: "remote-grading" }),
      workflowEstimate: expect.objectContaining({ totalMinDays: 2 }),
      desiredDeadline: "2026-08-01",
      notBefore: "2026-07-01",
      busyFrom: "2026-07-01",
      now: new Date("2026-07-01T00:00:00.000+09:00"),
      lookaheadWeeks: 9,
      candidateLimit: 31,
      busyMode: "block",
    })
    await expect(response.json()).resolves.toEqual({
      candidates: [
        {
          start: "2026-07-01T00:00:00.000Z",
          end: "2026-07-03T00:00:00.000Z",
          label: "2026-07-01 単日",
          available: true,
          note: "requiredDays=2; busyRatio=0.00",
        },
      ],
      busyDateKeys: ["2026-07-03"],
    })
  })

  it("keeps the material handoff lower bound when loading a month", async () => {
    const route = await loadPost()

    const response = await route.POST(request(validBody({
      jobContext: {
        jobKind: "cm-30s",
        finalMedium: "web",
        workSite: "remote-grading",
        documentaryAttachment: { kind: "none" },
        publicReleaseDate: "2026-08-01",
        preferredStartDate: "2026-07-12",
      },
    })))

    expect(response.status).toBe(200)
    expect(route.findCandidateCalendar).toHaveBeenCalledWith(
      expect.objectContaining({
        notBefore: "2026-07-12",
        busyFrom: "2026-07-01",
      }),
    )
  })

  it("rejects invalid month requests before reading availability", async () => {
    const route = await loadPost()

    const response = await route.POST(request(validBody({ month: "2026-7" })))

    expect(response.status).toBe(400)
    expect(route.findCandidateCalendar).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toMatchObject({ error: "invalid_request" })
  })
})
