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

const cdpBaseUrl = process.env.CHATBOT_TIER1_CDP_BASE_URL ?? "http://127.0.0.1:9223"
const targetUrlIncludes = "notion.so"
const expectedModel = "apricot-sorbet-high"
const requestTimeoutMs = 90000
const docsPath = path.resolve(projectRoot(), "docs", "chatbot", "tier1-tier2-smoke-result.md")

async function main(): Promise<void> {
  const target = await findNotionAiTarget()
  const selectorResult = await assertModelSelector(target)
  const client = createTier1ChromeNotionAiClient({ preferredModel: expectedModel })
  const startedAt = Date.now()

  try {
    const response = await client.generate(buildRequest())
    const latencyMs = response.latencyMs ?? Date.now() - startedAt
    const rawTextPreview = preview(response.rawText)

    await writeSmokeSection(`## Tier 1 Notion AI CDP smoke
- status: pass
- cdpBaseUrl: ${cdpBaseUrl}
- targetUrlIncludes: ${targetUrlIncludes}
- modelSelector: ${expectedModel}
- targetUrl: ${selectorResult.url}
- latencyMs: ${latencyMs}
- tokensUsed: ${response.tokensUsed ?? "n/a"}
- rawTextPreview: ${rawTextPreview}
`)

    console.log(
      JSON.stringify(
        {
          status: "pass",
          latencyMs,
          tokensUsed: response.tokensUsed ?? null,
          rawTextPreview,
        },
        null,
        2,
      ),
    )
  } catch (error) {
    await writeFailureSection("generate-failed", error)
    throw error
  }
}

async function findNotionAiTarget(): Promise<JsonListTarget> {
  const version = await requestJson<JsonVersion>("/json/version")
  if (!version.webSocketDebuggerUrl) {
    throw new Error("Chrome CDP browser endpoint did not expose webSocketDebuggerUrl.")
  }

  const browser = await CdpConnection.connect(version.webSocketDebuggerUrl)
  try {
    const targetResponse = await browser.send<{ targetInfos?: CdpTargetInfo[] }>("Target.getTargets")
    const targetInfo = targetResponse.targetInfos?.find((candidate) => {
      const url = candidate.url ?? ""
      return candidate.type === "page" && url.includes(targetUrlIncludes) && url.includes("/ai")
    })
    if (!targetInfo?.targetId) {
      throw new ChatbotLlmError({
        message: "No Notion AI page target was found on the configured Chrome CDP port.",
        code: "connection",
        tier: "tier-1-chrome-notion-ai",
        isRetryable: true,
      })
    }

    const list = await requestJson<JsonListTarget[]>("/json/list")
    const target = list.find((candidate) => candidate.id === targetInfo.targetId)
    if (!target?.webSocketDebuggerUrl) {
      throw new Error("Notion AI page target did not expose webSocketDebuggerUrl.")
    }

    return target
  } finally {
    browser.close()
  }
}

async function assertModelSelector(target: JsonListTarget): Promise<ModelSelectorResult> {
  const page = await CdpConnection.connect(target.webSocketDebuggerUrl ?? "")
  try {
    const result = await page.evaluate<ModelSelectorResult>(`(() => {
      const needle = ${JSON.stringify(expectedModel)};
      const html = document.documentElement ? document.documentElement.outerHTML : "";
      const text = document.documentElement ? document.documentElement.innerText : "";
      return {
        found: html.includes(needle) || text.includes(needle),
        url: location.href,
        title: document.title || "",
      };
    })()`)

    if (!result.found) {
      const error = new Error(`assert failed: DOM does not contain ${expectedModel}`)
      await writeSmokeSection(`## Tier 1 Notion AI CDP smoke
- status: fail
- cdpBaseUrl: ${cdpBaseUrl}
- targetUrlIncludes: ${targetUrlIncludes}
- modelSelector: ${expectedModel}
- targetUrl: ${result.url}
- error: ${error.message}
- note: 強制更新設定が効いていない可能性
`)
      throw error
    }

    return result
  } finally {
    page.close()
  }
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

async function writeFailureSection(stage: string, error: unknown): Promise<void> {
  const err = normalizeError(error)
  await writeSmokeSection(`## Tier 1 Notion AI CDP smoke
- status: fail
- cdpBaseUrl: ${cdpBaseUrl}
- targetUrlIncludes: ${targetUrlIncludes}
- modelSelector: ${expectedModel}
- stage: ${stage}
- errorName: ${err.name}
- errorCode: ${err.code ?? "n/a"}
- message: ${err.message}
`)
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

  private constructor(private readonly socket: WebSocket) {
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as CdpCommandResponse<unknown>
      if (!message.id) return

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
      throw new Error("Runtime.evaluate returned exceptionDetails.")
    }

    return result.result?.value as T
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
