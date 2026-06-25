import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getNotionWorkScheduleBusyIntervals: vi.fn(),
}))

vi.mock("@/lib/chatbot/server/notion-work-schedule-busy", () => ({
  getNotionWorkScheduleBusyIntervals: mocks.getNotionWorkScheduleBusyIntervals,
}))

import type { JobContext, WorkflowEstimate } from "@/lib/chatbot/domain"
import {
  ChatbotAvailabilityError,
  findCandidateCalendar,
  findCandidateWindows,
  type AttendanceConflictResolver,
  type FreeBusyFetcher,
} from "@/lib/chatbot/server/availability-finder"

function jobContext(overrides: Partial<JobContext> = {}): JobContext {
  return {
    jobKind: "cm-30s",
    finalMedium: "web",
    workSite: "remote-grading",
    documentaryAttachment: { kind: "none" },
    ...overrides,
  }
}

function workflowEstimate(totalMinDays: number): WorkflowEstimate {
  return {
    stages: [{ stage: "attended", minDays: totalMinDays, maxDays: totalMinDays }],
    totalMinDays,
    totalMaxDays: totalMinDays,
    riskFlags: [],
  }
}

function freeBusy(slots: Array<{ start: string; end: string }> = []): FreeBusyFetcher {
  return vi.fn(async () => slots)
}

function attendance(
  slots: Array<{ start: string; end: string; bookingId: string }> = [],
): AttendanceConflictResolver {
  return vi.fn(async () => slots)
}

const NOW_BEFORE_STUDIO = new Date("2026-05-25T10:00:00+09:00")
const NOW_AFTER_STUDIO = new Date("2026-10-01T10:00:00+09:00")

describe("findCandidateWindows", () => {
  beforeEach(() => {
    mocks.getNotionWorkScheduleBusyIntervals.mockReset()
  })

  it("rejects satoshi-studio before 2026-09-15 JST", async () => {
    await expect(
      findCandidateWindows({
        jobContext: jobContext({ workSite: "satoshi-studio" }),
        workflowEstimate: workflowEstimate(1),
        now: NOW_BEFORE_STUDIO,
        freeBusyFetcher: freeBusy(),
        attendanceConflictResolver: attendance(),
      }),
    ).rejects.toMatchObject({ kind: "studio-not-yet-active" })
  })

  it("allows satoshi-studio from 2026-09-15 JST", async () => {
    const windows = await findCandidateWindows({
      jobContext: jobContext({ workSite: "satoshi-studio" }),
      workflowEstimate: workflowEstimate(1),
      now: new Date("2026-09-15T10:00:00+09:00"),
      freeBusyFetcher: freeBusy(),
      attendanceConflictResolver: attendance(),
    })

    expect(windows[0]?.label).toBe("2026-09-15 単日")
  })

  it("rejects an unspecified work site without assigning a default", async () => {
    await expect(
      findCandidateWindows({
        jobContext: jobContext({ workSite: undefined as unknown as JobContext["workSite"] }),
        workflowEstimate: workflowEstimate(1),
        now: NOW_AFTER_STUDIO,
        freeBusyFetcher: freeBusy(),
        attendanceConflictResolver: attendance(),
      }),
    ).rejects.toMatchObject({ kind: "work-site-unspecified" })
  })

  it("filters out windows that overlap attended booking intervals", async () => {
    const windows = await findCandidateWindows({
      jobContext: jobContext(),
      workflowEstimate: workflowEstimate(1),
      now: new Date("2026-10-05T10:00:00+09:00"),
      freeBusyFetcher: freeBusy(),
      attendanceConflictResolver: attendance([
        {
          bookingId: "booking-1",
          start: "2026-10-04T15:00:00.000Z",
          end: "2026-10-05T15:00:00.000Z",
        },
      ]),
    })

    expect(windows[0]?.label).toBe("2026-10-06 単日")
  })

  it("uses existing calendar blocks as soft scoring instead of a hard exclusion", async () => {
    const windows = await findCandidateWindows({
      jobContext: jobContext(),
      workflowEstimate: workflowEstimate(1),
      desiredDeadline: "2026-10-06T00:00:00+09:00",
      now: new Date("2026-10-05T10:00:00+09:00"),
      freeBusyFetcher: freeBusy([
        {
          start: "2026-10-04T15:00:00.000Z",
          end: "2026-10-05T15:00:00.000Z",
        },
      ]),
      attendanceConflictResolver: attendance(),
    })

    expect(windows).toHaveLength(1)
    expect(windows[0]?.label).toBe("2026-10-05 単日")
  })

  it("returns the top 3 candidate windows", async () => {
    const windows = await findCandidateWindows({
      jobContext: jobContext(),
      workflowEstimate: workflowEstimate(1),
      now: NOW_AFTER_STUDIO,
      freeBusyFetcher: freeBusy(),
      attendanceConflictResolver: attendance(),
    })

    expect(windows).toHaveLength(3)
  })

  it("does not return candidates before the material handoff lower bound", async () => {
    const windows = await findCandidateWindows({
      jobContext: jobContext(),
      workflowEstimate: workflowEstimate(1),
      notBefore: "2026-07-01",
      now: new Date("2026-06-15T10:00:00+09:00"),
      freeBusyFetcher: freeBusy(),
      attendanceConflictResolver: attendance(),
    })

    expect(windows).toHaveLength(3)
    expect(windows.every((window) => new Date(window.start) >= new Date("2026-06-30T15:00:00.000Z"))).toBe(true)
    expect(windows.map((window) => window.label)).not.toContain("2026-06-15 - 2026-06-15")
  })

  it("allows disjoint selectable days around busy slots without requiring a continuous keep range", async () => {
    const windows = await findCandidateWindows({
      jobContext: jobContext(),
      workflowEstimate: workflowEstimate(2),
      now: NOW_AFTER_STUDIO,
      busyMode: "block",
      freeBusyFetcher: freeBusy([
        {
          start: "2026-10-02T01:00:00.000Z",
          end: "2026-10-02T03:00:00.000Z",
        },
      ]),
      attendanceConflictResolver: attendance(),
    })

    expect(windows.map((window) => window.label)).toEqual([
      "2026-10-01 単日",
      "2026-10-03 単日",
      "2026-10-04 単日",
    ])
  })

  it("filters out windows that end after desiredDeadline", async () => {
    const windows = await findCandidateWindows({
      jobContext: jobContext(),
      workflowEstimate: workflowEstimate(1),
      desiredDeadline: "2026-10-02",
      now: NOW_AFTER_STUDIO,
      freeBusyFetcher: freeBusy(),
      attendanceConflictResolver: attendance(),
    })

    expect(windows.map((window) => window.label)).toEqual(["2026-10-01 単日"])
  })

  it("returns an empty array instead of throwing when no window remains", async () => {
    const windows = await findCandidateWindows({
      jobContext: jobContext(),
      workflowEstimate: workflowEstimate(1),
      desiredDeadline: "2026-09-30",
      now: NOW_AFTER_STUDIO,
      freeBusyFetcher: freeBusy(),
      attendanceConflictResolver: attendance(),
    })

    expect(windows).toEqual([])
  })

  it("rounds totalMinDays up to required days", async () => {
    const windows = await findCandidateWindows({
      jobContext: jobContext(),
      workflowEstimate: workflowEstimate(1.2),
      now: NOW_AFTER_STUDIO,
      freeBusyFetcher: freeBusy(),
      attendanceConflictResolver: attendance(),
    })

    expect(windows[0]?.label).toBe("2026-10-01 単日")
  })

  it("includes Saturday and Sunday as selectable days", async () => {
    const windows = await findCandidateWindows({
      jobContext: jobContext(),
      workflowEstimate: workflowEstimate(2),
      now: new Date("2026-10-02T10:00:00+09:00"),
      freeBusyFetcher: freeBusy(),
      attendanceConflictResolver: attendance(),
    })

    expect(windows.slice(0, 3).map((window) => window.label)).toEqual([
      "2026-10-02 単日",
      "2026-10-03 単日",
      "2026-10-04 単日",
    ])
  })

  it("uses an 8 week default lookahead", async () => {
    const fetcher = freeBusy()

    await findCandidateWindows({
      jobContext: jobContext(),
      workflowEstimate: workflowEstimate(1),
      now: NOW_AFTER_STUDIO,
      freeBusyFetcher: fetcher,
      attendanceConflictResolver: attendance(),
    })

    expect(fetcher).toHaveBeenCalledWith({
      from: "2026-09-30T15:00:00.000Z",
      to: "2026-11-26T01:00:00.000Z",
    })
  })

  it("uses IB_仕事 timed rows as the default busy source without booking-record conflicts", async () => {
    mocks.getNotionWorkScheduleBusyIntervals.mockResolvedValueOnce([
      {
        start: "2026-10-01T01:00:00.000Z",
        end: "2026-10-01T03:00:00.000Z",
      },
    ])

    const windows = await findCandidateWindows({
      jobContext: jobContext(),
      workflowEstimate: workflowEstimate(1),
      now: NOW_AFTER_STUDIO,
      busyMode: "block",
    })

    expect(mocks.getNotionWorkScheduleBusyIntervals).toHaveBeenCalledWith({
      from: "2026-09-30T15:00:00.000Z",
      to: "2026-11-26T01:00:00.000Z",
    })
    expect(windows[0]?.label).toBe("2026-10-02 単日")
  })

  it("keeps all-day date-only work rows available for tentative hold candidates", async () => {
    mocks.getNotionWorkScheduleBusyIntervals.mockResolvedValueOnce([
      {
        start: "2026-09-30T15:00:00.000Z",
        end: "2026-10-01T15:00:00.000Z",
      },
    ])

    const calendar = await findCandidateCalendar({
      jobContext: jobContext(),
      workflowEstimate: workflowEstimate(1),
      now: NOW_AFTER_STUDIO,
      busyMode: "block",
    })

    expect(calendar.candidates[0]?.label).toBe("2026-10-01 単日")
    expect(calendar.busyDateKeys).not.toContain("2026-10-01")
  })

  it("returns only public busy date keys for timed work rows", async () => {
    mocks.getNotionWorkScheduleBusyIntervals.mockResolvedValueOnce([
      {
        start: "2026-10-05T01:00:00.000Z",
        end: "2026-10-05T03:00:00.000Z",
      },
      {
        start: "2026-10-06T01:00:00.000Z",
        end: "2026-10-06T03:00:00.000Z",
      },
    ])

    const calendar = await findCandidateCalendar({
      jobContext: jobContext(),
      workflowEstimate: workflowEstimate(1),
      now: NOW_AFTER_STUDIO,
      busyMode: "block",
    })

    expect(calendar.busyDateKeys).toEqual(["2026-10-05", "2026-10-06"])
    expect(JSON.stringify(calendar)).not.toContain("bookingId")
    expect(JSON.stringify(calendar)).not.toContain("Secret")
  })

  it("keeps busy date keys visible from busyFrom even when selectable candidates start later", async () => {
    const fetcher = freeBusy([
      {
        start: "2026-06-12T01:00:00.000Z",
        end: "2026-06-12T03:00:00.000Z",
      },
      {
        start: "2026-06-24T01:00:00.000Z",
        end: "2026-06-24T03:00:00.000Z",
      },
    ])

    const calendar = await findCandidateCalendar({
      jobContext: jobContext(),
      workflowEstimate: workflowEstimate(1),
      now: new Date("2026-06-01T00:00:00+09:00"),
      notBefore: "2026-06-20",
      busyFrom: "2026-06-01",
      busyMode: "block",
      freeBusyFetcher: fetcher,
      attendanceConflictResolver: attendance(),
    })

    expect(fetcher).toHaveBeenCalledWith({
      from: "2026-05-31T15:00:00.000Z",
      to: "2026-07-26T15:00:00.000Z",
    })
    expect(calendar.busyDateKeys).toEqual(["2026-06-12", "2026-06-24"])
    expect(calendar.candidates.every((window) => new Date(window.start) >= new Date("2026-06-19T15:00:00.000Z"))).toBe(true)
  })

  it("keeps scoring reasoning in CandidateWindow.note", async () => {
    const windows = await findCandidateWindows({
      jobContext: jobContext(),
      workflowEstimate: workflowEstimate(1),
      desiredDeadline: "2026-10-20",
      now: NOW_AFTER_STUDIO,
      freeBusyFetcher: freeBusy(),
      attendanceConflictResolver: attendance(),
    })

    expect(windows[0]?.note).toContain("requiredDays=1")
    expect(windows[0]?.note).toContain("busyRatio=0.00")
    expect(windows[0]?.note).toContain("deadlineSlackDays=")
    expect(windows[0]?.note).toContain("attendanceConflicts=0")
  })

  it("wraps injected fetch and attendance resolver failures", async () => {
    await expect(
      findCandidateWindows({
        jobContext: jobContext(),
        workflowEstimate: workflowEstimate(1),
        now: NOW_AFTER_STUDIO,
        freeBusyFetcher: vi.fn(async () => {
          throw new Error("fetch failed")
        }),
        attendanceConflictResolver: attendance(),
      }),
    ).rejects.toBeInstanceOf(ChatbotAvailabilityError)

    await expect(
      findCandidateWindows({
        jobContext: jobContext(),
        workflowEstimate: workflowEstimate(1),
        now: NOW_AFTER_STUDIO,
        freeBusyFetcher: freeBusy(),
        attendanceConflictResolver: vi.fn(async () => {
          throw new Error("resolver failed")
        }),
      }),
    ).rejects.toMatchObject({ kind: "attendance-resolver-failed" })
  })
})
