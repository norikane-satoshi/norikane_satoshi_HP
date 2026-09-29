import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createTier1ChromeNotionAiClient } from "@/lib/chatbot/server/llm-clients/tier1-chrome-notion-ai"
import { ChatbotLlmError, type ChatbotLlmRequest } from "@/lib/chatbot/server/llm-client"

type CdpTargetInfo = {
  targetId?: string
  type?: string
  url?: string
}

type JsonListTarget = {
  id?: string
  type?: string
  url?: string
  webSocketDebuggerUrl?: string
}

type JsonVersion = {
  webSocketDebuggerUrl?: string
}

type CdpCommandResponse<T> = {
  id: number
  result?: T
  error?: { message?: string }
}

type RuntimeEvaluateResult<T> = {
  result?: {
    type?: string
    value?: T
  }
  exceptionDetails?: unknown
}

type ModelSelectorResult = {
  found: boolean
  url: string
  title: string
}

type AttachTargetInfo = ModelSelectorResult & {
  id: string
  webSocketDebuggerUrl: string
}

type ObservedInferenceRequest = {
  url: string
  method: string
  contentType: string | null
  postData: string
  model: unknown
  modelFromUser: unknown
  modelRelatedKeys: string[]
}

type SmokeResult = {
  status: "pass" | "fail"
  latencyMs?: number
  rawTextPreview?: string
  attachTarget: ModelSelectorResult
  observedRequest?: ObservedInferenceRequest
  failure?: {
    stage: string
    message: string
  }
}

const cdpBaseUrl = process.env.CHATBOT_TIER1_CDP_BASE_URL ?? "http://127.0.0.1:9223"
const targetUrlIncludes = "notion.so"
const expectedModel = "apricot-sorbet-high"
const requestTimeoutMs = 90000
const docsPath = path.resolve(projectRoot(), "docs", "chatbot", "tier1-tier2-smoke-result.md")

async function main(): Promise<void> {
  const target = await findNotionAiTarget()
  const page = await CdpConnection.connect(target.webSocketDebuggerUrl)
  const observedRequestPromise = page.waitForInferenceRequest(requestTimeoutMs)
  await page.send("Network.enable", { maxPostDataSize: 1024 * 1024 })

  const selectorResult = await inspectModelSelector(page)
  if (!selectorResult.found) {
    console.warn(`warn: DOM does not contain ${expectedModel}; continuing to request payload check.`)
  }

  const client = createTier1ChromeNotionAiClient({
    preferredModel: expectedModel,
    fetchClient: selectedTargetFetch(target),
    sessionFactory: async () => ({
      evaluate: async <T,>(expression: string) => page.evaluate<T>(expression),
      close: async () => undefined,
    }),
  })
  const startedAt = Date.now()

  try {
    const response = await client.generate(buildRequest())
    const observedRequest = await observedRequestPromise
    const assertion = assertObservedModelPayload(observedRequest)
    const latencyMs = response.latencyMs ?? Date.now() - startedAt
    const rawTextPreview = preview(response.rawText)

    await writeSmokeSection(`## Tier 1 Notion AI CDP smoke
- status: pass
- cdpBaseUrl: ${cdpBaseUrl}
- targetUrlIncludes: ${targetUrlIncludes}
- assertion: request payload model + modelFromUser
- expectedModel: ${expectedModel}
- targetUrl: ${selectorResult.url}
- targetTitle: ${selectorResult.title}
- observedEndpoint: ${observedRequest.url}
- observedModel: ${String(assertion.model)}
- observedModelFromUser: ${String(assertion.modelFromUser)}
- latencyMs: ${latencyMs}
- tokensUsed: ${response.tokensUsed ?? "n/a"}
- rawTextPreview: ${rawTextPreview}
`)

    printResult({
      status: "pass",
      latencyMs,
      rawTextPreview,
      attachTarget: selectorResult,
      observedRequest,
    })
  } catch (error) {
    const observedRequest = await observedRequestPromise.catch(() => undefined)
    printResult({
      status: "fail",
      attachTarget: selectorResult,
      observedRequest,
      failure: {
        stage: observedRequest ? "payload-assertion-or-generate" : "no-inference-request-observed",
        message: normalizeError(error).message,
      },
    })
    throw error
  } finally {
    page.close()
  }
}

async function findNotionAiTarget(): Promise<AttachTargetInfo> {
  const version = await requestJson<JsonVersion>("/json/version")
  if (!version.webSocketDebuggerUrl) {
    throw new Error("Chrome CDP browser endpoint did not expose webSocketDebuggerUrl.")
  }

  const browser = await CdpConnection.connect(version.webSocketDebuggerUrl)
  try {
    const targetResponse = await browser.send<{ targetInfos?: CdpTargetInfo[] }>("Target.getTargets")
    const targetInfos = targetResponse.targetInfos ?? []
    const notionTargetInfos = targetInfos.filter((candidate) => {
      const url = candidate.url ?? ""
      return candidate.type === "page" && url.includes(targetUrlIncludes) && url.includes("/ai")
    })
    if (notionTargetInfos.length === 0) {
      throw new ChatbotLlmError({
        message: "No Notion AI page target was found on the configured Chrome CDP port.",
        code: "connection",
        tier: "tier-1-chrome-notion-ai",
        isRetryable: true,
      })
    }

    const list = await requestJson<JsonListTarget[]>("/json/list")
    const candidates = notionTargetInfos
      .map((targetInfo, index) => {
        const target = list.find((candidate) => candidate.id === targetInfo.targetId)
        return target ? { target, index } : undefined
      })
      .filter((candidate): candidate is { target: JsonListTarget; index: number } => Boolean(candidate))

    const inspected = await Promise.all(
      candidates.map(async ({ target, index }) => {
        const webSocketDebuggerUrl = target.webSocketDebuggerUrl
        if (!target.id || !webSocketDebuggerUrl) return undefined
        const page = await CdpConnection.connect(webSocketDebuggerUrl)
        try {
          const result = await page.evaluate<
            ModelSelectorResult & { hasFocus: boolean; visibilityState: string }
          >(`(() => ({
            found: false,
            url: location.href,
            title: document.title || "",
            hasFocus: document.hasFocus(),
            visibilityState: document.visibilityState || "",
          }))()`)
          return { target, index, result }
        } finally {
          page.close()
        }
      }),
    )
    const selected = inspected
      .filter(
        (
          candidate,
        ): candidate is {
          target: JsonListTarget
          index: number
          result: ModelSelectorResult & { hasFocus: boolean; visibilityState: string }
        } => Boolean(candidate),
      )
      .sort((left, right) => {
        const focusDiff = Number(right.result.hasFocus) - Number(left.result.hasFocus)
        if (focusDiff !== 0) return focusDiff
        const visibleDiff =
          Number(right.result.visibilityState === "visible") -
          Number(left.result.visibilityState === "visible")
        if (visibleDiff !== 0) return visibleDiff
        return left.index - right.index
      })[0]
    const target = selected?.target
    if (!target?.webSocketDebuggerUrl) {
      throw new Error("Notion AI page target did not expose webSocketDebuggerUrl.")
    }

    return {
      id: target.id ?? "",
      webSocketDebuggerUrl: target.webSocketDebuggerUrl,
      found: false,
      url: selected.result.url,
      title: selected.result.title,
    }
  } finally {
    browser.close()
  }
}

async function inspectModelSelector(page: CdpConnection): Promise<ModelSelectorResult> {
  return page.evaluate<ModelSelectorResult>(`(() => {
    const needle = ${JSON.stringify(expectedModel)};
    const html = document.documentElement ? document.documentElement.outerHTML : "";
    const text = document.documentElement ? document.documentElement.innerText : "";
    return {
      found: html.includes(needle) || text.includes(needle),
      url: location.href,
      title: document.title || "",
    };
  })()`)
}

function buildRequest(): ChatbotLlmRequest {
  const jobContext = {
    jobKind: "cm",
    lengthMinutes: 0.5,
    additionalWork: [],
    workSite: "satoshi-studio",
  } as unknown as ChatbotLlmRequest["jobContext"]

  return {
    systemPrompt:
      "あなたはのりかね映像設計室の新規案件相談窓口です。金額は提示せず、所要日数だけを簡潔に返してください。",
    messages: [],
    conversationState: {
      hasFinalMedium: true,
      hasJobKind: true,
      hasAdditionalWork: true,
      hasDocumentaryAttachments: true,
      hasWorkSite: true,
      hasReferenceUrls: false,
      hasContactEmail: true,
      hasDesiredSchedule: false,
      turnCount: 1,
      contactEmail: "fake.customer@example.test",
      customerName: "Fake Customer",
      companyName: "Fake Company",
    },
    jobContext,
    latestUserMessage: "CM 30 秒で追加作業なしの相談です。所要日数だけ教えてください",
    temperature: 0,
    maxOutputTokens: 512,
  }
}

async function writeSmokeSection(section: string): Promise<void> {
  await upsertSection(docsPath, "## Tier 1 Notion AI CDP smoke", section)
}

async function upsertSection(filePath: string, heading: string, nextSection: string): Promise<void> {
  const current = await readFile(filePath, "utf-8").catch(() => "# Tier 1 / Tier 2 smoke result\n")
  const headingIndex = current.indexOf(heading)
  const normalizedSection = `${nextSection.trim()}\n`

  if (headingIndex === -1) {
    await writeFile(filePath, `${current.trimEnd()}\n\n${normalizedSection}`, "utf-8")
    return
  }

  const nextHeadingIndex = current.indexOf("\n## ", headingIndex + heading.length)
  const before = current.slice(0, headingIndex).trimEnd()
  const after = nextHeadingIndex === -1 ? "" : current.slice(nextHeadingIndex).trimStart()
  await writeFile(filePath, `${before}\n\n${normalizedSection}${after ? `\n${after}` : ""}`, "utf-8")
}

async function requestJson<T>(pathName: string): Promise<T> {
  const response = await fetch(`${cdpBaseUrl}${pathName}`)
  if (!response.ok) {
    throw new Error(`Chrome CDP discovery request failed: ${response.status}`)
  }
  return (await response.json()) as T
}

function preview(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 200)
}

function selectedTargetFetch(target: AttachTargetInfo): typeof fetch {
  return async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith("/json/version")) {
      return new Response(JSON.stringify({ Browser: "Chrome", webSocketDebuggerUrl: "selected-target" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }
    if (url.endsWith("/json/list")) {
      return new Response(
        JSON.stringify([
          {
            id: target.id,
            type: "page",
            url: target.url,
            webSocketDebuggerUrl: target.webSocketDebuggerUrl,
          },
        ]),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      )
    }

    return fetch(input, init)
  }
}

function assertObservedModelPayload(observedRequest: ObservedInferenceRequest): {
  model: unknown
  modelFromUser: unknown
} {
  if (observedRequest.model !== expectedModel || observedRequest.modelFromUser !== true) {
    throw new Error(
      `assert failed: observed model=${String(observedRequest.model)} modelFromUser=${String(
        observedRequest.modelFromUser,
      )}`,
    )
  }

  return { model: observedRequest.model, modelFromUser: observedRequest.modelFromUser }
}

function printResult(result: SmokeResult): void {
  console.log(JSON.stringify(result, null, 2))
}

function parseObservedInferenceRequest(input: {
  url: string
  method: string
  headers?: Record<string, string>
  postData?: string
}): ObservedInferenceRequest | undefined {
  const isInferenceEndpoint =
    input.url.includes("/api/v3/runInferenceTranscript") ||
    input.url.includes("/api/v1/runInferenceTranscript")
  if (!isInferenceEndpoint) return undefined
  if (!input.postData) return undefined

  const parsed = tryParseJson(input.postData)
  if (!parsed) return undefined

  const model = findFirstKey(parsed, "model")
  const modelFromUser = findFirstKey(parsed, "modelFromUser")
  return {
    url: input.url,
    method: input.method,
    contentType: headerValue(input.headers, "content-type"),
    postData: input.postData,
    model,
    modelFromUser,
    modelRelatedKeys: findModelRelatedKeys(parsed).slice(0, 3),
  }
}

function tryParseJson(value: string): unknown | undefined {
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

function headerValue(headers: Record<string, string> | undefined, needle: string): string | null {
  if (!headers) return null
  const match = Object.entries(headers).find(([key]) => key.toLowerCase() === needle)
  return match?.[1] ?? null
}

function findFirstKey(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object") return undefined
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findFirstKey(entry, key)
      if (found !== undefined) return found
    }
    return undefined
  }

  const record = value as Record<string, unknown>
  if (Object.prototype.hasOwnProperty.call(record, key)) return record[key]
  for (const entry of Object.values(record)) {
    const found = findFirstKey(entry, key)
    if (found !== undefined) return found
  }
  return undefined
}

function findModelRelatedKeys(value: unknown, pathParts: string[] = []): string[] {
  if (!value || typeof value !== "object") return []
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => findModelRelatedKeys(entry, [...pathParts, String(index)]))
  }

  const record = value as Record<string, unknown>
  return Object.entries(record).flatMap(([key, entry]) => {
    const path = [...pathParts, key]
    const own = key.toLowerCase().includes("model") ? [path.join(".")] : []
    return [...own, ...findModelRelatedKeys(entry, path)]
  })
}

function normalizeError(error: unknown): { name: string; message: string; code?: string } {
  if (error instanceof ChatbotLlmError) {
    return { name: error.name, message: error.message, code: error.code }
  }
  if (error instanceof Error) {
    return { name: error.name, message: error.message }
  }
  return { name: "UnknownError", message: String(error) }
}

function projectRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
}

class CdpConnection {
  private nextId = 1
  private readonly pending = new Map<
    number,
    {
      resolve(value: unknown): void
      reject(reason?: unknown): void
    }
  >()
  private readonly listeners = new Map<string, Set<(params: unknown) => void>>()

  private constructor(private readonly socket: WebSocket) {
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as CdpCommandResponse<unknown> & {
        method?: string
        params?: unknown
      }
      if (!message.id) {
        if (message.method) {
          for (const listener of this.listeners.get(message.method) ?? []) {
            listener(message.params)
          }
        }
        return
      }

      const request = this.pending.get(message.id)
      if (!request) return
      this.pending.delete(message.id)

      if (message.error) {
        request.reject(new Error(message.error.message ?? "CDP command failed."))
        return
      }

      request.resolve(message.result)
    })
    this.socket.addEventListener("close", () => {
      for (const request of this.pending.values()) {
        request.reject(new Error("CDP socket closed."))
      }
      this.pending.clear()
    })
  }

  static connect(url: string): Promise<CdpConnection> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url)
      socket.addEventListener("open", () => resolve(new CdpConnection(socket)), { once: true })
      socket.addEventListener("error", () => reject(new Error("CDP socket connection failed.")), {
        once: true,
      })
    })
  }

  send<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    const id = this.nextId
    this.nextId += 1
    const payload = JSON.stringify({ id, method, params })

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject })
      this.socket.send(payload)
    })
  }

  async evaluate<T>(expression: string): Promise<T> {
    const result = await this.send<RuntimeEvaluateResult<T>>("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      timeout: requestTimeoutMs,
    })

    if (result.exceptionDetails) {
      throw new Error(`Runtime.evaluate returned exceptionDetails: ${JSON.stringify(result.exceptionDetails)}`)
    }

    return result.result?.value as T
  }

  on(method: string, listener: (params: unknown) => void): void {
    const listeners = this.listeners.get(method) ?? new Set<(params: unknown) => void>()
    listeners.add(listener)
    this.listeners.set(method, listeners)
  }

  waitForInferenceRequest(timeoutMs: number): Promise<ObservedInferenceRequest> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("No Notion AI inference request was observed.")),
        timeoutMs,
      )

      this.on("Network.requestWillBeSent", (params) => {
        const request = (params as { request?: {
          url?: string
          method?: string
          headers?: Record<string, string>
          postData?: string
        } }).request
        const observed = parseObservedInferenceRequest({
          url: request?.url ?? "",
          method: request?.method ?? "",
          headers: request?.headers,
          postData: request?.postData,
        })
        if (!observed) return

        clearTimeout(timeout)
        resolve(observed)
      })
    })
  }

  close(): void {
    this.socket.close()
  }
}

main().catch((error: unknown) => {
  const err = normalizeError(error)
  console.error(`${err.name}: ${err.message}`)
  process.exit(1)
})
