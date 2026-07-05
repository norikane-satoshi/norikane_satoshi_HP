import { inspectHostedWorkerChrome } from "@/lib/chatbot/hosted-worker/ensure-chrome"
import {
  hostedWorkerTier,
  type HostedWorkerHealthResponse,
  type HostedWorkerQueueState,
} from "@/lib/chatbot/hosted-worker/types"

export type HostedWorkerRuntimeState = {
  queue: HostedWorkerQueueState
  lastReadyHealth?: HostedWorkerHealthResponse
}

export function createHostedWorkerRuntimeState(): HostedWorkerRuntimeState {
  return {
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
    healthMode: "quick",
    checkedAt: new Date().toISOString(),
  }
}
