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
    month: "2026-08",
    ...overrides,
  }
}

async function loadPost() {
  vi.resetModules()
  const findPreferredDateCalendar = vi.fn().mockResolvedValue({
    candidates: [
      {
        start: "2026-08-03T15:00:00.000Z",
        end: "2026-08-04T15:00:00.000Z",
        label: "2026-08-04 単日",
      },
    ],
    busyDateKeys: [],
  })

  vi.doMock("@/lib/chatbot/server/availability-finder", () => ({ findPreferredDateCalendar }))

  const route = await import("./route")
  return { POST: route.POST, findPreferredDateCalendar }
}

afterEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
})

describe("POST /api/chatbot/booking-candidates", () => {
  it("loads the requested display month without hard-filtering by the due month", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-01T12:00:00+09:00"))
    try {
      const route = await loadPost()

      const response = await route.POST(request(validRequest()))

      expect(response.status).toBe(200)
      const args = route.findPreferredDateCalendar.mock.calls[0]?.[0]
      expect(args).toMatchObject({
        notBefore: "2026-08-01",
        busyFrom: "2026-08-01",
        candidateLimit: 31,
      })
      expect(args.desiredDeadline).toBeUndefined()
      expect(args).not.toHaveProperty("workflowEstimate")
      expect(args).not.toHaveProperty("jobContext")
      await expect(response.json()).resolves.toMatchObject({
        candidates: [{ label: "2026-08-04 単日" }],
      })
    } finally {
      vi.useRealTimers()
    }
  })
})
