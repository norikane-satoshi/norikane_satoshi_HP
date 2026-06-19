import type { WorkflowDurationPreset } from "@/lib/chatbot/knowledge/workflow-duration"
import { workflowDurationPresets } from "@/lib/chatbot/knowledge/workflow-duration"
import { getNotionClient } from "@/lib/notion/server/client"

export const defaultChatbotKnowledgeManifestPageId = "3088971f957b481baff8499ff911051b"
const knowledgeSnapshotKey = "chatbot-notion-knowledge"
const knowledgeSnapshotVersion = 1

export type ChatbotKnowledgeEntryUsage = "workflow-duration" | "color-correction" | "color-grading" | "film-look"

export type ChatbotKnowledgeManifestEntry = {
  id: string
  pageId: string
  pageTitle?: string
  usage: ChatbotKnowledgeEntryUsage
  referenceRange: string
  priority: number
  reflectionTiming: "page-update"
}

export type SyncedWorkflowDurationPreset = WorkflowDurationPreset & {
  source: "static" | "notion-sync"
}

export type SyncedNoteKnowledge = {
  usage: Exclude<ChatbotKnowledgeEntryUsage, "workflow-duration">
  pageId: string
  pageTitle?: string
  referenceRange: string
  content: string
  source: "notion-sync"
}

export type ChatbotKnowledgeSnapshot = {
  version: 1
  manifestPageId: string
  syncedAt: string
  entries: Array<ChatbotKnowledgeManifestEntry & {
    status: "synced" | "skipped"
    lastSyncedAt?: string
    lastError?: string
  }>
  workflowDurations: {
    presets: SyncedWorkflowDurationPreset[]
  }
  noteKnowledge: SyncedNoteKnowledge[]
}

export type ChatbotKnowledgeRepository = {
  loadLatest(): Promise<ChatbotKnowledgeSnapshot | null>
  saveSuccess(snapshot: ChatbotKnowledgeSnapshot): Promise<void>
  saveError(error: {
    message: string
    failedAt: string
    manifestPageId: string
  }): Promise<void>
}

export type SyncChatbotNotionKnowledgeResult =
  | { ok: true; usedFallback: false; snapshot: ChatbotKnowledgeSnapshot }
  | { ok: false; usedFallback: boolean; error: string; snapshot: ChatbotKnowledgeSnapshot }

type NotionBlockListClient = {
  blocks: {
    children: {
      list(input: { block_id: string; start_cursor?: string; page_size?: number }): Promise<{
        results: unknown[]
        has_more?: boolean
        next_cursor?: string | null
      }>
    }
  }
}

export function createStaticChatbotKnowledgeSnapshot(syncedAt = new Date(0).toISOString()): ChatbotKnowledgeSnapshot {
  return {
    version: knowledgeSnapshotVersion,
    manifestPageId: defaultChatbotKnowledgeManifestPageId,
    syncedAt,
    entries: [],
    workflowDurations: {
      presets: workflowDurationPresets.map((preset) => ({ ...preset, source: "static" })),
    },
    noteKnowledge: [],
  }
}

export async function loadLatestChatbotKnowledgeSnapshot(
  repository: ChatbotKnowledgeRepository = createPrismaChatbotKnowledgeRepository(),
): Promise<ChatbotKnowledgeSnapshot> {
  try {
    return (await repository.loadLatest()) ?? createStaticChatbotKnowledgeSnapshot()
  } catch {
    return createStaticChatbotKnowledgeSnapshot()
  }
}

export async function syncChatbotNotionKnowledge(input: {
  client?: NotionBlockListClient | null
  repository?: ChatbotKnowledgeRepository
  manifestPageId?: string
  changedPageId?: string
  reason?: string
  now?: Date
}): Promise<SyncChatbotNotionKnowledgeResult> {
  const manifestPageId =
    normalizePageId(input.manifestPageId ?? process.env.CHATBOT_KNOWLEDGE_MANIFEST_PAGE_ID) ??
    defaultChatbotKnowledgeManifestPageId
  const now = input.now ?? new Date()
  const repository = input.repository ?? createPrismaChatbotKnowledgeRepository()
  const client = input.client ?? getNotionClient()

  try {
    if (!client) throw new Error("NOTION_TOKEN is not configured")

    const manifestBlocks = await listAllChildren(client, manifestPageId)
    const entries = parseKnowledgeManifestEntries(manifestBlocks)
    const changedPageId = normalizePageId(input.changedPageId)
    const shouldSync =
      !changedPageId ||
      changedPageId === manifestPageId ||
      entries.some((entry) => entry.pageId === changedPageId)
    const snapshot = createStaticChatbotKnowledgeSnapshot(now.toISOString())
    snapshot.manifestPageId = manifestPageId

    if (!shouldSync) {
      snapshot.entries = entries.map((entry) => ({
        ...entry,
        status: "skipped",
        lastSyncedAt: now.toISOString(),
      }))
      await repository.saveSuccess(snapshot)
      return { ok: true, usedFallback: false, snapshot }
    }

    const sortedEntries = [...entries].sort((a, b) => a.priority - b.priority)
    const nextEntries: ChatbotKnowledgeSnapshot["entries"] = []
    let workflowPresets = snapshot.workflowDurations.presets
    const noteKnowledge: SyncedNoteKnowledge[] = []

    for (const entry of sortedEntries) {
      const sourceBlocks = await listAllChildren(client, entry.pageId)
      if (entry.usage === "workflow-duration") {
        workflowPresets = mergeWorkflowDurationPresets(
          workflowPresets,
          extractWorkflowDurationPresets(sourceBlocks, entry.referenceRange),
        )
      } else {
        noteKnowledge.push({
          usage: entry.usage,
          pageId: entry.pageId,
          pageTitle: entry.pageTitle,
          referenceRange: entry.referenceRange,
          content: extractPublicNoteKnowledge(sourceBlocks, entry.referenceRange),
          source: "notion-sync",
        })
      }
      nextEntries.push({ ...entry, status: "synced", lastSyncedAt: now.toISOString() })
    }

    snapshot.entries = nextEntries
    snapshot.workflowDurations.presets = workflowPresets
    snapshot.noteKnowledge = noteKnowledge
    await repository.saveSuccess(snapshot)

    return { ok: true, usedFallback: false, snapshot }
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error"
    await repository.saveError({
      message,
      failedAt: now.toISOString(),
      manifestPageId,
    })
    const fallback = (await repository.loadLatest()) ?? createStaticChatbotKnowledgeSnapshot(now.toISOString())
    return {
      ok: false,
      usedFallback: true,
      error: message,
      snapshot: fallback,
    }
  }
}

export function getWorkflowDurationPresetsFromSnapshot(
  snapshot: ChatbotKnowledgeSnapshot | null | undefined,
): readonly WorkflowDurationPreset[] {
  return snapshot?.workflowDurations.presets ?? workflowDurationPresets
}

function createPrismaChatbotKnowledgeRepository(): ChatbotKnowledgeRepository {
  return {
    async loadLatest() {
      const prisma = await getPrisma()
      const row = await prisma.chatbotKnowledgeSnapshot.findUnique({
        where: { key: knowledgeSnapshotKey },
      })
      if (!row?.snapshotJson) return null
      return parseSnapshotJson(row.snapshotJson)
    },
    async saveSuccess(snapshot) {
      const prisma = await getPrisma()
      await prisma.chatbotKnowledgeSnapshot.upsert({
        where: { key: knowledgeSnapshotKey },
        create: {
          key: knowledgeSnapshotKey,
          snapshotJson: JSON.stringify(snapshot),
          status: "success",
          lastSyncedAt: new Date(snapshot.syncedAt),
          lastError: null,
          lastErrorAt: null,
        },
        update: {
          snapshotJson: JSON.stringify(snapshot),
          status: "success",
          lastSyncedAt: new Date(snapshot.syncedAt),
          lastError: null,
          lastErrorAt: null,
        },
      })
    },
    async saveError(error) {
      const prisma = await getPrisma()
      await prisma.chatbotKnowledgeSnapshot.upsert({
        where: { key: knowledgeSnapshotKey },
        create: {
          key: knowledgeSnapshotKey,
          snapshotJson: JSON.stringify(createStaticChatbotKnowledgeSnapshot(error.failedAt)),
          status: "error",
          lastError: error.message,
          lastErrorAt: new Date(error.failedAt),
        },
        update: {
          status: "error",
          lastError: error.message,
          lastErrorAt: new Date(error.failedAt),
        },
      })
    },
  }
}

async function getPrisma() {
  const mod = await import("@/lib/prisma")
  return mod.prisma
}

function parseSnapshotJson(value: string): ChatbotKnowledgeSnapshot | null {
  try {
    const parsed = JSON.parse(value) as Partial<ChatbotKnowledgeSnapshot>
    if (parsed.version !== knowledgeSnapshotVersion || !parsed.workflowDurations) return null
    parsed.entries ??= []
    parsed.noteKnowledge ??= []
    return parsed as ChatbotKnowledgeSnapshot
  } catch {
    return null
  }
}

async function listAllChildren(client: NotionBlockListClient, blockId: string): Promise<unknown[]> {
  const results: unknown[] = []
  let cursor: string | undefined

  for (let i = 0; i < 50; i += 1) {
    const response = await client.blocks.children.list({
      block_id: blockId,
      start_cursor: cursor,
      page_size: 100,
    })
    for (const block of response.results) {
      results.push(block)
      if (blockHasChildren(block)) {
        const childBlocks = await listAllChildren(client, blockIdOf(block))
        results.push(...childBlocks)
      }
    }
    if (!response.has_more || !response.next_cursor) break
    cursor = response.next_cursor
  }

  return results
}

function blockHasChildren(block: unknown): boolean {
  return isRecord(block) && block.has_children === true && Boolean(blockIdOf(block))
}

function blockIdOf(block: unknown): string {
  return isRecord(block) && typeof block.id === "string" ? block.id : ""
}

type SectionRow = { id?: string; parentId?: string; text: string; pageReference?: string; cells: string[] }

function parseKnowledgeManifestEntries(blocks: unknown[]): ChatbotKnowledgeManifestEntry[] {
  const rows = collectSectionRows(blocks, "ナレッジ正本リスト")
  const entries: ChatbotKnowledgeManifestEntry[] = []

  for (const row of rows) {
    if (!row.pageReference && row.parentId && rows.some((candidate) => candidate.id === row.parentId)) continue
    const childRows = row.id ? rows.filter((candidate) => candidate.parentId === row.id) : []
    const values = parseKeyValueText(row.text)
    for (const childRow of childRows) Object.assign(values, parseKeyValueText(childRow.text))
    const tableValues = parseManifestTableRow(row.cells)
    const pageId = normalizePageId(
      row.pageReference ?? values.pageId ?? values["ページID"] ?? values["page"] ?? tableValues.page,
    )
    const usage = normalizeUsage(values["用途"] ?? values.usage ?? tableValues.usage ?? row.text)
    const referenceRange = normalizeReferenceRange(
      values["参照範囲"] ?? values.referenceRange ?? values.range ?? tableValues.referenceRange,
    ) ?? defaultReferenceRangeForUsage(usage)
    if (!pageId || !usage || !referenceRange) continue

    entries.push({
      id: `${pageId}:${usage}:${referenceRange}`,
      pageId,
      pageTitle: values["ページ"] ?? values.page ?? tableValues.pageTitle,
      usage,
      referenceRange,
      priority: parsePriority(values["優先度"] ?? values.priority ?? tableValues.priority),
      reflectionTiming: "page-update",
    })
  }

  return entries
}

function parseManifestTableRow(cells: string[]): {
  page?: string
  pageTitle?: string
  usage?: string
  referenceRange?: string
  priority?: string
} {
  if (cells.length < 3) return {}
  if (cells.some((cell) => cell === "用途" || cell === "参照範囲")) return {}
  return {
    page: cells[0],
    pageTitle: cells[0],
    usage: cells[1],
    referenceRange: cells[2],
    priority: cells[3],
  }
}

function extractWorkflowDurationPresets(
  blocks: unknown[],
  referenceRange: string,
): Partial<Record<WorkflowDurationPreset["id"], Pick<WorkflowDurationPreset, "minDays" | "maxDays">>> {
  const rows = collectSectionRows(blocks, referenceRange)
  const next: Partial<Record<WorkflowDurationPreset["id"], Pick<WorkflowDurationPreset, "minDays" | "maxDays">>> = {}

  for (const row of rows) {
    const cells = row.cells.length > 0 ? row.cells : [row.text]
    const rowText = cells.join(" / ")
    const preset = workflowDurationPresets.find((candidate) =>
      rowText.includes(candidate.id) || rowText.includes(candidate.label)
    )
    if (!preset) continue
    const range = parseDayRange(rowText)
    if (!range) continue
    next[preset.id] = range
  }

  return next
}

function extractPublicNoteKnowledge(blocks: unknown[], referenceRange: string): string {
  const sectionRows = collectSectionRows(blocks, referenceRange)
  const rows = sectionRows.length > 0 ? sectionRows : collectPublicNoteRows(blocks)
  const lines = rows
    .map((row) => sanitizePublicNoteLine(row.text))
    .filter((line): line is string => Boolean(line))

  return Array.from(new Set(lines)).join("\n").slice(0, 6000)
}

function collectPublicNoteRows(blocks: unknown[]): SectionRow[] {
  const rows: SectionRow[] = []
  let blockedByHeading = false

  for (const block of blocks) {
    const type = readType(block)
    const text = blockPlainText(block)
    const isHeading = type === "heading_1" || type === "heading_2" || type === "heading_3"

    if (isHeading) {
      blockedByHeading = isInternalNoteHeading(text)
      if (blockedByHeading || !text.trim()) continue
    }
    if (blockedByHeading) continue

    const cells = blockCells(block)
    const rowText = cells.length > 0 ? cells.join(" / ") : text
    if (!rowText.trim()) continue
    rows.push({
      id: blockId(block),
      parentId: blockParentId(block),
      text: rowText,
      pageReference: firstPageReference(block),
      cells,
    })
  }

  return rows
}

function sanitizePublicNoteLine(text: string): string | null {
  const normalized = text.replace(/\s+/g, " ").trim()
  if (!normalized) return null
  if (isInternalNoteHeading(normalized)) return null
  if (/(^|\s)(system|developer|assistant|user)\s*[:：]/i.test(normalized)) return null
  if (/ignore (all )?(previous|prior) instructions/i.test(normalized)) return null
  if (/(内部メモ|非公開|未承認|料金|契約|個別案件|他案件|プロンプト命令|指示文|この指示に従)/.test(normalized)) {
    return null
  }
  return normalized
}

function isInternalNoteHeading(text: string): boolean {
  return /(内部|非公開|未承認|管理用|下書きメモ|TODO|ToDo|料金|契約|個別案件|他案件|プロンプト|指示|開発メモ)/i.test(text)
}

function mergeWorkflowDurationPresets(
  current: readonly SyncedWorkflowDurationPreset[],
  updates: Partial<Record<WorkflowDurationPreset["id"], Pick<WorkflowDurationPreset, "minDays" | "maxDays">>>,
): SyncedWorkflowDurationPreset[] {
  return current.map((preset) => {
    const update = updates[preset.id as WorkflowDurationPreset["id"]]
    if (!update) return preset
    return {
      ...preset,
      minDays: update.minDays,
      maxDays: update.maxDays,
      source: "notion-sync",
    }
  })
}

function collectSectionRows(blocks: unknown[], headingText: string): SectionRow[] {
  const rows: SectionRow[] = []
  let inside = false
  const headingRank = (block: unknown) => {
    const type = readType(block)
    if (type === "heading_1") return 1
    if (type === "heading_2") return 2
    if (type === "heading_3") return 3
    return 0
  }

  for (const block of blocks) {
    const rank = headingRank(block)
    const text = blockPlainText(block)
    if (rank > 0) {
      if (text.includes(headingText)) {
        inside = true
        continue
      }
      if (inside && rank <= 2) break
    }
    if (!inside) continue

    const cells = blockCells(block)
    const rowText = cells.length > 0 ? cells.join(" / ") : text
    if (!rowText.trim()) continue
    rows.push({
      id: blockId(block),
      parentId: blockParentId(block),
      text: rowText,
      pageReference: firstPageReference(block),
      cells,
    })
  }

  return rows
}

function parseKeyValueText(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of text.split(/\s*[/｜|]\s*/)) {
    const match = part.match(/^\s*([^=:：]+)\s*[=:：]\s*(.+?)\s*$/)
    if (!match) continue
    out[match[1].trim()] = match[2].trim()
  }
  return out
}

function parseDayRange(text: string): Pick<WorkflowDurationPreset, "minDays" | "maxDays"> | null {
  const normalized = text.replace(/[０-９．]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) - 0xfee0),
  )
  const range = normalized.match(/(\d+(?:\.\d+)?)\s*(?:日)?\s*[〜~\-–]\s*(\d+(?:\.\d+)?)\s*日?/)
  if (range) return { minDays: Number(range[1]), maxDays: Number(range[2]) }
  const single = normalized.match(/(\d+(?:\.\d+)?)\s*日/)
  if (single) {
    const days = Number(single[1])
    return { minDays: days, maxDays: days }
  }
  return null
}

function normalizeUsage(value: string | undefined): ChatbotKnowledgeEntryUsage | undefined {
  if (!value) return undefined
  if (
    value === "workflow-duration" ||
    value === "工程日数" ||
    value === "工程別日数" ||
    value.includes("工程日数") ||
    value.includes("所定日数") ||
    value.includes("日程見積もり")
  ) {
    return "workflow-duration"
  }
  if (/color[-_\s]?correction/i.test(value) || value.includes("カラーコレクション") || value.includes("カラコレ")) {
    return "color-correction"
  }
  if (/color[-_\s]?grading/i.test(value) || value.includes("カラーグレーディング")) {
    return "color-grading"
  }
  if (/film[-_\s]?look/i.test(value) || value.includes("フィルムルック")) {
    return "film-look"
  }
  return undefined
}

function defaultReferenceRangeForUsage(usage: ChatbotKnowledgeEntryUsage | undefined): string | undefined {
  if (!usage || usage === "workflow-duration") return undefined
  return "公開本文"
}

function normalizeReferenceRange(value: string | undefined): string | undefined {
  if (!value) return undefined
  const quoted = value.match(/[「『](.+?)[」』]/)
  return (quoted?.[1] ?? value).trim()
}

function parsePriority(value: string | undefined): number {
  if (!value) return 100
  if (value === "高") return 1
  if (value === "中") return 50
  if (value === "低") return 100
  const priority = Number(value)
  return Number.isFinite(priority) ? priority : 100
}

function normalizePageId(value: string | undefined): string | undefined {
  if (!value) return undefined
  const match = value.replace(/-/g, "").match(/[0-9a-f]{32}/i)
  if (!match) return undefined
  return match[0].toLowerCase()
}

function readType(block: unknown): string | undefined {
  return isRecord(block) && typeof block.type === "string" ? block.type : undefined
}

function blockId(block: unknown): string | undefined {
  return isRecord(block) && typeof block.id === "string" ? block.id : undefined
}

function blockParentId(block: unknown): string | undefined {
  if (!isRecord(block) || !isRecord(block.parent)) return undefined
  if (typeof block.parent.block_id === "string") return block.parent.block_id
  if (typeof block.parent.page_id === "string") return block.parent.page_id
  return undefined
}

function blockPlainText(block: unknown): string {
  const type = readType(block)
  if (!type || !isRecord(block)) return ""
  const value = block[type]
  if (!isRecord(value)) return ""
  const richText = value.rich_text
  if (Array.isArray(richText)) return richText.map(richTextPlainText).join("")
  return ""
}

function blockCells(block: unknown): string[] {
  if (readType(block) !== "table_row" || !isRecord(block)) return []
  const tableRow = block.table_row
  if (!isRecord(tableRow) || !Array.isArray(tableRow.cells)) return []
  return tableRow.cells.map((cell) => {
    if (!Array.isArray(cell)) return ""
    return cell.map(richTextPlainText).join("").trim()
  })
}

function firstPageReference(block: unknown): string | undefined {
  const tableCells = tableRowRichTextCells(block)
  for (const cell of tableCells) {
    const reference = firstRichTextPageReference(cell)
    if (reference) return reference
  }

  const type = readType(block)
  if (!type || !isRecord(block)) return undefined
  const value = block[type]
  if (!isRecord(value) || !Array.isArray(value.rich_text)) return undefined
  return firstRichTextPageReference(value.rich_text)
}

function tableRowRichTextCells(block: unknown): unknown[][] {
  if (readType(block) !== "table_row" || !isRecord(block)) return []
  const tableRow = block.table_row
  if (!isRecord(tableRow) || !Array.isArray(tableRow.cells)) return []
  return tableRow.cells.filter((cell): cell is unknown[] => Array.isArray(cell))
}

function firstRichTextPageReference(richText: unknown[]): string | undefined {
  for (const item of richText) {
    if (!isRecord(item)) continue
    if (typeof item.href === "string") return item.href
    if (isRecord(item.mention) && isRecord(item.mention.page) && typeof item.mention.page.id === "string") {
      return item.mention.page.id
    }
  }
  return undefined
}

function richTextPlainText(item: unknown): string {
  return isRecord(item) && typeof item.plain_text === "string" ? item.plain_text : ""
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object"
}
