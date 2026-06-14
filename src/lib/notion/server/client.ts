import { Client } from "@notionhq/client"

let cachedClient: Client | null = null

// Returns null when NOTION_TOKEN is absent — callers should degrade to empty
// results so local builds without secrets still succeed. In Vercel production
// the env is required (see PR docs).
export function getNotionClient(): Client | null {
  if (cachedClient) return cachedClient
  const auth = process.env.NOTION_TOKEN
  if (!auth) return null
  cachedClient = new Client({ auth })
  return cachedClient
}

export const IB_NOTE_DATA_SOURCE_ID = "35613ee3-141a-8366-b5ec-07e7bb1c2dd0"

export const TITLE_PROPERTY = "名前"
export const SLUG_PROPERTY = "slug"
export const PUBLISHED_PROPERTY = "HP公開"
