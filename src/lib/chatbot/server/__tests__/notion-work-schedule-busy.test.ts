import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getNotionClient: vi.fn(),
  query: vi.fn(),
}))

vi.mock("@/lib/notion/server/client", () => ({
  getNotionClient: mocks.getNotionClient,
  IB_WORK_DATA_SOURCE_ID: "ib-work-ds",
}))

import {
  clearNotionWorkScheduleBusyCacheForTests,
  getNotionWorkScheduleBusyIntervals,
} from "@/lib/chatbot/server/notion-work-schedule-busy"

function page(id: string, date: { start: string; end?: string | null }, extraProperties = {}) {
  return {
    id,
    properties: {
      "実施予定日": {
        type: "date",
        date,
      },
      ...extraProperties,
    },
  }
}

describe("getNotionWorkScheduleBusyIntervals", () => {
  beforeEach(() => {
    clearNotionWorkScheduleBusyCacheForTests()
    mocks.getNotionClient.mockReset()
    mocks.query.mockReset()
    mocks.getNotionClient.mockReturnValue({
      dataSources: { query: mocks.query },
    })
  })

  it("treats rows with time in 実施予定日 as busy", async () => {
    mocks.query.mockResolvedValueOnce({
      results: [
        page("timed", {
          start: "2026-07-01T10:00:00+09:00",
          end: "2026-07-01T12:00:00+09:00",
        }),
      ],
      has_more: false,
      next_cursor: null,
    })

    await expect(
      getNotionWorkScheduleBusyIntervals({
        from: "2026-06-30T15:00:00.000Z",
        to: "2026-07-02T15:00:00.000Z",
      }),
    ).resolves.toEqual([
      {
        start: "2026-07-01T01:00:00.000Z",
        end: "2026-07-01T03:00:00.000Z",
      },
    ])
  })

  it("keeps date-only rows available", async () => {
    mocks.query.mockResolvedValueOnce({
      results: [
        page("date-only", {
          start: "2026-07-01",
          end: null,
        }),
      ],
      has_more: false,
      next_cursor: null,
    })

    await expect(
      getNotionWorkScheduleBusyIntervals({
        from: "2026-06-30T15:00:00.000Z",
        to: "2026-07-02T15:00:00.000Z",
      }),
    ).resolves.toEqual([])
  })

  it("keeps a timed range busy across every overlapping day", async () => {
    mocks.query.mockResolvedValueOnce({
      results: [
        page("range", {
          start: "2026-07-01T10:00:00+09:00",
          end: "2026-07-03T18:00:00+09:00",
        }),
      ],
      has_more: false,
      next_cursor: null,
    })

    await expect(
      getNotionWorkScheduleBusyIntervals({
        from: "2026-07-01T15:00:00.000Z",
        to: "2026-07-04T15:00:00.000Z",
      }),
    ).resolves.toEqual([
      {
        start: "2026-07-01T01:00:00.000Z",
        end: "2026-07-03T09:00:00.000Z",
      },
    ])
  })

  it("does not expose work row names or customer fields", async () => {
    mocks.query.mockResolvedValueOnce({
      results: [
        page("secret", {
          start: "2026-07-01T10:00:00+09:00",
          end: "2026-07-01T12:00:00+09:00",
        }, {
          "名前": { type: "title", title: [{ plain_text: "Secret project" }] },
          "顧客名": { type: "rich_text", rich_text: [{ plain_text: "Customer" }] },
          "顧客会社名": { type: "rich_text", rich_text: [{ plain_text: "Company" }] },
        }),
      ],
      has_more: false,
      next_cursor: null,
    })

    const result = await getNotionWorkScheduleBusyIntervals({
      from: "2026-06-30T15:00:00.000Z",
      to: "2026-07-02T15:00:00.000Z",
    })

    expect(Object.keys(result[0] ?? {}).sort()).toEqual(["end", "start"])
    expect(JSON.stringify(result)).not.toContain("Secret project")
    expect(JSON.stringify(result)).not.toContain("Customer")
    expect(JSON.stringify(result)).not.toContain("Company")
  })

  it("caches identical Notion queries briefly", async () => {
    mocks.query.mockResolvedValue({
      results: [],
      has_more: false,
      next_cursor: null,
    })

    const args = {
      from: "2026-06-30T15:00:00.000Z",
      to: "2026-07-02T15:00:00.000Z",
    }
    await getNotionWorkScheduleBusyIntervals(args)
    await getNotionWorkScheduleBusyIntervals(args)

    expect(mocks.query).toHaveBeenCalledTimes(1)
  })

  it("fails closed when the Notion server client is unavailable", async () => {
    mocks.getNotionClient.mockReturnValue(null)

    await expect(
      getNotionWorkScheduleBusyIntervals({
        from: "2026-06-30T15:00:00.000Z",
        to: "2026-07-02T15:00:00.000Z",
      }),
    ).rejects.toThrow("NOTION_TOKEN")
  })
})
