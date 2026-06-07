import { inspectHostedWorkerChrome } from "@/lib/chatbot/hosted-worker/ensure-chrome"
import { hostedWorkerTier, type HostedWorkerHealthResponse, type HostedWorkerQueueState } from "@/lib/chatbot/hosted-worker/types"

export type HostedWorkerRuntimeState = {
  queue: HostedWorkerQueueState
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

  return {
    ...chrome,
    tier: hostedWorkerTier,
    queue: { ...state.queue },
  }
}
