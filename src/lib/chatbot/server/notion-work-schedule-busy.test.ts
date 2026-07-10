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
} from "./notion-work-schedule-busy"

function page(date: { start: string; end?: string | null }, taskType: string) {
  return {
    object: "page",
    id: `${date.start}-${taskType}`,
    properties: {
      実施予定日: {
        type: "date",
        date,
      },
      タスク種別: {
        type: "select",
        select: { name: taskType },
      },
    },
  }
}

describe("notion work schedule busy reader", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearNotionWorkScheduleBusyCacheForTests()
    mocks.getNotionClient.mockReturnValue({
      dataSources: {
        query: mocks.query,
      },
    })
    mocks.query.mockResolvedValue({
      results: [
        page({ start: "2026-07-15T10:00:00.000+09:00", end: "2026-07-15T11:00:00.000+09:00" }, "仮押さえ"),
        page({ start: "2026-07-16", end: "2026-07-17" }, "仮押さえ"),
        page({ start: "2026-07-18" }, "本予約"),
      ],
      has_more: false,
      next_cursor: null,
    })
  })

  it("keeps timed rows as busy intervals while exposing date-only tentative keys separately", async () => {
    await expect(
      getNotionWorkScheduleBusyIntervals({
        from: "2026-07-01T00:00:00.000+09:00",
        to: "2026-08-01T00:00:00.000+09:00",
      }),
    ).resolves.toEqual([
      {
        start: "2026-07-15T01:00:00.000Z",
        end: "2026-07-15T02:00:00.000Z",
        source: "notion_work",
      },
    ])

    await expect(
      getNotionWorkTentativeDateKeys({
        from: "2026-07-01T00:00:00.000+09:00",
        to: "2026-08-01T00:00:00.000+09:00",
      }),
    ).resolves.toEqual(["2026-07-16", "2026-07-17"])
  })
})
