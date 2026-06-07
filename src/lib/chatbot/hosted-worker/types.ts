import type {
  ChatbotLlmError,
  ChatbotLlmRequest,
  ChatbotLlmResponse,
} from "@/lib/chatbot/server/llm-client"

export const hostedWorkerTier = "tier-2-hosted-chrome-notion-ai" as const

export type HostedWorkerQueueState = {
  inFlight: boolean
  queueLength: number
  lastSuccessAt?: string
  lastErrorCode?: ChatbotLlmError["code"] | HostedWorkerEnsureStatus | "missing_token"
  lastLatencyMs?: number
}

export type HostedWorkerChromeConfig = {
  cdpBaseUrl: string
  targetUrlIncludes: string
  preferredModel: string
  chromeProfileDir: string
  chromeCommand?: string
  chromeApp?: string
  waitMs: number
}

export type HostedWorkerEnsureStatus =
  | "ready"
  | "cdp_connection_refused"
  | "target_missing"
  | "manual_login_required"
  | "model_unavailable"
  | "target_url_mismatch"
  | "unknown"

export type HostedWorkerCdpTargetSummary = {
  id?: string
  type?: string
  title?: string
  url?: string
}

export type HostedWorkerEnsureResult = {
  ok: boolean
  status: HostedWorkerEnsureStatus
  action: "none" | "started_chrome" | "opened_target" | "manual_pending"
  cdp: {
    baseUrl: string
    reachable: boolean
    browser?: string
  }
  notionTarget: {
    found: boolean
    loginRedirect: boolean
    targetUrlMatches: boolean
    target?: HostedWorkerCdpTargetSummary
  }
  preferredModel: {
    name: string
    available?: boolean
    selectedModel?: string
    finalModelName?: string
  }
  targetCount?: number
  errorCode?: HostedWorkerEnsureStatus
}

export type HostedWorkerHealthResponse = HostedWorkerEnsureResult & {
  tier: typeof hostedWorkerTier
  queue: HostedWorkerQueueState
}

export type HostedWorkerGenerateRequest = ChatbotLlmRequest

export type HostedWorkerGenerateResponse = ChatbotLlmResponse & {
  tier: typeof hostedWorkerTier
}

export type HostedWorkerErrorResponse = {
  ok: false
  tier: typeof hostedWorkerTier
  error: {
    code: ChatbotLlmError["code"] | HostedWorkerEnsureStatus | "missing_token" | "not_found" | "method_not_allowed"
    message: string
    retryable: boolean
  }
}
