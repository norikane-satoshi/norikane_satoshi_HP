import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  getNotionClient: vi.fn(),
}))

vi.mock("@/lib/notion/server/client", () => ({
  IB_WORK_DATA_SOURCE_ID: "ib_work",
  getNotionClient: mocks.getNotionClient,
}))

import {
  clearNotionWorkScheduleBusyCacheForTests,
  getNotionWorkScheduleBusyIntervals,
  getNotionWorkTentativeDateKeys,
} from "../notion-work-schedule-busy"

function page(date: { start: string; end?: string | null }, taskType: string | null) {
  return {
    object: "page",
    id: `${date.start}-${taskType}`,
    properties: {
      実施予定日: { type: "date", date: { start: date.start, end: date.end ?? null } },
      ...(taskType === null ? {} : { タスク種別: { type: "select", select: { name: taskType } } }),
    },
  }
}

const AUG = { from: "2026-08-01T00:00:00.000+09:00", to: "2026-09-01T00:00:00.000+09:00" }

function respond(pages: unknown[]) {
  mocks.query.mockResolvedValue({ results: pages, has_more: false, next_cursor: null })
}

beforeEach(() => {
  vi.clearAllMocks()
  clearNotionWorkScheduleBusyCacheForTests()
  mocks.getNotionClient.mockReturnValue({ dataSources: { query: mocks.query } })
})

describe("実施時間を持たない日時型（JST 0:00 → 0:00）", () => {
  it("treats a 仮押さえ spanning exactly one JST day as tentative, not busy", async () => {
    // 予約フォーム由来の【仮キープ】が 00:00〜翌00:00 の日時型で入ることがある。
    // 時刻の幅が無いので「実施時間あり」ではなく終日として扱う。
    respond([page({ start: "2026-08-28T00:00:00.000+09:00", end: "2026-08-29T00:00:00.000+09:00" }, "仮押さえ")])

    await expect(getNotionWorkScheduleBusyIntervals(AUG)).resolves.toEqual([])
    await expect(getNotionWorkTentativeDateKeys(AUG)).resolves.toEqual(["2026-08-28"])
  })

  it("does not spill the exclusive end into the next day", async () => {
    respond([page({ start: "2026-08-28T00:00:00.000+09:00", end: "2026-08-31T00:00:00.000+09:00" }, "仮押さえ")])

    await expect(getNotionWorkTentativeDateKeys(AUG)).resolves.toEqual([
      "2026-08-28", "2026-08-29", "2026-08-30",
    ])
  })

  it("still blocks the same shape when it is not a 仮押さえ", async () => {
    respond([page({ start: "2026-08-28T00:00:00.000+09:00", end: "2026-08-29T00:00:00.000+09:00" }, "本予約")])

    await expect(getNotionWorkScheduleBusyIntervals(AUG)).resolves.toEqual([
      {
        start: new Date("2026-08-28T00:00:00+09:00").toISOString(),
        end: new Date("2026-08-29T00:00:00+09:00").toISOString(),
        source: "notion_work",
      },
    ])
    await expect(getNotionWorkTentativeDateKeys(AUG)).resolves.toEqual([])
  })

  it("keeps a real timed 仮押さえ as busy because it does carry 実施時間", async () => {
    respond([page({ start: "2026-08-14T10:00:00.000+09:00", end: "2026-08-14T20:00:00.000+09:00" }, "仮押さえ")])

    await expect(getNotionWorkScheduleBusyIntervals(AUG)).resolves.toEqual([
      {
        start: new Date("2026-08-14T10:00:00+09:00").toISOString(),
        end: new Date("2026-08-14T20:00:00+09:00").toISOString(),
        source: "notion_work",
      },
    ])
    await expect(getNotionWorkTentativeDateKeys(AUG)).resolves.toEqual([])
  })

  it("does not treat a midnight start with a timed end as all-day", async () => {
    respond([page({ start: "2026-08-20T00:00:00.000+09:00", end: "2026-08-20T09:30:00.000+09:00" }, "仮押さえ")])

    await expect(getNotionWorkScheduleBusyIntervals(AUG)).resolves.toHaveLength(1)
    await expect(getNotionWorkTentativeDateKeys(AUG)).resolves.toEqual([])
  })

  it("keeps date-only 仮押さえ working with its inclusive end", async () => {
    respond([page({ start: "2026-08-24", end: "2026-08-26" }, "仮押さえ")])

    await expect(getNotionWorkTentativeDateKeys(AUG)).resolves.toEqual([
      "2026-08-24", "2026-08-25", "2026-08-26",
    ])
  })
})
