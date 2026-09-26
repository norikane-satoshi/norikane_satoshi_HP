import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"

import type { HostedWorkerRuntimeState } from "@/lib/chatbot/hosted-worker/health"
import { ChatbotLlmError } from "@/lib/chatbot/server/llm-client"

/**
 * Once Notion reports the AI allowance as spent, every customer request would still provision a
 * Notion thread (~30 s) that can never answer. The gate refuses those requests at once until the
 * allowance is seen to work again. The heartbeat smoke keeps probing, and each probe that still
 * fails renews the gate, so the window only has to outlast one heartbeat retry interval (30 min).
 */
export const notionAiUsageLimitMarker = "notion_ai_usage_limit_reached"
export const notionAiQuotaGateWindowMs = 45 * 60_000
export const heartbeatConversationId = "hosted-tier1-heartbeat"

type QuotaGateCause = { quotaGate: true }

export function isNotionAiUsageLimitError(error: ChatbotLlmError): boolean {
  return error.code === "rate-limit" && error.message.includes(notionAiUsageLimitMarker)
}

export function isQuotaGateRefusal(error: ChatbotLlmError): boolean {
  const cause = error.cause as Partial<QuotaGateCause> | undefined
  return Boolean(cause && typeof cause === "object" && cause.quotaGate === true)
}

export async function loadNotionAiQuotaState(state: HostedWorkerRuntimeState, statePath: string | undefined) {
  if (state.quotaStateLoaded) return
  state.quotaStateLoaded = true
  if (!statePath || state.runtime.notionAiQuotaExhaustedAt) return
  try {
    const parsed = JSON.parse(await readFile(statePath, "utf8")) as { exhaustedAt?: unknown }
    if (typeof parsed.exhaustedAt === "string" && Number.isFinite(Date.parse(parsed.exhaustedAt))) {
      state.runtime.notionAiQuotaExhaustedAt = parsed.exhaustedAt
    }
  } catch {
    // Missing or unreadable state means no known exhaustion; the next real failure records one.
  }
}

export function assertNotionAiQuotaGateOpen(input: {
  state: HostedWorkerRuntimeState
  conversationId: string
  nowMs: number
}): void {
  if (input.conversationId === heartbeatConversationId) return
  const exhaustedAt = input.state.runtime.notionAiQuotaExhaustedAt
  if (!exhaustedAt) return
  const elapsedMs = input.nowMs - Date.parse(exhaustedAt)
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0 || elapsedMs >= notionAiQuotaGateWindowMs) return
  throw new ChatbotLlmError({
    message: `Notion AI usage limit reached earlier; refusing without contacting Notion. ${notionAiUsageLimitMarker} quota_gate since=${exhaustedAt}`,
    code: "rate-limit",
    tier: "tier-1-hosted-chrome-notion-ai",
    isRetryable: false,
    cause: { quotaGate: true } satisfies QuotaGateCause,
  })
}

export async function recordNotionAiQuotaExhausted(
  state: HostedWorkerRuntimeState,
  at: string,
  statePath: string | undefined,
): Promise<void> {
  state.runtime.notionAiQuotaExhaustedAt = at
  await persist(statePath, { exhaustedAt: at })
}

export async function clearNotionAiQuotaExhausted(
  state: HostedWorkerRuntimeState,
  statePath: string | undefined,
): Promise<void> {
  if (!state.runtime.notionAiQuotaExhaustedAt) return
  delete state.runtime.notionAiQuotaExhaustedAt
  await persist(statePath, {})
}

async function persist(statePath: string | undefined, value: { exhaustedAt?: string }) {
  if (!statePath) return
  try {
    await mkdir(path.dirname(statePath), { recursive: true })
    const temporary = `${statePath}.${process.pid}.tmp`
    await writeFile(temporary, JSON.stringify(value), { mode: 0o600 })
    await rename(temporary, statePath)
  } catch {
    // The in-memory gate still works; persistence only covers a worker restart.
  }
}
