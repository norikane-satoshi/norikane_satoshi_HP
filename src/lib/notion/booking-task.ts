import { Client } from "@notionhq/client"

// IB_仕事 DB の data source id（cc-notion / openclaw.json と同じ値）。
// HP からは 直接 Notion API を叩いて IB_仕事 ページを「タスク種別: スケジュール」付きで作成・更新する。
// cc-notion 側の gcal_watchdog はこの notion ページを後から自動上書きしないため、HP 側で先に作る方針。
export const IB_WORK_DATA_SOURCE_ID = "34713ee3-141a-817b-8b61-000b5f3d2fee"

const TITLE_PROPERTY = "名前"
const TASK_TYPE_PROPERTY = "タスク種別"
const SCHEDULED_DATE_PROPERTY = "実施予定日"
const GCAL_EVENT_ID_PROPERTY = "gcal_event_id"
const HP_BOOKING_TASK_TYPE = "スケジュール"

let cachedClient: Client | null = null

function getNotionClient(): Client | null {
  if (cachedClient) return cachedClient
  const auth = process.env.NOTION_TOKEN
  if (!auth) return null
  cachedClient = new Client({ auth })
  return cachedClient
}

export type CreateBookingTaskInput = {
  title: string
  start: string
  end: string
  gcalEventId: string | null
  description: string
}

export type CreateBookingTaskResult =
  | { skipped: true; reason: string }
  | { skipped: false; pageId: string }

function buildProperties(input: CreateBookingTaskInput) {
  const properties: Record<string, unknown> = {
    [TITLE_PROPERTY]: {
      title: [{ text: { content: input.title } }],
    },
    [TASK_TYPE_PROPERTY]: {
      select: { name: HP_BOOKING_TASK_TYPE },
    },
    [SCHEDULED_DATE_PROPERTY]: {
      date: { start: input.start, end: input.end },
    },
  }
  if (input.gcalEventId) {
    properties[GCAL_EVENT_ID_PROPERTY] = {
      rich_text: [{ text: { content: input.gcalEventId } }],
    }
  }
  return properties
}

function buildBodyChildren(description: string) {
  if (!description.trim()) return []
  return description.split("\n").map((line) => ({
    object: "block" as const,
    type: "paragraph" as const,
    paragraph: {
      rich_text: line ? [{ type: "text" as const, text: { content: line } }] : [],
    },
  }))
}

export async function createBookingTaskPage(
  input: CreateBookingTaskInput,
): Promise<CreateBookingTaskResult> {
  const client = getNotionClient()
  if (!client) return { skipped: true, reason: "NOTION_TOKEN is not set" }

  const response = await client.pages.create({
    parent: {
      type: "data_source_id",
      data_source_id: IB_WORK_DATA_SOURCE_ID,
    },
    properties: buildProperties(input) as never,
    children: buildBodyChildren(input.description) as never,
  })
  return { skipped: false, pageId: response.id }
}

// 既存予約の backfill 用：notionPageId 未付与の本予約に対して、
// (a) gcal_event_id で IB_仕事 を検索 → ヒットすれば「タスク種別: スケジュール」をセット、
// (b) ヒットしなければ新規ページ作成。
export async function findIbWorkPageByGcalEventId(
  gcalEventId: string,
): Promise<string | null> {
  const client = getNotionClient()
  if (!client) return null
  const response = await client.dataSources.query({
    data_source_id: IB_WORK_DATA_SOURCE_ID,
    filter: {
      property: GCAL_EVENT_ID_PROPERTY,
      rich_text: { equals: gcalEventId },
    },
    page_size: 1,
  } as never)
  const pages = (response as { results: { id: string }[] }).results
  return pages[0]?.id ?? null
}

export async function setTaskTypeSchedule(pageId: string): Promise<void> {
  const client = getNotionClient()
  if (!client) return
  await client.pages.update({
    page_id: pageId,
    properties: {
      [TASK_TYPE_PROPERTY]: {
        select: { name: HP_BOOKING_TASK_TYPE },
      },
    } as never,
  })
}
