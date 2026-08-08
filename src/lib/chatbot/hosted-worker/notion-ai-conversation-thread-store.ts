import { createHash } from "node:crypto"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"

import { toNotionAiThreadId } from "@/lib/chatbot/hosted-worker/notion-ai-thread-store"
import { readNotionAiThreadIdFromUrl } from "@/lib/chatbot/hosted-worker/notion-ai-thread-rotation"

export type NotionAiConversationThreadRecord = {
  scopeHash: string
  threadUrl: string
  threadId: string
  createdAt: string
  updatedAt: string
  threadVersion: number
  visibilityStatus?: "pending-hide" | "hidden" | "hide-verification-failed" | "record-missing"
  alive?: boolean
  deletedAt?: string
  estimatedRetentionDeadline?: string
  hiddenFromChatList?: boolean
  hideAttemptCount?: number
  hideVerificationResult?: "verified" | "record-not-hidden" | "chat-list-present" | "api-failed"
  postHideInferenceVerified?: boolean
  threadRecordMissing?: boolean
  retentionPurgeDetected?: boolean
  threadReprovisioned?: boolean
  contextRebuiltFromHpDb?: boolean
}

export type NotionAiConversationThreadLifecycle = Pick<
  NotionAiConversationThreadRecord,
  | "visibilityStatus"
  | "alive"
  | "deletedAt"
  | "estimatedRetentionDeadline"
  | "hiddenFromChatList"
  | "hideAttemptCount"
  | "hideVerificationResult"
  | "postHideInferenceVerified"
  | "threadRecordMissing"
  | "retentionPurgeDetected"
  | "threadReprovisioned"
  | "contextRebuiltFromHpDb"
>

type NotionAiConversationThreadState = {
  version: 1
  records: Record<string, NotionAiConversationThreadRecord>
}

const stateDir = path.join(homedir(), ".local", "state", "norikane_satoshi_hp")
const maxRememberedConversationThreads = 1000

export const notionAiConversationThreadStatePath = path.join(
  stateDir,
  "hosted-worker-conversation-threads.json",
)

const stateCache = new Map<string, NotionAiConversationThreadState>()

function emptyState(): NotionAiConversationThreadState {
  return { version: 1, records: {} }
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined
}

function parseRecord(value: unknown): NotionAiConversationThreadRecord | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const parsed = value as Partial<NotionAiConversationThreadRecord>
  const scopeHash = stringOrUndefined(parsed.scopeHash)
  const threadUrl = stringOrUndefined(parsed.threadUrl)
  const threadId = stringOrUndefined(parsed.threadId)
  const createdAt = stringOrUndefined(parsed.createdAt)
  const updatedAt = stringOrUndefined(parsed.updatedAt)
  if (!scopeHash || !threadUrl || !threadId || !createdAt || !updatedAt) return undefined
  if (!readNotionAiThreadIdFromUrl(threadUrl)) return undefined

  const record: NotionAiConversationThreadRecord = {
    scopeHash,
    threadUrl,
    threadId,
    createdAt,
    updatedAt,
    threadVersion:
      Number.isInteger(parsed.threadVersion) && Number(parsed.threadVersion) > 0
        ? Number(parsed.threadVersion)
        : 1,
  }
  const visibilityStatus = parsed.visibilityStatus
  if (
    visibilityStatus === "pending-hide" ||
    visibilityStatus === "hidden" ||
    visibilityStatus === "hide-verification-failed" ||
    visibilityStatus === "record-missing"
  ) {
    record.visibilityStatus = visibilityStatus
  }
  if (typeof parsed.alive === "boolean") record.alive = parsed.alive
  if (isIsoTimestamp(parsed.deletedAt)) record.deletedAt = parsed.deletedAt
  if (isIsoTimestamp(parsed.estimatedRetentionDeadline)) {
    record.estimatedRetentionDeadline = parsed.estimatedRetentionDeadline
  }
  if (typeof parsed.hiddenFromChatList === "boolean") record.hiddenFromChatList = parsed.hiddenFromChatList
  if (Number.isInteger(parsed.hideAttemptCount) && Number(parsed.hideAttemptCount) >= 0) {
    record.hideAttemptCount = Number(parsed.hideAttemptCount)
  }
  if (
    parsed.hideVerificationResult === "verified" ||
    parsed.hideVerificationResult === "record-not-hidden" ||
    parsed.hideVerificationResult === "chat-list-present" ||
    parsed.hideVerificationResult === "api-failed"
  ) {
    record.hideVerificationResult = parsed.hideVerificationResult
  }
  for (const key of [
    "postHideInferenceVerified",
    "threadRecordMissing",
    "retentionPurgeDetected",
    "threadReprovisioned",
    "contextRebuiltFromHpDb",
  ] as const) {
    if (typeof parsed[key] === "boolean") record[key] = parsed[key]
  }
  return record
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
}

function parseState(value: unknown): NotionAiConversationThreadState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return emptyState()
  const records = (value as { records?: unknown }).records
  if (!records || typeof records !== "object" || Array.isArray(records)) return emptyState()

  const parsedRecords = Object.fromEntries(
    Object.entries(records)
      .map(([key, record]) => [key, parseRecord(record)] as const)
      .filter((entry): entry is readonly [string, NotionAiConversationThreadRecord] => Boolean(entry[1])),
  )
  return { version: 1, records: parsedRecords }
}

async function loadState(statePath: string): Promise<NotionAiConversationThreadState> {
  const cached = stateCache.get(statePath)
  if (cached) return cached

  let state = emptyState()
  try {
    state = parseState(JSON.parse(await readFile(statePath, "utf8")))
  } catch {
    // Missing or corrupt state starts empty. Isolation remains fail-closed because a fresh thread
    // is minted before the consultation can use Notion AI.
  }
  stateCache.set(statePath, state)
  return state
}

export function toNotionAiConversationScopeHash(conversationId: string): string {
  return createHash("sha256").update(conversationId).digest("hex")
}

export async function readNotionAiConversationThread(
  conversationId: string,
  statePath: string = notionAiConversationThreadStatePath,
): Promise<NotionAiConversationThreadRecord | undefined> {
  const state = await loadState(statePath)
  return state.records[toNotionAiConversationScopeHash(conversationId)]
}

export async function writeNotionAiConversationThread(
  input: {
    conversationId: string
    threadUrl: string
    now?: () => Date
    lifecycle?: NotionAiConversationThreadLifecycle
  },
  statePath: string = notionAiConversationThreadStatePath,
): Promise<NotionAiConversationThreadRecord> {
  const mintedThreadId = readNotionAiThreadIdFromUrl(input.threadUrl)
  const threadId = mintedThreadId ? toNotionAiThreadId(input.threadUrl) : undefined
  if (!threadId) throw new Error("Notion AI conversation thread URL does not contain a valid thread id.")

  const state = await loadState(statePath)
  const scopeHash = toNotionAiConversationScopeHash(input.conversationId)
  const previous = state.records[scopeHash]
  const sameThread = previous?.threadId === threadId
  const timestamp = (input.now?.() ?? new Date()).toISOString()
  const record: NotionAiConversationThreadRecord = {
    scopeHash,
    threadUrl: input.threadUrl,
    threadId,
    createdAt: sameThread ? previous.createdAt : timestamp,
    updatedAt: timestamp,
    threadVersion: previous && !sameThread ? previous.threadVersion + 1 : (previous?.threadVersion ?? 1),
    ...(sameThread ? pickLifecycle(previous) : {}),
    ...pickLifecycle(input.lifecycle),
  }

  const records = Object.fromEntries(
    Object.values({ ...state.records, [scopeHash]: record })
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, maxRememberedConversationThreads)
      .map((entry) => [entry.scopeHash, entry]),
  )
  const nextState: NotionAiConversationThreadState = { version: 1, records }

  await mkdir(path.dirname(statePath), { recursive: true })
  const temporaryPath = `${statePath}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(nextState, null, 2)}\n`, "utf8")
  await rename(temporaryPath, statePath)
  stateCache.set(statePath, nextState)
  return record
}

function pickLifecycle(
  value: NotionAiConversationThreadLifecycle | NotionAiConversationThreadRecord | undefined,
): NotionAiConversationThreadLifecycle {
  if (!value) return {}
  return {
    ...(value.visibilityStatus ? { visibilityStatus: value.visibilityStatus } : {}),
    ...(typeof value.alive === "boolean" ? { alive: value.alive } : {}),
    ...(value.deletedAt ? { deletedAt: value.deletedAt } : {}),
    ...(value.estimatedRetentionDeadline
      ? { estimatedRetentionDeadline: value.estimatedRetentionDeadline }
      : {}),
    ...(typeof value.hiddenFromChatList === "boolean"
      ? { hiddenFromChatList: value.hiddenFromChatList }
      : {}),
    ...(typeof value.hideAttemptCount === "number" ? { hideAttemptCount: value.hideAttemptCount } : {}),
    ...(value.hideVerificationResult ? { hideVerificationResult: value.hideVerificationResult } : {}),
    ...(typeof value.postHideInferenceVerified === "boolean"
      ? { postHideInferenceVerified: value.postHideInferenceVerified }
      : {}),
    ...(typeof value.threadRecordMissing === "boolean"
      ? { threadRecordMissing: value.threadRecordMissing }
      : {}),
    ...(typeof value.retentionPurgeDetected === "boolean"
      ? { retentionPurgeDetected: value.retentionPurgeDetected }
      : {}),
    ...(typeof value.threadReprovisioned === "boolean"
      ? { threadReprovisioned: value.threadReprovisioned }
      : {}),
    ...(typeof value.contextRebuiltFromHpDb === "boolean"
      ? { contextRebuiltFromHpDb: value.contextRebuiltFromHpDb }
      : {}),
  }
}

export function resetNotionAiConversationThreadCache(statePath?: string): void {
  if (statePath) {
    stateCache.delete(statePath)
    return
  }
  stateCache.clear()
}
