export const notionAiThreadRetentionDays = 30
export const notionAiThreadLifecycleMarker = "thread-lifecycle-v1"

export type NotionAiThreadLifecycleAction = "inspect" | "hide-and-verify" | "verify"

export type NotionAiThreadLifecycleInput = {
  action: NotionAiThreadLifecycleAction
  spaceId: string
  userId: string
  threadId: string
  notionClientVersion?: string
  retentionDays?: number
  verifyAttempts?: number
  verifyDelayMs?: number
}

export type NotionAiThreadLifecycleStage =
  | "inspected"
  | "record-missing"
  | "hide-write"
  | "read-record"
  | "verify-record"
  | "verify-chat-list"
  | "verified"
  | "exception"

export type NotionAiThreadLifecycleResult = {
  ok: boolean
  stage: NotionAiThreadLifecycleStage
  recordExists: boolean
  threadRecordMissing: boolean
  alive?: boolean
  deletedAt?: string
  estimatedRetentionDeadline?: string
  hiddenFromChatList?: boolean
  retryable: boolean
  httpStatus?: number
  errorCode?: string
}

export function estimateNotionAiRetentionDeadline(
  deletedAt: string | undefined,
  retentionDays: number = notionAiThreadRetentionDays,
): string | undefined {
  if (!deletedAt) return undefined
  const deletedAtMs = Date.parse(deletedAt)
  if (!Number.isFinite(deletedAtMs)) return undefined
  const safeRetentionDays = Number.isFinite(retentionDays) && retentionDays > 0
    ? Math.trunc(retentionDays)
    : notionAiThreadRetentionDays
  return new Date(deletedAtMs + safeRetentionDays * 86_400_000).toISOString()
}

export function isNotionAiRetentionPurgeEligible(input: {
  deletedAt?: string
  observedAt: string | number | Date
  retentionDays?: number
}): boolean {
  const deadline = estimateNotionAiRetentionDeadline(input.deletedAt, input.retentionDays)
  if (!deadline) return false
  const observedAtMs = input.observedAt instanceof Date
    ? input.observedAt.getTime()
    : typeof input.observedAt === "number"
      ? input.observedAt
      : Date.parse(input.observedAt)
  return Number.isFinite(observedAtMs) && observedAtMs >= Date.parse(deadline)
}

/**
 * Runs inside the authenticated Notion page. Keep this function self-contained because the hosted
 * worker serializes it with toString() and evaluates the result through CDP.
 */
export async function executeNotionAiThreadLifecycleInPage(
  input: NotionAiThreadLifecycleInput,
): Promise<NotionAiThreadLifecycleResult> {
  const defaultRetentionDays = 30
  const defaultVerifyAttempts = 5
  const defaultVerifyDelayMs = 250
  const normalizeId = (value: unknown): string | undefined => {
    if (typeof value !== "string") return undefined
    const normalized = value.replaceAll("-", "").toLowerCase()
    return /^[0-9a-f]{32}$/.test(normalized) ? normalized : undefined
  }
  const normalizedThreadId = normalizeId(input.threadId)
  const threadRecordId = normalizedThreadId?.replace(
    /^(........)(....)(....)(....)(............)$/,
    "$1-$2-$3-$4-$5",
  )
  const retentionDays = Number.isFinite(input.retentionDays) && Number(input.retentionDays) > 0
    ? Math.trunc(Number(input.retentionDays))
    : defaultRetentionDays
  const verifyAttempts = Number.isFinite(input.verifyAttempts) && Number(input.verifyAttempts) > 0
    ? Math.trunc(Number(input.verifyAttempts))
    : defaultVerifyAttempts
  const verifyDelayMs = Number.isFinite(input.verifyDelayMs) && Number(input.verifyDelayMs) >= 0
    ? Math.trunc(Number(input.verifyDelayMs))
    : defaultVerifyDelayMs
  const result = (
    values: Partial<NotionAiThreadLifecycleResult> & Pick<NotionAiThreadLifecycleResult, "ok" | "stage">,
  ): NotionAiThreadLifecycleResult => ({
    recordExists: false,
    threadRecordMissing: false,
    retryable: false,
    ...values,
  })

  if (!normalizedThreadId || !threadRecordId || !normalizeId(input.spaceId) || !normalizeId(input.userId)) {
    return result({ ok: false, stage: "exception", errorCode: "invalid-lifecycle-identity" })
  }

  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/json",
    "notion-audit-log-platform": "web",
    "x-notion-active-user-header": input.userId,
    "x-notion-space-id": input.spaceId,
    ...(input.notionClientVersion
      ? { "notion-client-version": input.notionClientVersion }
      : {}),
  }
  const postJson = async (path: string, body: unknown): Promise<{
    ok: boolean
    status: number
    json?: unknown
  }> => {
    const response = await fetch(path, {
      method: "POST",
      credentials: "include",
      headers,
      body: JSON.stringify(body),
    })
    const text = await response.text()
    let json: unknown
    try {
      json = text ? JSON.parse(text) : undefined
    } catch {
      json = undefined
    }
    return { ok: response.ok, status: response.status, json }
  }
  const asRecord = (value: unknown): Record<string, unknown> | undefined =>
    value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : undefined
  const readNestedRecord = (
    record: Record<string, unknown> | undefined,
    key: string,
  ): Record<string, unknown> | undefined => asRecord(record?.[key])
  const readTimestamp = (value: unknown): string | undefined => {
    const timestampMs = typeof value === "number"
      ? value
      : typeof value === "string"
        ? Date.parse(value)
        : Number.NaN
    if (!Number.isFinite(timestampMs)) return undefined
    try {
      return new Date(timestampMs).toISOString()
    } catch {
      return undefined
    }
  }
  const findThreadEntry = (json: unknown): Record<string, unknown> | undefined => {
    const recordMap = readNestedRecord(asRecord(json), "recordMap")
    const threadTable = readNestedRecord(recordMap, "thread")
    if (!threadTable) return undefined
    for (const [key, value] of Object.entries(threadTable)) {
      if (normalizeId(key) !== normalizedThreadId) continue
      return asRecord(value)
    }
    return undefined
  }
  const readThreadRecord = async (): Promise<
    | { ok: false; status: number }
    | { ok: true; recordExists: false }
    | { ok: true; recordExists: true; alive?: boolean; deletedAt?: string }
  > => {
    const response = await postJson("/api/v3/syncRecordValuesSpaceInitial", {
      requests: [
        {
          pointer: { table: "thread", id: threadRecordId, spaceId: input.spaceId },
          version: -1,
        },
      ],
    })
    if (!response.ok) return { ok: false, status: response.status }
    const entry = findThreadEntry(response.json)
    const wrappedValue = readNestedRecord(entry, "value")
    const value = readNestedRecord(wrappedValue, "value")
    if (!value) return { ok: true, recordExists: false }
    const data = readNestedRecord(value, "data")
    const deletedAtValue = value.deleted_time ?? data?.deleted_time
    const deletedAt = readTimestamp(deletedAtValue)
    return {
      ok: true,
      recordExists: true,
      ...(typeof value.alive === "boolean" ? { alive: value.alive } : {}),
      ...(deletedAt ? { deletedAt } : {}),
    }
  }
  const readChatListPresence = async (): Promise<
    | { ok: false; status: number }
    | { ok: true; hiddenFromChatList: boolean }
  > => {
    const response = await postJson("/api/v3/getInferenceTranscriptsForUser", {
      includeWriterChats: true,
      includeWorkflowThreads: true,
      limit: 100,
      threadParentPointer: { table: "space", id: input.spaceId, spaceId: input.spaceId },
    })
    if (!response.ok) return { ok: false, status: response.status }
    const json = asRecord(response.json)
    const candidates: unknown[] = [
      ...(Array.isArray(json?.threadIds) ? json.threadIds : []),
      ...(Array.isArray(json?.transcripts)
        ? json.transcripts.flatMap((entry) => {
            const transcript = asRecord(entry)
            return [transcript?.id, transcript?.threadId]
          })
        : []),
    ]
    return {
      ok: true,
      hiddenFromChatList: !candidates.some((value) => normalizeId(value) === normalizedThreadId),
    }
  }
  const estimatedDeadline = (deletedAt: string | undefined): string | undefined => {
    if (!deletedAt) return undefined
    const deletedAtMs = Date.parse(deletedAt)
    if (!Number.isFinite(deletedAtMs)) return undefined
    return new Date(deletedAtMs + retentionDays * 86_400_000).toISOString()
  }
  const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

  try {
    if (input.action === "hide-and-verify") {
      const randomUuid = (): string => crypto.randomUUID()
      const hideResponse = await postJson("/api/v3/saveTransactionsFanout", {
        requestId: randomUuid(),
        transactions: [
          {
            id: randomUuid(),
            spaceId: input.spaceId,
            debug: { userAction: "agentPersistenceActions.archiveInferenceThread" },
            operations: [
              {
                pointer: { table: "thread", id: threadRecordId, spaceId: input.spaceId },
                path: ["alive"],
                command: "set",
                args: false,
              },
            ],
          },
        ],
      })
      if (!hideResponse.ok) {
        return result({
          ok: false,
          stage: "hide-write",
          recordExists: true,
          retryable: hideResponse.status >= 500 || hideResponse.status === 429,
          httpStatus: hideResponse.status,
          errorCode: "notion-thread-hide-write-failed",
        })
      }
    }

    let latestRecord: Awaited<ReturnType<typeof readThreadRecord>> | undefined
    for (let attempt = 1; attempt <= (input.action === "inspect" ? 1 : verifyAttempts); attempt += 1) {
      latestRecord = await readThreadRecord()
      if (!latestRecord.ok) {
        return result({
          ok: false,
          stage: "read-record",
          retryable: latestRecord.status >= 500 || latestRecord.status === 429,
          httpStatus: latestRecord.status,
          errorCode: "notion-thread-record-read-failed",
        })
      }
      if (!latestRecord.recordExists) {
        return result({
          ok: true,
          stage: "record-missing",
          recordExists: false,
          threadRecordMissing: true,
        })
      }
      if (input.action === "inspect" || (latestRecord.alive === false && latestRecord.deletedAt)) break
      if (attempt < verifyAttempts && verifyDelayMs > 0) await delay(verifyDelayMs)
    }

    if (!latestRecord?.ok || !latestRecord.recordExists) {
      return result({ ok: false, stage: "read-record", retryable: true, errorCode: "notion-thread-record-unavailable" })
    }
    const recordMetadata = {
      recordExists: true,
      threadRecordMissing: false,
      alive: latestRecord.alive,
      deletedAt: latestRecord.deletedAt,
      estimatedRetentionDeadline: estimatedDeadline(latestRecord.deletedAt),
    }
    if (input.action === "inspect") {
      return result({ ok: true, stage: "inspected", ...recordMetadata })
    }

    const chatList = await readChatListPresence()
    if (!chatList.ok) {
      return result({
        ok: false,
        stage: "verify-chat-list",
        ...recordMetadata,
        retryable: chatList.status >= 500 || chatList.status === 429,
        httpStatus: chatList.status,
        errorCode: "notion-thread-chat-list-read-failed",
      })
    }
    if (latestRecord.alive !== false || !latestRecord.deletedAt) {
      return result({
        ok: false,
        stage: "verify-record",
        ...recordMetadata,
        hiddenFromChatList: chatList.hiddenFromChatList,
        retryable: true,
        errorCode: "notion-thread-hide-record-not-settled",
      })
    }
    if (!chatList.hiddenFromChatList) {
      return result({
        ok: false,
        stage: "verify-chat-list",
        ...recordMetadata,
        hiddenFromChatList: false,
        retryable: true,
        errorCode: "notion-thread-still-in-chat-list",
      })
    }
    return result({
      ok: true,
      stage: "verified",
      ...recordMetadata,
      hiddenFromChatList: true,
    })
  } catch {
    return result({
      ok: false,
      stage: "exception",
      retryable: true,
      errorCode: "notion-thread-lifecycle-exception",
    })
  }
}

export function buildNotionAiThreadLifecycleExpression(input: NotionAiThreadLifecycleInput): string {
  return `(() => { const __name = (target) => target; const __notionAiChatbotThreadLifecycle = ${JSON.stringify(notionAiThreadLifecycleMarker)}; void __notionAiChatbotThreadLifecycle; return (${executeNotionAiThreadLifecycleInPage.toString()})(${JSON.stringify(input)}); })()`
}
