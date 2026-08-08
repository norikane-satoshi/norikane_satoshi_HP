import { inspectHostedWorkerChrome } from "@/lib/chatbot/hosted-worker/ensure-chrome"
import {
  resolveEffectiveNotionAiThreadUrl,
  toNotionAiThreadId,
} from "@/lib/chatbot/hosted-worker/notion-ai-thread-store"
import {
  hostedWorkerTier,
  type HostedWorkerHealthResponse,
  type HostedWorkerQueueState,
} from "@/lib/chatbot/hosted-worker/types"

/** What the worker rotated to, so an operator can see an autonomous thread change from /health. */
export type HostedWorkerThreadRotationState = {
  threadId: string
  rotatedAt: string
  previousThreadId?: string
  rotationCount: number
  retried: boolean
  reason: "capacity-rotation" | "conversation-provisioned"
}

export type HostedWorkerRuntimeState = {
  workerStartedAtEpochMs: number
  queue: HostedWorkerQueueState
  lastReadyHealth?: HostedWorkerHealthResponse
  threadRotation?: HostedWorkerThreadRotationState
}

export function createHostedWorkerRuntimeState(): HostedWorkerRuntimeState {
  return {
    workerStartedAtEpochMs: Math.round(Date.now() - process.uptime() * 1000),
    queue: {
      inFlight: false,
      queueLength: 0,
    },
  }
}

export async function getHostedWorkerHealth(
  state: HostedWorkerRuntimeState,
): Promise<HostedWorkerHealthResponse> {
  const chrome = await inspectHostedWorkerChrome()
  const response = {
    ...chrome,
    tier: hostedWorkerTier,
    queue: { ...state.queue },
    notionThread: buildNotionThreadHealth(state),
    healthMode: "deep" as const,
    checkedAt: new Date().toISOString(),
  }

  if (response.ok) state.lastReadyHealth = response

  return response
}

export function getHostedWorkerQuickHealth(
  state: HostedWorkerRuntimeState,
): HostedWorkerHealthResponse {
  const cached = state.lastReadyHealth

  return {
    ok: true,
    status: "ready",
    action: "none",
    cdp: cached?.cdp ?? {
      baseUrl: process.env.CHATBOT_HOSTED_WORKER_CDP_BASE_URL ?? "http://127.0.0.1:9223",
      reachable: true,
    },
    notionTarget: cached?.notionTarget ?? {
      found: false,
      loginRedirect: false,
      targetUrlMatches: false,
    },
    notionAiModelSelection: cached?.notionAiModelSelection,
    targetCount: cached?.targetCount,
    tier: hostedWorkerTier,
    queue: { ...state.queue },
    notionThread: buildNotionThreadHealth(state),
    healthMode: "quick",
    checkedAt: new Date().toISOString(),
  }
}

function buildNotionThreadHealth(state: HostedWorkerRuntimeState): HostedWorkerHealthResponse["notionThread"] {
  const resolved = resolveEffectiveNotionAiThreadUrl()
  return {
    threadId: toNotionAiThreadId(resolved.threadUrl),
    source: resolved.source,
    ...(state.threadRotation ? { rotation: state.threadRotation } : {}),
  }
}
