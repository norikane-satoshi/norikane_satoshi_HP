import { NextResponse } from "next/server"

type ChatbotOperation = "message" | "submit-inquiry" | "create-booking-from-chat"

type ChatbotFailureStage =
  | "request-parse"
  | "server-handler"
  | "conversation-load"
  | "conversation-save"
  | "tier-orchestrator"
  | "booking-save"
  | "notification-send"

type ChatbotOperationFailureInput = {
  operation: ChatbotOperation
  stage: ChatbotFailureStage
  error: unknown
  requestId?: string
  status?: number
  requestSummary?: Record<string, unknown>
}

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const code = errorCode(error)
    return {
      name: error.name,
      ...(code ? { code } : {}),
    }
  }

  return { name: typeof error }
}

function errorCode(error: Error): string | undefined {
  const value = "code" in error ? (error as Error & { code?: unknown }).code : undefined
  return typeof value === "string" && /^[a-z0-9][a-z0-9_.:-]{0,119}$/i.test(value) ? value : undefined
}

function sanitizeRequestSummary(value: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "boolean" || typeof entry === "number") {
      output[key] = entry
      continue
    }
    if (
      typeof entry === "string" &&
      /(?:kind|status|stage|code|reason|dbWrite|pendingRequestKind|routingDecisionKind|uiKind)$/i.test(key) &&
      /^[a-z0-9][a-z0-9_.:-]{0,119}$/i.test(entry)
    ) {
      output[key] = entry
      continue
    }
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      const nested = sanitizeRequestSummary(entry as Record<string, unknown>)
      if (Object.keys(nested).length > 0) output[key] = nested
    }
  }
  return output
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500
}

export function logChatbotOperationFailure(input: ChatbotOperationFailureInput): void {
  const status = input.status ?? 500
  console.error(
    "[CHATBOT_OPERATION_FAILURE]",
    JSON.stringify({
      event: "chatbot_operation_failure",
      requestId: input.requestId,
      operation: input.operation,
      stage: input.stage,
      status,
      retryable: isRetryableStatus(status),
      fallback: "tier3-inquiry-form",
      requestSummary: sanitizeRequestSummary(input.requestSummary ?? {}),
      error: serializeError(input.error),
    }),
  )
}

export function respondChatbotOperationFailure(input: ChatbotOperationFailureInput): NextResponse {
  const status = input.status ?? 500
  logChatbotOperationFailure({ ...input, status })
  return NextResponse.json(
    {
      error: "chatbot_operation_failed",
      requestId: input.requestId,
      operation: input.operation,
      failure: {
        stage: input.stage,
        retryable: isRetryableStatus(status),
        fallback: "tier3-inquiry-form",
      },
    },
    { status },
  )
}
