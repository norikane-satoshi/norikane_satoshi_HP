import { describe, expect, it } from "vitest"

import { findCandidateCalendar } from "../availability-finder"

const jobContext = { workSite: "remote-grading" } as Parameters<typeof findCandidateCalendar>[0]["jobContext"]
const workflowEstimate = { totalMaxDays: 1 } as Parameters<typeof findCandidateCalendar>[0]["workflowEstimate"]

const NOW = new Date("2026-11-25T00:00:00+09:00")

function search(overrides: Partial<Parameters<typeof findCandidateCalendar>[0]> = {}) {
  return findCandidateCalendar({
    jobContext,
    workflowEstimate,
    now: NOW,
    notBefore: "2026-12-01",
    busyFrom: "2026-12-01",
    lookaheadWeeks: 9,
    candidateLimit: 31,
    busyMode: "block",
    freeBusyFetcher: async () => [],
    tentativeDateKeysFetcher: async () => ["2026-12-01", "2026-12-02", "2026-12-03"],
    ...overrides,
  })
}

describe("findCandidateCalendar tentative handling", () => {
  it("reports the 仮キープ days so the chatbot panel can show them", async () => {
    const result = await search()

    expect(result.tentativeDateKeys).toEqual(["2026-12-01", "2026-12-02", "2026-12-03"])
  })

  it("still offers 仮キープ days as selectable candidates", async () => {
    // 仮キープは上書き可能なソフトロックなので、本予約と違って候補から外さない。
    const result = await search()

    const offered = result.candidates.filter((candidate) => candidate.start.startsWith("2026-12-01"))
    expect(offered).toHaveLength(1)
    expect(offered[0]?.available).toBe(true)
  })

  it("annotates a 仮キープ candidate in its note", async () => {
    const result = await search()
    const dec1 = result.candidates.find((candidate) => candidate.start.startsWith("2026-12-01"))

    expect(dec1?.note).toContain("tentative=true")
  })

  it("keeps tentative keys empty when nothing is held", async () => {
    const result = await search({ tentativeDateKeysFetcher: async () => [] })

    expect(result.tentativeDateKeys).toEqual([])
    expect(result.candidates.every((candidate) => !candidate.note?.includes("tentative=true"))).toBe(true)
  })

  it("drops tentative keys that fall outside the searched range", async () => {
    const result = await search({ tentativeDateKeysFetcher: async () => ["2026-11-30", "2026-12-02"] })

    expect(result.tentativeDateKeys).toEqual(["2026-12-02"])
  })
})
