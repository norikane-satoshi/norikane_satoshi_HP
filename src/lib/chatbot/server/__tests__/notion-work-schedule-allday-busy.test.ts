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
      ...(taskType === null
        ? {}
        : { タスク種別: { type: "select", select: { name: taskType } } }),
    },
  }
}

const RANGE = { from: "2026-12-01T00:00:00.000+09:00", to: "2027-01-01T00:00:00.000+09:00" }

function respond(pages: unknown[]) {
  mocks.query.mockResolvedValue({ results: pages, has_more: false, next_cursor: null })
}

beforeEach(() => {
  vi.clearAllMocks()
  clearNotionWorkScheduleBusyCacheForTests()
  mocks.getNotionClient.mockReturnValue({ dataSources: { query: mocks.query } })
})

describe("date-only IB_仕事 rows", () => {
  it("blocks a 本予約 that covers whole days as busy", async () => {
    // 【仮キープ】Hulu「水車館の殺人」12月全日 と同じ形。実施時間を持たない本予約は
    // 「その月まるごと押さえた」という意味なので NG 日にする。
    respond([page({ start: "2026-12-01", end: "2026-12-31" }, "本予約")])

    await expect(getNotionWorkScheduleBusyIntervals(RANGE)).resolves.toEqual([
      {
        start: new Date("2026-12-01T00:00:00+09:00").toISOString(),
        end: new Date("2027-01-01T00:00:00+09:00").toISOString(),
        source: "notion_work",
      },
    ])
  })

  it("blocks a date-only row with no タスク種別 as busy", async () => {
    // 家族・個人の NG 日は種別空欄で登録される運用なので、空欄も NG 扱いにする。
    respond([page({ start: "2026-12-05" }, null)])

    await expect(getNotionWorkScheduleBusyIntervals(RANGE)).resolves.toEqual([
      {
        start: new Date("2026-12-05T00:00:00+09:00").toISOString(),
        end: new Date("2026-12-06T00:00:00+09:00").toISOString(),
        source: "notion_work",
      },
    ])
  })

  it("keeps a 仮押さえ out of busy and reports it as tentative instead", async () => {
    respond([page({ start: "2026-12-10", end: "2026-12-11" }, "仮押さえ")])

    await expect(getNotionWorkScheduleBusyIntervals(RANGE)).resolves.toEqual([])
    await expect(getNotionWorkTentativeDateKeys(RANGE)).resolves.toEqual(["2026-12-10", "2026-12-11"])
  })

  it("still blocks timed rows for exactly their hours", async () => {
    respond([page({ start: "2026-12-03T10:00:00.000+09:00", end: "2026-12-03T19:00:00.000+09:00" }, "本予約")])

    await expect(getNotionWorkScheduleBusyIntervals(RANGE)).resolves.toEqual([
      {
        start: new Date("2026-12-03T10:00:00+09:00").toISOString(),
        end: new Date("2026-12-03T19:00:00+09:00").toISOString(),
        source: "notion_work",
      },
    ])
  })
})
