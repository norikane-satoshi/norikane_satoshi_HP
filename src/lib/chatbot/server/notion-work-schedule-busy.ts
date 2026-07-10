import {
  getNotionClient,
  IB_WORK_DATA_SOURCE_ID,
} from "@/lib/notion/server/client"

import type {
  PageObjectResponse,
  QueryDataSourceResponse,
} from "@notionhq/client/build/src/api-endpoints"

const SCHEDULED_AT_PROPERTY = "実施予定日"
const TASK_TYPE_PROPERTY = "タスク種別"
const CACHE_TTL_MS = 120_000
const DAY_MS = 24 * 60 * 60 * 1000
const JST_OFFSET_MS = 9 * 60 * 60 * 1000
const MAX_QUERY_PAGES = 10

type BusyInterval = {
  start: string
  end: string
  source: "notion_work"
}

type CacheEntry = {
  expiresAt: number
  value: BusyInterval[]
}

const cache = new Map<string, CacheEntry>()

export function clearNotionWorkScheduleBusyCacheForTests() {
  cache.clear()
}

export async function getNotionWorkScheduleBusyIntervals(args: {
  from: string
  to: string
}): Promise<BusyInterval[]> {
  const cacheKey = `${args.from}|${args.to}|${IB_WORK_DATA_SOURCE_ID}`
  const now = Date.now()
  const cached = cache.get(cacheKey)
  if (cached && cached.expiresAt > now) return cached.value

  const notion = getNotionClient()
  if (!notion) {
    throw new Error("NOTION_TOKEN is required to read IB_仕事 scheduled rows.")
  }

  const from = new Date(args.from)
  const to = new Date(args.to)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from.getTime() >= to.getTime()) {
    return []
  }

  const results = await queryWorkSchedulePages(args.to)

  const intervals = results
    .map(toBusyInterval)
    .filter((interval): interval is BusyInterval => interval !== null)
    .filter((interval) => overlaps(interval, from, to))

  cache.set(cacheKey, {
    expiresAt: now + CACHE_TTL_MS,
    value: intervals,
  })

  return intervals
}

export async function getNotionWorkTentativeDateKeys(args: {
  from: string
  to: string
}): Promise<string[]> {
  const notion = getNotionClient()
  if (!notion) {
    throw new Error("NOTION_TOKEN is required to read IB_仕事 scheduled rows.")
  }

  const fromKey = args.from.slice(0, 10)
  const toKey = args.to.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromKey) || !/^\d{4}-\d{2}-\d{2}$/.test(toKey) || fromKey >= toKey) {
    return []
  }

  const results = await queryWorkSchedulePages(args.to)
  const dateKeys = new Set<string>()
  for (const row of results) {
    if (getTaskType(row) !== "仮押さえ") continue
    const property = row.properties[SCHEDULED_AT_PROPERTY]
    if (!property || property.type !== "date" || !property.date?.start) continue
    if (hasTime(property.date.start)) continue

    const startKey = property.date.start.slice(0, 10)
    const endKey = property.date.end && !hasTime(property.date.end) ? property.date.end.slice(0, 10) : startKey
    for (let cursor = startKey; cursor <= endKey; cursor = addDays(cursor, 1)) {
      if (cursor >= fromKey && cursor < toKey) dateKeys.add(cursor)
    }
  }

  return Array.from(dateKeys).sort()
}

function isFullPage(row: QueryDataSourceResponse["results"][number]): row is PageObjectResponse {
  return "properties" in row
}

async function queryWorkSchedulePages(to: string): Promise<PageObjectResponse[]> {
  const notion = getNotionClient()
  if (!notion) {
    throw new Error("NOTION_TOKEN is required to read IB_仕事 scheduled rows.")
  }

  const results: PageObjectResponse[] = []
  let cursor: string | undefined
  for (let i = 0; i < MAX_QUERY_PAGES; i += 1) {
    const response: QueryDataSourceResponse = await notion.dataSources.query({
      data_source_id: IB_WORK_DATA_SOURCE_ID,
      filter: {
        property: SCHEDULED_AT_PROPERTY,
        date: { on_or_before: to },
      },
      sorts: [{ property: SCHEDULED_AT_PROPERTY, direction: "ascending" }],
      page_size: 100,
      start_cursor: cursor,
    })

    for (const row of response.results) {
      if (isFullPage(row)) results.push(row)
    }
    if (!response.has_more || !response.next_cursor) break
    cursor = response.next_cursor
  }
  return results
}

function toBusyInterval(page: PageObjectResponse): BusyInterval | null {
  const property = page.properties[SCHEDULED_AT_PROPERTY]
  if (!property || property.type !== "date" || !property.date?.start) return null
  if (!hasTime(property.date.start)) return null

  const start = parseNotionDate(property.date.start, false)
  const end = property.date.end
    ? parseNotionDate(property.date.end, true)
    : endOfJstDay(start)

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null
  if (start.getTime() >= end.getTime()) return null

  return {
    start: start.toISOString(),
    end: end.toISOString(),
    source: "notion_work",
  }
}

function getTaskType(page: PageObjectResponse): string | null {
  const property = page.properties[TASK_TYPE_PROPERTY]
  if (!property) return null
  if (property.type === "select") return property.select?.name ?? null
  if (property.type === "status") return property.status?.name ?? null
  if (property.type === "multi_select") return property.multi_select.map((item) => item.name).join(",") || null
  if (property.type === "rich_text") return property.rich_text.map((item) => item.plain_text).join("").trim() || null
  return null
}

function hasTime(value: string): boolean {
  return value.includes("T")
}

function addDays(dateKey: string, days: number): string {
  const [year = "0", month = "1", day = "1"] = dateKey.split("-")
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day) + days))
  return [
    String(date.getUTCFullYear()).padStart(4, "0"),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-")
}

function parseNotionDate(value: string, endExclusive: boolean): Date {
  if (hasTime(value)) return new Date(value)
  const parsed = new Date(`${value}T00:00:00.000+09:00`)
  return endExclusive ? new Date(parsed.getTime() + DAY_MS) : parsed
}

function endOfJstDay(date: Date): Date {
  const jst = new Date(date.getTime() + JST_OFFSET_MS)
  return new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate() + 1) - JST_OFFSET_MS)
}

function overlaps(interval: BusyInterval, from: Date, to: Date): boolean {
  const start = new Date(interval.start)
  const end = new Date(interval.end)
  return start.getTime() < to.getTime() && end.getTime() > from.getTime()
}
