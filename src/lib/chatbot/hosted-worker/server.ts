import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"

import { authorizeHostedWorkerRequest } from "@/lib/chatbot/hosted-worker/auth"
import { ensureHostedWorkerChrome } from "@/lib/chatbot/hosted-worker/ensure-chrome"
import {
  createHostedWorkerRuntimeState,
  getHostedWorkerHealth,
  type HostedWorkerRuntimeState,
} from "@/lib/chatbot/hosted-worker/health"
import {
  createHostedWorkerQueue,
  generateHostedWorkerResponse,
  type HostedWorkerSingleFlightQueue,
} from "@/lib/chatbot/hosted-worker/generate"
import {
  hostedWorkerTier,
  type HostedWorkerErrorResponse,
  type HostedWorkerGenerateRequest,
} from "@/lib/chatbot/hosted-worker/types"
import { ChatbotLlmError } from "@/lib/chatbot/server/llm-client"

type HostedWorkerHandlerOptions = {
  token?: string
  state?: HostedWorkerRuntimeState
  queue?: HostedWorkerSingleFlightQueue
  health?: typeof getHostedWorkerHealth
  ensureChrome?: typeof ensureHostedWorkerChrome
  generate?: typeof generateHostedWorkerResponse
}

type HostedWorkerServerOptions = HostedWorkerHandlerOptions & {
  host?: string
  port?: number
}

const defaultHost = "127.0.0.1"
const defaultPort = 8787
const maxBodyBytes = 64 * 1024
const contentTypeJson = "application/json; charset=utf-8"

type RequestValidationField = NonNullable<HostedWorkerErrorResponse["error"]["fields"]>[number]

class HostedWorkerRequestValidationError extends Error {
  readonly fields: RequestValidationField[]

  constructor(message: string, fields: RequestValidationField[]) {
    super(message)
    this.name = "HostedWorkerRequestValidationError"
    this.fields = fields
  }
}

export function createHostedWorkerServer(options: HostedWorkerServerOptions = {}): Server {
  const state = options.state ?? createHostedWorkerRuntimeState()
  const queue = options.queue ?? createHostedWorkerQueue(state)
  const handler = createHostedWorkerRequestHandler({
    ...options,
    state,
    queue,
  })

  return createServer((request, response) => {
    handler(request, response).catch((error: unknown) => {
      writeJson(response, 500, errorResponse("unknown", toPublicMessage(error), false))
    })
  })
}

export function startHostedWorkerServer(options: HostedWorkerServerOptions = {}): Promise<Server> {
  assertLoopbackCdpBaseUrl(process.env.CHATBOT_HOSTED_WORKER_CDP_BASE_URL)
  const server = createHostedWorkerServer(options)
  const host = options.host ?? process.env.CHATBOT_HOSTED_WORKER_HOST ?? defaultHost
  const port = options.port ?? parsePositiveInteger(process.env.CHATBOT_HOSTED_WORKER_PORT, defaultPort)

  return new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(port, host, () => {
      server.off("error", reject)
      resolve(server)
    })
  })
}

export function createHostedWorkerRequestHandler(options: HostedWorkerHandlerOptions = {}) {
  const state = options.state ?? createHostedWorkerRuntimeState()
  const queue = options.queue ?? createHostedWorkerQueue(state)
  const health = options.health ?? getHostedWorkerHealth
  const ensureChrome = options.ensureChrome ?? ensureHostedWorkerChrome
  const generate = options.generate ?? generateHostedWorkerResponse

  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const auth = authorizeHostedWorkerRequest(
      new Headers(toHeaderEntries(request)),
      options.token ?? process.env.CHATBOT_HOSTED_WORKER_TOKEN,
    )
    if (!auth.ok) {
      writeJson(response, auth.status, errorResponse(auth.code, auth.message, false))
      return
    }

    const url = new URL(request.url ?? "/", "http://127.0.0.1")

    if (request.method === "GET" && url.pathname === "/health") {
      writeJson(response, 200, await health(state))
      return
    }

    if (request.method === "POST" && url.pathname === "/ensure-chrome") {
      writeJson(response, 200, await ensureChrome())
      return
    }

    if (request.method === "POST" && url.pathname === "/generate") {
      try {
        const body = validateHostedWorkerGenerateRequest(await readJsonBody(request))
        writeJson(response, 200, await generate(body, state, queue))
      } catch (error) {
        const normalized = normalizeServerError(error)
        writeJson(response, normalized.status, normalized.body)
      }
      return
    }

    if (url.pathname === "/health" || url.pathname === "/ensure-chrome" || url.pathname === "/generate") {
      writeJson(response, 405, errorResponse("method_not_allowed", "HTTP method is not allowed.", false))
      return
    }

    writeJson(response, 404, errorResponse("not_found", "Hosted worker endpoint was not found.", false))
  }
}

function normalizeServerError(error: unknown): { status: number; body: HostedWorkerErrorResponse } {
  if (error instanceof HostedWorkerRequestValidationError) {
    return {
      status: 400,
      body: errorResponse("invalid-request", error.message, false, error.fields),
    }
  }

  if (error instanceof ChatbotLlmError) {
    return {
      status: httpStatusForLlmError(error),
      body: errorResponse(error.code, error.message, error.isRetryable),
    }
  }

  return {
    status: 400,
    body: errorResponse("invalid-output", toPublicMessage(error), false),
  }
}

function httpStatusForLlmError(error: ChatbotLlmError): number {
  if (error.code === "auth") return 401
  if (error.code === "rate-limit") return 429
  if (error.code === "timeout") return 504
  if (error.code === "connection") return 502
  if (error.code === "invalid-output") return 502
  return 500
}

function errorResponse(
  code: HostedWorkerErrorResponse["error"]["code"],
  message: string,
  retryable: boolean,
  fields?: RequestValidationField[],
): HostedWorkerErrorResponse {
  return {
    ok: false,
    tier: hostedWorkerTier,
    error: {
      code,
      message,
      retryable,
      ...(fields ? { fields } : {}),
    },
  }
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let totalBytes = 0

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    totalBytes += buffer.length
    if (totalBytes > maxBodyBytes) throw new Error("Request body is too large.")
    chunks.push(buffer)
  }

  const rawBody = Buffer.concat(chunks).toString("utf8")
  if (!rawBody) return {}
  try {
    return JSON.parse(rawBody)
  } catch {
    throw new HostedWorkerRequestValidationError("Request body must be valid JSON.", [
      { field: "body", reason: "invalid_type", expected: "valid JSON", received: "invalid JSON" },
    ])
  }
}

function validateHostedWorkerGenerateRequest(value: unknown): HostedWorkerGenerateRequest {
  const fields: RequestValidationField[] = []
  if (!isRecord(value)) {
    throw new HostedWorkerRequestValidationError("Invalid hosted worker generate request.", [
      { field: "body", reason: "invalid_type", expected: "object", received: typeName(value) },
    ])
  }

  addRequiredStringField(fields, value, "systemPrompt")
  addRequiredArrayField(fields, value, "messages")
  addRequiredObjectField(fields, value, "conversationState")
  addRequiredObjectField(fields, value, "jobContext")

  if (Array.isArray(value.messages)) {
    value.messages.forEach((message, index) => {
      if (!isRecord(message)) {
        fields.push({
          field: `messages.${index}`,
          reason: "invalid_type",
          expected: "object",
          received: typeName(message),
        })
        return
      }
      addRequiredStringField(fields, message, "role", `messages.${index}.role`)
      addRequiredStringField(fields, message, "content", `messages.${index}.content`)
    })
  }

  if (fields.length > 0) {
    throw new HostedWorkerRequestValidationError("Invalid hosted worker generate request.", fields)
  }

  return value as HostedWorkerGenerateRequest
}

function addRequiredStringField(
  fields: RequestValidationField[],
  value: Record<string, unknown>,
  field: string,
  displayField = field,
): void {
  addRequiredField(fields, value, field, displayField, "string", (entry) => typeof entry === "string")
}

function addRequiredArrayField(fields: RequestValidationField[], value: Record<string, unknown>, field: string): void {
  addRequiredField(fields, value, field, field, "array", Array.isArray)
}

function addRequiredObjectField(fields: RequestValidationField[], value: Record<string, unknown>, field: string): void {
  addRequiredField(fields, value, field, field, "object", isRecord)
}

function addRequiredField(
  fields: RequestValidationField[],
  value: Record<string, unknown>,
  field: string,
  displayField: string,
  expected: string,
  isValid: (entry: unknown) => boolean,
): void {
  const entry = value[field]
  if (entry === undefined) {
    fields.push({ field: displayField, reason: "missing", expected, received: "undefined" })
    return
  }
  if (!isValid(entry)) {
    fields.push({ field: displayField, reason: "invalid_type", expected, received: typeName(entry) })
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function typeName(value: unknown): string {
  if (Array.isArray(value)) return "array"
  if (value === null) return "null"
  return typeof value
}

function writeJson(response: ServerResponse, statusCode: number, value: unknown): void {
  response.statusCode = statusCode
  response.setHeader("content-type", contentTypeJson)
  response.end(JSON.stringify(value))
}

function toPublicMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Hosted worker request failed."
}

function toHeaderEntries(request: IncomingMessage): [string, string][] {
  return Object.entries(request.headers).flatMap(([key, value]) => {
    if (Array.isArray(value)) return value.map((entry) => [key, entry] as [string, string])
    return typeof value === "string" ? [[key, value]] : []
  })
}

function assertLoopbackCdpBaseUrl(value: string | undefined): void {
  if (!value) return
  const url = new URL(value)
  if (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1") return

  throw new Error("CHATBOT_HOSTED_WORKER_CDP_BASE_URL must point to a loopback address.")
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}
