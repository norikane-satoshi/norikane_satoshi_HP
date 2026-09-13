import { createHash } from "node:crypto"

import type { Prisma } from "@prisma/client"

import { prisma } from "@/lib/prisma"

export type ChatbotMessageRequestStatus = "processing" | "completed" | "failed"

export type ChatbotMessageRequestRecord = {
  key: string
  conversationId: string
  payloadHash: string
  status: ChatbotMessageRequestStatus
  owner: string | null
  leaseExpiresAt: Date | null
  resultJson: string | null
  version: number
  conversationVersion: number
}

export type ChatbotMessageRequestSnapshot = {
  conversationId: string
  conversationSessionId: string
  activeKey: string | null
  activeOwner: string | null
  activeLeaseExpiresAt: Date | null
  lockVersion: number
  request: ChatbotMessageRequestRecord | null
}

export type ChatbotMessageRequestStore = {
  load(input: {
    sessionId: string
    userId?: string | null
    requestKey: string
    recoverRequestKey?: string
  }): Promise<ChatbotMessageRequestSnapshot>
  claimNew(input: {
    snapshot: ChatbotMessageRequestSnapshot
    requestKey: string
    payloadHash: string
    owner: string
    leaseExpiresAt: Date
  }): Promise<boolean>
  reclaim(input: {
    snapshot: ChatbotMessageRequestSnapshot
    request: ChatbotMessageRequestRecord
    owner: string
    leaseExpiresAt: Date
  }): Promise<boolean>
  complete(input: {
    conversationId: string
    requestKey: string
    owner: string
    requestVersion: number
    resultJson: string
  }): Promise<boolean>
  fail(input: {
    conversationId: string
    requestKey: string
    owner: string
    requestVersion: number
  }): Promise<boolean>
}

type StoredResult<T> = { requestId: string; result: T }

export type ChatbotMessageRequestOwnership = {
  conversationId: string
  requestKey: string
  owner: string
  requestVersion: number
}

export type CoordinateChatbotMessageRequestInput<T> = {
  sessionId: string
  userId?: string | null
  requestId: string
  requestKey?: string
  recoverRequestKey?: string
  payloadHash: string
  execute: (ownership?: ChatbotMessageRequestOwnership) => Promise<T>
  completeDuringExecute?: boolean
  store?: ChatbotMessageRequestStore
  now?: () => Date
  sleep?: (milliseconds: number) => Promise<void>
  leaseDurationMs?: number
  waitTimeoutMs?: number
  pollIntervalMs?: number
}

export type CoordinatedChatbotMessageResult<T> = StoredResult<T> & { replayed: boolean }

export class ChatbotMessageCoordinationError extends Error {
  readonly code: string
  readonly status: number
  readonly chatbotFailureStage = "conversation-save" as const
  readonly chatbotFailureSummary: Record<string, unknown>

  constructor(code: string, status: number) {
    super(code)
    this.name = "ChatbotMessageCoordinationError"
    this.code = code
    this.status = status
    this.chatbotFailureSummary = { coordinationCode: code }
  }
}

const defaultLeaseDurationMs = 180_000
const defaultWaitTimeoutMs = 110_000
const defaultPollIntervalMs = 200

export function hashChatbotMessagePayload(input: unknown): string {
  return createHash("sha256").update(stableStringify(input)).digest("hex")
}

export async function coordinateChatbotMessageRequest<T>(
  input: CoordinateChatbotMessageRequestInput<T>,
): Promise<CoordinatedChatbotMessageResult<T>> {
  if (!input.requestKey) {
    return { requestId: input.requestId, result: await input.execute(), replayed: false }
  }

  const store = input.store ?? prismaChatbotMessageRequestStore
  const now = input.now ?? (() => new Date())
  const sleep = input.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
  const leaseDurationMs = input.leaseDurationMs ?? defaultLeaseDurationMs
  const waitDeadline = now().getTime() + (input.waitTimeoutMs ?? defaultWaitTimeoutMs)
  const pollIntervalMs = input.pollIntervalMs ?? defaultPollIntervalMs

  while (true) {
    const snapshot = await store.load({
      sessionId: input.sessionId,
      userId: input.userId,
      requestKey: input.requestKey,
      recoverRequestKey: input.recoverRequestKey,
    })
    const request = snapshot.request

    if (input.recoverRequestKey && !request && input.recoverRequestKey !== input.requestKey) {
      throw new ChatbotMessageCoordinationError("chatbot_message_recovery_request_unknown", 409)
    }
    if (request && request.conversationId !== snapshot.conversationId) {
      throw new ChatbotMessageCoordinationError("chatbot_message_request_session_mismatch", 409)
    }
    if (request && request.payloadHash !== input.payloadHash) {
      throw new ChatbotMessageCoordinationError("chatbot_message_request_payload_mismatch", 409)
    }
    if (request?.status === "completed") {
      return { ...parseStoredResult<T>(request.resultJson), replayed: true }
    }
    if (request?.status === "failed" && !input.recoverRequestKey) {
      throw new ChatbotMessageCoordinationError("chatbot_message_request_previously_failed", 409)
    }
    if (
      request?.status === "failed" &&
      input.recoverRequestKey &&
      snapshot.lockVersion !== request.conversationVersion + 1
    ) {
      throw new ChatbotMessageCoordinationError("chatbot_message_recovery_request_stale", 409)
    }

    const currentTime = now().getTime()
    const activeLease =
      snapshot.activeKey !== null &&
      snapshot.activeLeaseExpiresAt !== null &&
      snapshot.activeLeaseExpiresAt.getTime() > currentTime

    if (request?.status === "processing" && activeLease) {
      await waitOrThrow({ currentTime, waitDeadline, sleep, pollIntervalMs })
      continue
    }
    if (!request && activeLease) {
      throw new ChatbotMessageCoordinationError("chatbot_message_previous_request_processing", 503)
    }
    if (!request && snapshot.activeKey) {
      throw new ChatbotMessageCoordinationError("chatbot_message_previous_request_expired", 503)
    }
    if (request?.status === "processing" && !input.recoverRequestKey) {
      throw new ChatbotMessageCoordinationError("chatbot_message_request_expired_requires_recovery", 503)
    }

    const leaseExpiresAt = new Date(currentTime + leaseDurationMs)
    const claimed = request
      ? await store.reclaim({ snapshot, request, owner: input.requestId, leaseExpiresAt })
      : await store.claimNew({
          snapshot,
          requestKey: input.requestKey,
          payloadHash: input.payloadHash,
          owner: input.requestId,
          leaseExpiresAt,
        })
    if (!claimed) continue

    const ownedRequestKey = request?.key ?? input.requestKey
    const ownedRequestVersion = (request?.version ?? 0) + 1
    try {
      const ownership = {
        conversationId: snapshot.conversationId,
        requestKey: ownedRequestKey,
        owner: input.requestId,
        requestVersion: ownedRequestVersion,
      }
      const result = await input.execute(ownership)
      if (input.completeDuringExecute) {
        const completedSnapshot = await store.load({
          sessionId: input.sessionId,
          userId: input.userId,
          requestKey: input.requestKey,
          recoverRequestKey: input.recoverRequestKey,
        })
        if (completedSnapshot.request?.status !== "completed") {
          throw new ChatbotMessageCoordinationError("chatbot_message_request_completion_missing", 500)
        }
        return { requestId: input.requestId, result, replayed: false }
      }
      const storedResult = { requestId: input.requestId, result }
      const completed = await store.complete({
        conversationId: snapshot.conversationId,
        requestKey: ownedRequestKey,
        owner: input.requestId,
        requestVersion: ownedRequestVersion,
        resultJson: JSON.stringify(storedResult),
      })
      if (!completed) {
        throw new ChatbotMessageCoordinationError("chatbot_message_request_completion_lost", 500)
      }
      return { ...storedResult, replayed: false }
    } catch (error) {
      if (input.completeDuringExecute) {
        const completedSnapshot = await store.load({
          sessionId: input.sessionId,
          userId: input.userId,
          requestKey: input.requestKey,
          recoverRequestKey: input.recoverRequestKey,
        }).catch(() => null)
        if (completedSnapshot?.request?.status === "completed") {
          return { ...parseStoredResult<T>(completedSnapshot.request.resultJson), replayed: true }
        }
      }
      await store.fail({
        conversationId: snapshot.conversationId,
        requestKey: ownedRequestKey,
        owner: input.requestId,
        requestVersion: ownedRequestVersion,
      }).catch(() => false)
      throw error
    }
  }
}

class CoordinationCasError extends Error {}

type LockRow = {
  sessionId: string
  activeMessageRequestKey: string | null
  activeMessageRequestOwner: string | null
  messageRequestLeaseExpiresAt: string | Date | null
  messageRequestVersion: number | bigint
}

type RequestRow = {
  key: string
  conversationId: string
  payloadHash: string
  status: string
  owner: string | null
  leaseExpiresAt: string | Date | null
  resultJson: string | null
  version: number | bigint
  conversationVersion: number | bigint
}

type OwnershipRow = {
  requestStatus: string
  requestOwner: string | null
  requestVersion: number | bigint
  activeMessageRequestKey: string | null
  activeMessageRequestOwner: string | null
}

export async function assertChatbotMessageRequestOwnership(
  input: ChatbotMessageRequestOwnership,
): Promise<void> {
  const rows = await prisma.$queryRawUnsafe<OwnershipRow[]>(
    `SELECT r."status" AS "requestStatus", r."owner" AS "requestOwner",
            r."version" AS "requestVersion", c."activeMessageRequestKey",
            c."activeMessageRequestOwner"
     FROM "ChatbotMessageRequest" r
     JOIN "ChatbotConversation" c ON c."id" = r."conversationId"
     WHERE r."key" = ? AND r."conversationId" = ? LIMIT 1`,
    input.requestKey,
    input.conversationId,
  )
  const row = rows[0]
  if (
    !row ||
    row.requestStatus !== "processing" ||
    row.requestOwner !== input.owner ||
    Number(row.requestVersion) !== input.requestVersion ||
    row.activeMessageRequestKey !== input.requestKey ||
    row.activeMessageRequestOwner !== input.owner
  ) {
    throw new ChatbotMessageCoordinationError("chatbot_message_request_ownership_lost", 409)
  }
}

export async function finalizeChatbotMessageRequest(input: {
  ownership: ChatbotMessageRequestOwnership
  resultJson: string
  persistBusinessData: (transaction: Prisma.TransactionClient) => Promise<void>
}): Promise<void> {
  const completed = await runCasTransaction(async (tx) => {
    const requestUpdated = await tx.$executeRawUnsafe(
      `UPDATE "ChatbotMessageRequest"
       SET "status" = 'completed', "owner" = NULL, "leaseExpiresAt" = NULL,
           "resultJson" = ?, "version" = "version" + 1, "updatedAt" = CURRENT_TIMESTAMP
       WHERE "key" = ? AND "conversationId" = ? AND "owner" = ?
         AND "version" = ? AND "status" = 'processing'`,
      input.resultJson,
      input.ownership.requestKey,
      input.ownership.conversationId,
      input.ownership.owner,
      input.ownership.requestVersion,
    )
    if (requestUpdated !== 1) throw new CoordinationCasError()
    await input.persistBusinessData(tx)
    const lockUpdated = await tx.$executeRawUnsafe(
      `UPDATE "ChatbotConversation"
       SET "activeMessageRequestKey" = NULL, "activeMessageRequestOwner" = NULL,
           "messageRequestLeaseExpiresAt" = NULL, "messageRequestVersion" = "messageRequestVersion" + 1
       WHERE "id" = ? AND "activeMessageRequestKey" = ? AND "activeMessageRequestOwner" = ?`,
      input.ownership.conversationId,
      input.ownership.requestKey,
      input.ownership.owner,
    )
    if (lockUpdated !== 1) throw new CoordinationCasError()
  })
  if (!completed) {
    throw new ChatbotMessageCoordinationError("chatbot_message_request_ownership_lost", 409)
  }
}

export const prismaChatbotMessageRequestStore: ChatbotMessageRequestStore = {
  async load(input) {
    const existingConversation = await prisma.chatbotConversation.findUnique({
      where: { sessionId: input.sessionId },
      select: { userId: true },
    })
    const effectiveSessionId =
      existingConversation?.userId && existingConversation.userId !== input.userId
        ? `${input.sessionId}:${input.userId ?? "anonymous"}`
        : input.sessionId
    const conversation = await prisma.chatbotConversation.upsert({
      where: { sessionId: effectiveSessionId },
      create: {
        sessionId: effectiveSessionId,
        userId: input.userId ?? null,
        routingDecision: "continue",
      },
      update: {},
      select: { id: true, sessionId: true },
    })
    const lockRows = await prisma.$queryRawUnsafe<LockRow[]>(
      `SELECT "sessionId", "activeMessageRequestKey", "activeMessageRequestOwner",
              "messageRequestLeaseExpiresAt", "messageRequestVersion"
       FROM "ChatbotConversation" WHERE "id" = ? LIMIT 1`,
      conversation.id,
    )
    const lookupKey = input.recoverRequestKey ?? input.requestKey
    const requestRows = await prisma.$queryRawUnsafe<RequestRow[]>(
      `SELECT "key", "conversationId", "payloadHash", "status", "owner",
              "leaseExpiresAt", "resultJson", "version", "conversationVersion"
       FROM "ChatbotMessageRequest" WHERE "key" = ? LIMIT 1`,
      lookupKey,
    )
    const lock = lockRows[0]
    if (!lock) throw new ChatbotMessageCoordinationError("chatbot_message_request_lock_missing", 500)
    return {
      conversationId: conversation.id,
      conversationSessionId: lock.sessionId,
      activeKey: lock.activeMessageRequestKey,
      activeOwner: lock.activeMessageRequestOwner,
      activeLeaseExpiresAt: toDate(lock.messageRequestLeaseExpiresAt),
      lockVersion: Number(lock.messageRequestVersion),
      request: requestRows[0] ? toRequestRecord(requestRows[0]) : null,
    }
  },

  async claimNew(input) {
    return runCasTransaction(async (tx) => {
      const lockUpdated = await tx.$executeRawUnsafe(
        `UPDATE "ChatbotConversation"
         SET "activeMessageRequestKey" = ?, "activeMessageRequestOwner" = ?,
             "messageRequestLeaseExpiresAt" = ?, "messageRequestVersion" = "messageRequestVersion" + 1
         WHERE "id" = ? AND "messageRequestVersion" = ? AND "activeMessageRequestKey" IS NULL`,
        input.requestKey,
        input.owner,
        input.leaseExpiresAt.toISOString(),
        input.snapshot.conversationId,
        input.snapshot.lockVersion,
      )
      if (lockUpdated !== 1) throw new CoordinationCasError()
      await tx.$executeRawUnsafe(
        `INSERT INTO "ChatbotMessageRequest"
          ("key", "conversationId", "payloadHash", "status", "owner", "leaseExpiresAt", "version", "conversationVersion", "createdAt", "updatedAt")
         VALUES (?, ?, ?, 'processing', ?, ?, 1, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        input.requestKey,
        input.snapshot.conversationId,
        input.payloadHash,
        input.owner,
        input.leaseExpiresAt.toISOString(),
        input.snapshot.lockVersion + 1,
      )
    })
  },

  async reclaim(input) {
    return runCasTransaction(async (tx) => {
      const lockUpdated = await tx.$executeRawUnsafe(
        `UPDATE "ChatbotConversation"
         SET "activeMessageRequestKey" = ?, "activeMessageRequestOwner" = ?,
             "messageRequestLeaseExpiresAt" = ?, "messageRequestVersion" = "messageRequestVersion" + 1
         WHERE "id" = ? AND "messageRequestVersion" = ?
           AND ("activeMessageRequestKey" IS NULL OR "activeMessageRequestKey" = ?)`,
        input.request.key,
        input.owner,
        input.leaseExpiresAt.toISOString(),
        input.snapshot.conversationId,
        input.snapshot.lockVersion,
        input.request.key,
      )
      if (lockUpdated !== 1) throw new CoordinationCasError()
      const requestUpdated = await tx.$executeRawUnsafe(
        `UPDATE "ChatbotMessageRequest"
         SET "status" = 'processing', "owner" = ?, "leaseExpiresAt" = ?,
             "resultJson" = NULL, "version" = "version" + 1, "conversationVersion" = ?,
             "updatedAt" = CURRENT_TIMESTAMP
         WHERE "key" = ? AND "conversationId" = ? AND "version" = ?
           AND "status" IN ('processing', 'failed')`,
        input.owner,
        input.leaseExpiresAt.toISOString(),
        input.snapshot.lockVersion + 1,
        input.request.key,
        input.snapshot.conversationId,
        input.request.version,
      )
      if (requestUpdated !== 1) throw new CoordinationCasError()
    })
  },

  async complete(input) {
    return runCasTransaction(async (tx) => {
      const requestUpdated = await tx.$executeRawUnsafe(
        `UPDATE "ChatbotMessageRequest"
         SET "status" = 'completed', "owner" = NULL, "leaseExpiresAt" = NULL,
             "resultJson" = ?, "version" = "version" + 1, "updatedAt" = CURRENT_TIMESTAMP
         WHERE "key" = ? AND "conversationId" = ? AND "owner" = ?
           AND "version" = ? AND "status" = 'processing'`,
        input.resultJson,
        input.requestKey,
        input.conversationId,
        input.owner,
        input.requestVersion,
      )
      if (requestUpdated !== 1) throw new CoordinationCasError()
      const lockUpdated = await tx.$executeRawUnsafe(
        `UPDATE "ChatbotConversation"
         SET "activeMessageRequestKey" = NULL, "activeMessageRequestOwner" = NULL,
             "messageRequestLeaseExpiresAt" = NULL, "messageRequestVersion" = "messageRequestVersion" + 1
         WHERE "id" = ? AND "activeMessageRequestKey" = ? AND "activeMessageRequestOwner" = ?`,
        input.conversationId,
        input.requestKey,
        input.owner,
      )
      if (lockUpdated !== 1) throw new CoordinationCasError()
    })
  },

  async fail(input) {
    return runCasTransaction(async (tx) => {
      const requestUpdated = await tx.$executeRawUnsafe(
        `UPDATE "ChatbotMessageRequest"
         SET "status" = 'failed', "owner" = NULL, "leaseExpiresAt" = NULL,
             "version" = "version" + 1, "updatedAt" = CURRENT_TIMESTAMP
         WHERE "key" = ? AND "conversationId" = ? AND "owner" = ?
           AND "version" = ? AND "status" = 'processing'`,
        input.requestKey,
        input.conversationId,
        input.owner,
        input.requestVersion,
      )
      if (requestUpdated !== 1) throw new CoordinationCasError()
      const lockUpdated = await tx.$executeRawUnsafe(
        `UPDATE "ChatbotConversation"
         SET "activeMessageRequestKey" = NULL, "activeMessageRequestOwner" = NULL,
             "messageRequestLeaseExpiresAt" = NULL, "messageRequestVersion" = "messageRequestVersion" + 1
         WHERE "id" = ? AND "activeMessageRequestKey" = ? AND "activeMessageRequestOwner" = ?`,
        input.conversationId,
        input.requestKey,
        input.owner,
      )
      if (lockUpdated !== 1) throw new CoordinationCasError()
    })
  },
}

async function runCasTransaction(
  operation: (transaction: Prisma.TransactionClient) => Promise<void>,
): Promise<boolean> {
  try {
    await prisma.$transaction(operation)
    return true
  } catch (error) {
    if (error instanceof CoordinationCasError || isUniqueConstraintError(error)) return false
    throw error
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  if (!(error && typeof error === "object")) return false
  if ("code" in error && error.code === "P2002") return true
  return error instanceof Error && /unique constraint/i.test(error.message)
}

async function waitOrThrow(input: {
  currentTime: number
  waitDeadline: number
  sleep: (milliseconds: number) => Promise<void>
  pollIntervalMs: number
}) {
  if (input.currentTime >= input.waitDeadline) {
    throw new ChatbotMessageCoordinationError("chatbot_message_request_still_processing", 503)
  }
  await input.sleep(input.pollIntervalMs)
}

function toRequestRecord(row: RequestRow): ChatbotMessageRequestRecord {
  const status = parseStatus(row.status)
  if (!status) throw new ChatbotMessageCoordinationError("chatbot_message_request_status_invalid", 500)
  return {
    key: row.key,
    conversationId: row.conversationId,
    payloadHash: row.payloadHash,
    status,
    owner: row.owner,
    leaseExpiresAt: toDate(row.leaseExpiresAt),
    resultJson: row.resultJson,
    version: Number(row.version),
    conversationVersion: Number(row.conversationVersion),
  }
}

function parseStatus(value: string): ChatbotMessageRequestStatus | null {
  return value === "processing" || value === "completed" || value === "failed" ? value : null
}

function toDate(value: string | Date | null): Date | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? date : null
}

function parseStoredResult<T>(value: string | null): StoredResult<T> {
  if (!value) throw new ChatbotMessageCoordinationError("chatbot_message_request_result_missing", 500)
  try {
    const parsed = JSON.parse(value) as Partial<StoredResult<T>>
    if (typeof parsed.requestId !== "string" || !("result" in parsed)) throw new Error("invalid result")
    return parsed as StoredResult<T>
  } catch {
    throw new ChatbotMessageCoordinationError("chatbot_message_request_result_invalid", 500)
  }
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined"
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`
}
