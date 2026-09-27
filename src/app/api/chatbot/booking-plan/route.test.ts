import { NextRequest } from "next/server"
import { afterEach, describe, expect, it, vi } from "vitest"

function request(body: unknown) {
  return new NextRequest("http://localhost/api/chatbot/booking-plan", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  })
}

function validRequest(overrides: Record<string, unknown> = {}) {
  return {
    jobContext: {
      jobKind: "feature-90m",
      finalMedium: "cinema",
      workSite: "remote-grading",
      documentaryAttachment: { kind: "none" },
    },
    workflowEstimate: {
      stages: [
        { stage: "conform", minDays: 1, maxDays: 1 },
        { stage: "prep", minDays: 3, maxDays: 3 },
        { stage: "attended", minDays: 1, maxDays: 3 },
        { stage: "final-check", minDays: 1, maxDays: 1 },
      ],
      totalMinDays: 6,
      totalMaxDays: 8,
      riskFlags: [],
    },
    attendanceDates: ["2026-10-13", "2026-10-14"],
    ...overrides,
  }
}

async function loadPost() {
  vi.resetModules()
  const planChatbotWorkSchedule = vi.fn().mockResolvedValue({
    days: [{ date: "2026-10-13", role: "attendance" }],
    lines: ["立ち会い: 10/13(火)、10/14(水)"],
    dateLabels: {},
  })
  vi.doMock("@/lib/chatbot/server/work-schedule-plan", () => ({ planChatbotWorkSchedule }))
  const route = await import("./route")
  return { POST: route.POST, planChatbotWorkSchedule }
}

afterEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
})

describe("POST /api/chatbot/booking-plan", () => {
  it("returns the planned schedule lines for the chosen attendance dates", async () => {
    const { POST, planChatbotWorkSchedule } = await loadPost()

    const response = await POST(request(validRequest()))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      days: [{ date: "2026-10-13", role: "attendance" }],
      shortfall: null,
      lines: ["立ち会い: 10/13(火)、10/14(水)"],
    })
    expect(planChatbotWorkSchedule).toHaveBeenCalledWith(
      expect.objectContaining({ attendanceDates: ["2026-10-13", "2026-10-14"] }),
    )
  })

  it("rejects malformed bodies and dates without planning", async () => {
    const { POST, planChatbotWorkSchedule } = await loadPost()

    expect((await POST(request("{"))).status).toBe(400)
    expect((await POST(request(validRequest({ attendanceDates: [] })))).status).toBe(400)
    expect((await POST(request(validRequest({ attendanceDates: ["10/13"] })))).status).toBe(400)
    expect(planChatbotWorkSchedule).not.toHaveBeenCalled()
  })
})
