import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"

import { getNotionAiChatbotThreadUrl } from "@/lib/chatbot/hosted-worker/notion-ai-config"

/**
 * Where the worker remembers the Notion AI thread it rotated to.
 *
 * Notion persists every turn into the thread the worker posts from, so the thread grows until it
 * hits Notion's storage limit and answers "Column size exceeded". The worker rotates to a fresh
 * thread when that happens, and the new id has to outlive the request that minted it — otherwise a
 * restart would send the worker straight back to the exhausted thread.
 */
export type NotionAiThreadRotationRecord = {
  threadUrl: string
  threadId: string
  rotatedAt: string
  previousThreadUrl?: string
  previousThreadId?: string
  rotationCount: number
}

const stateDir = path.join(homedir(), ".local", "state", "norikane_satoshi_hp")

export const notionAiThreadStatePath = path.join(stateDir, "hosted-worker-notion-thread.json")

let cachedRotation: NotionAiThreadRotationRecord | undefined

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined
}

function toRotationRecord(parsed: Partial<NotionAiThreadRotationRecord>): NotionAiThreadRotationRecord | undefined {
  const threadUrl = stringOrUndefined(parsed.threadUrl)
  const threadId = stringOrUndefined(parsed.threadId)
  const rotatedAt = stringOrUndefined(parsed.rotatedAt)
  if (!threadUrl || !threadId || !rotatedAt) return undefined

  return {
    threadUrl,
    threadId,
    rotatedAt,
    previousThreadUrl: stringOrUndefined(parsed.previousThreadUrl),
    previousThreadId: stringOrUndefined(parsed.previousThreadId),
    rotationCount: Number.isFinite(parsed.rotationCount) ? Number(parsed.rotationCount) : 1,
  }
}

export async function readNotionAiThreadRotation(
  statePath: string = notionAiThreadStatePath,
): Promise<NotionAiThreadRotationRecord | undefined> {
  try {
    return toRotationRecord(JSON.parse(await readFile(statePath, "utf8")) as Partial<NotionAiThreadRotationRecord>)
  } catch {
    // A missing or corrupt record must never take the worker down; it just falls back to config.
    return undefined
  }
}

export async function writeNotionAiThreadRotation(
  record: NotionAiThreadRotationRecord,
  statePath: string = notionAiThreadStatePath,
): Promise<void> {
  await mkdir(path.dirname(statePath), { recursive: true })
  const temporaryPath = `${statePath}.tmp`
  await writeFile(temporaryPath, JSON.stringify(record, null, 2) + "\n", "utf8")
  await rename(temporaryPath, statePath)
  cachedRotation = record
}

/**
 * Loads the record once so the synchronous callers (Chrome config, health) can read it without
 * turning every path into a promise.
 */
export async function primeNotionAiThreadRotationCache(
  statePath: string = notionAiThreadStatePath,
): Promise<NotionAiThreadRotationRecord | undefined> {
  cachedRotation = await readNotionAiThreadRotation(statePath)
  return cachedRotation
}

export function getCachedNotionAiThreadRotation(): NotionAiThreadRotationRecord | undefined {
  return cachedRotation
}

export function resetNotionAiThreadRotationCache(): void {
  cachedRotation = undefined
}

export type NotionAiThreadUrlSource = "rotated" | "worker-env" | "thread-env" | "repo-default"

export function isNotionAiThreadRotationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CHATBOT_HOSTED_WORKER_THREAD_ROTATION !== "off"
}

/**
 * The rotated thread wins over configuration, because configuration is what pointed at the
 * exhausted thread in the first place. Turning rotation off with
 * `CHATBOT_HOSTED_WORKER_THREAD_ROTATION=off` also ignores the stored record, so one variable is
 * enough to put an operator back in control during an incident.
 */
export function resolveEffectiveNotionAiThreadUrl(
  input: { env?: NodeJS.ProcessEnv; rotation?: NotionAiThreadRotationRecord } = {},
): { threadUrl: string; source: NotionAiThreadUrlSource } {
  const env = input.env ?? process.env
  const rotation = input.rotation ?? getCachedNotionAiThreadRotation()

  if (rotation && isNotionAiThreadRotationEnabled(env)) {
    return { threadUrl: rotation.threadUrl, source: "rotated" }
  }

  const workerEnvUrl = stringOrUndefined(env.CHATBOT_HOSTED_WORKER_NOTION_THREAD_URL)
  if (workerEnvUrl) return { threadUrl: workerEnvUrl, source: "worker-env" }

  const threadEnvUrl = stringOrUndefined(env.NOTION_AI_CHATBOT_THREAD_URL)
  if (threadEnvUrl) return { threadUrl: threadEnvUrl, source: "thread-env" }

  return {
    threadUrl: getNotionAiChatbotThreadUrl({ NOTION_AI_CHATBOT_THREAD_URL: env.NOTION_AI_CHATBOT_THREAD_URL }),
    source: "repo-default",
  }
}

export function toNotionAiThreadId(threadUrl: string): string | undefined {
  try {
    const value = new URL(threadUrl.trim()).searchParams.get("t")
    if (!value) return undefined
    if (/^[0-9a-f]{32}$/i.test(value)) {
      return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`
    }
    return value
  } catch {
    return undefined
  }
}
