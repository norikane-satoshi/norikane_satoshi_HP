import type { ChatbotLlmClient, ChatbotLlmRequest, ChatbotLlmResponse } from "@/lib/chatbot/server/llm-client"
import { ChatbotLlmError } from "@/lib/chatbot/server/llm-client"

type Tier1ChromeNotionAiClientConfig = {
  cdpBaseUrl: string
  targetUrlIncludes: string
  requestTimeoutMs: number
  healthCheckTimeoutMs: number
  preferredModel?: string
}

type Tier1ChromeNotionAiClientOptions = Partial<Tier1ChromeNotionAiClientConfig> & {
  fetchClient?: CdpFetchClient
  sessionFactory?: NotionAiCdpSessionFactory
  idFactory?: IdFactory
}

type CdpFetchClient = (input: string, init?: RequestInit) => Promise<Response>
type IdFactory = () => string

export type NotionAiCdpTarget = {
  id?: string
  type?: string
  url?: string
  webSocketDebuggerUrl?: string
}

export type NotionAiCdpSession = {
  evaluate<T>(expression: string, timeoutMs: number): Promise<T>
  close(): Promise<void>
}

type NotionAiCdpSessionFactory = (target: NotionAiCdpTarget) => Promise<NotionAiCdpSession>

type TimeoutTag = "timeout"

type NotionAiRuntimeContext = {
  spaceId?: string
  userId?: string
  notionClientVersion?: string
  contextPageId?: string
  selectedModel?: string
  finalModelName?: string
  availableModels?: string[]
  modelFromUser?: boolean
  workflowValue?: Partial<NotionAiWorkflowValue>
}

type NotionAiWorkflowValue = {
  type: "workflow"
  model: string
  isHipaa: boolean
  isMobile: boolean
  yoloMode: boolean
  writerMode: boolean
  searchScopes: unknown[]
  useWebSearch: boolean
  isCustomAgent: boolean
  modelFromUser: boolean
  enableComputer: boolean
  enableQueryMail: boolean
  useReadOnlyMode: boolean
  useSearchToolV2: boolean
  enableAgentDiffs: boolean
  enableScriptAgent: boolean
  isOnboardingAgent: boolean
  enableCustomAgents: boolean
  availableConnectors: unknown[]
  enableMarkdownVNext: boolean
  enableQueryCalendar: boolean
  useCustomAgentDraft: boolean
  enableAgentAskSurvey: boolean
  enableCrdtOperations: boolean
  enableDatabaseAgents: boolean
  enableScriptAgentGtm: boolean
  isCustomAgentBuilder: boolean
  useRulePrioritization: boolean
  enableAgentAutomations: boolean
  enableAgentThreadTools: boolean
  enableScriptAgentSlack: boolean
  isAgentResearchRequest: boolean
  databaseAgentConfigMode: string | null
  enableAgentIntegrations: boolean
  enableSpeculativeSearch: boolean
  use_draft_actor_pointer: boolean
  enableAgentGenerateImage: boolean
  enableCreateAndRunThread: boolean
  enableSystemPromptAsPage: boolean
  enableUserSessionContext: boolean
  enableScriptAgentAdvanced: boolean
  enableSoftwareFactoryPage: boolean
  enableUpdatePageAutofixer: boolean
  agentShortUpdatePageResult: boolean
  enableAgentUpdatePagePatch: boolean
  enableCsvAttachmentSupport: boolean
  enableMailExplicitToolCalls: boolean
  enableScriptAgentMcpServers: boolean
  enableAgentCardCustomization: boolean
  enableUpdatePageOrderUpdates: boolean
  useContextualCoreDocsAutoLoad: boolean
  useDocPreviewsForCoreAutoLoad: boolean
  enableExperimentalIntegrations: boolean
  updatePageStaleViewGuardEnabled: boolean
  enableAgentSupportPropertyReorder: boolean
  enableMailNotificationPreferences: boolean
  showDatabaseAgentsDiscoverability: boolean
  enableScriptAgentCustomToolCalling: boolean
  enableMailAgentMultiProviderSupport: boolean
  enableLargeToolResultComputerOffload: boolean
  enableScriptAgentGoogleDriveInCustomAgent: boolean
  enableScriptAgentGoogleDriveOAuthInCustomAgent: boolean
  enableScriptAgentSearchConnectorsInCustomAgent: boolean
  isThreadStartedByAdmin: boolean
}

type RunInferencePayload = {
  traceId: string
  spaceId: string
  transcript: Array<{ id: string; type: string; value: unknown }>
  threadId: string
  createThread: boolean
  debugOverrides: {
    emitAgentSearchExtractedResults: boolean
    cachedInferences: unknown[]
    annotationInferences: unknown[]
    emitInferences: boolean
  }
  generateTitle: boolean
  saveAllThreadOperations: boolean
  setUnreadState: boolean
  createdSource: string
  threadType: string
  isPartialTranscript: boolean
  asPatchResponse: boolean
  hasHeartbeat: boolean
  isUserInAnySalesAssistedSpace: boolean
  isSpaceSalesAssisted: boolean
}

type RunInferenceHeaders = {
  Accept: string
  "Content-Type": string
  "notion-audit-log-platform": string
  "notion-client-version": string
  "x-notion-active-user-header": string
  "x-notion-space-id": string
}

type NotionAiInferenceResult =
  | { ok: true; rawText: string; chunkCount: number }
  | { ok: false; status?: number; code: "auth" | "invalid-output" | "unknown"; message: string }

export type ParsedInferenceNdjsonChunk = {
  raw: unknown
  isPartialTranscript: boolean
  assistantText: string
}

export type ParsedInferenceNdjsonStream = {
  chunks: ParsedInferenceNdjsonChunk[]
  partialText: string
  finalText: string
  assistantText: string
  chunkCount: number
}

type CdpTargetsResponse = NotionAiCdpTarget[]
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

const tier = "tier-1-chrome-notion-ai" as const
const timeoutTag: TimeoutTag = "timeout"
const jsonListPath = "/json/list"
const jsonVersionPath = "/json/version"
const httpGet = "GET"
const targetTypePage = "page"
const observedNotionAiModel = "apricot-sorbet-high"
const defaultCreatedSource = "assistant"
const defaultThreadType = "workflow"
const defaultNotionClientVersion = "unknown"
const emptyText = ""

export const tier1ChromeNotionAiDefaults = {
  cdpBaseUrl: "http://127.0.0.1:9223",
  targetUrlIncludes: "notion.so",
  requestTimeoutMs: 90000,
  healthCheckTimeoutMs: 3000,
} as const

export class Tier1ChromeNotionAiClient implements ChatbotLlmClient {
  readonly tier = tier
  private readonly config: Tier1ChromeNotionAiClientConfig
  private readonly fetchClient: CdpFetchClient
  private readonly sessionFactory: NotionAiCdpSessionFactory
  private readonly idFactory: IdFactory

  constructor(options: Tier1ChromeNotionAiClientOptions = {}) {
    this.config = {
      cdpBaseUrl: options.cdpBaseUrl ?? tier1ChromeNotionAiDefaults.cdpBaseUrl,
      targetUrlIncludes: options.targetUrlIncludes ?? tier1ChromeNotionAiDefaults.targetUrlIncludes,
      requestTimeoutMs: options.requestTimeoutMs ?? tier1ChromeNotionAiDefaults.requestTimeoutMs,
      healthCheckTimeoutMs:
        options.healthCheckTimeoutMs ?? tier1ChromeNotionAiDefaults.healthCheckTimeoutMs,
      preferredModel: options.preferredModel,
    }
    this.fetchClient = options.fetchClient ?? globalFetch
    this.sessionFactory = options.sessionFactory ?? createDefaultCdpSession
    this.idFactory = options.idFactory ?? randomId
  }

  async generate(request: ChatbotLlmRequest): Promise<ChatbotLlmResponse> {
    const startedAt = Date.now()
    const session = await this.openSession(this.config.requestTimeoutMs)

    try {
      const runtimeContext = await this.evaluate<NotionAiRuntimeContext>(
        session,
        runtimeContextExpression,
        this.config.requestTimeoutMs,
      )
      const payload = buildRunInferencePayload({
        request,
        runtimeContext,
        preferredModel: this.config.preferredModel,
        idFactory: this.idFactory,
      })
      const headers = buildRunInferenceHeaders(runtimeContext)
      const result = await this.evaluate<NotionAiInferenceResult>(
        session,
        buildRunInferenceExpression(payload, headers),
        this.config.requestTimeoutMs,
      )

      if (!result.ok) throw this.mapInferenceResult(result)

      const rawText = result.rawText.trim()
      if (rawText === emptyText || result.chunkCount === 0) {
        throw this.toLlmError({
          message: "Notion AI tier returned an empty NDJSON stream.",
          code: "invalid-output",
          isRetryable: false,
        })
      }

      return {
        rawText,
        tier: this.tier,
        latencyMs: Date.now() - startedAt,
      }
    } catch (error) {
      throw this.mapGenerateError(error)
    } finally {
      await session.close()
    }
  }

  async isHealthy(): Promise<boolean> {
    let session: NotionAiCdpSession | undefined

    try {
      session = await this.openSession(this.config.healthCheckTimeoutMs)
      const runtimeContext = await this.evaluate<NotionAiRuntimeContext>(
        session,
        runtimeContextExpression,
        this.config.healthCheckTimeoutMs,
      )

      if (!runtimeContext.spaceId) return false
      if (!this.config.preferredModel) return true

      return modelIsAvailable(this.config.preferredModel, runtimeContext.availableModels)
    } catch {
      return false
    } finally {
      await session?.close()
    }
  }

  private async openSession(timeoutMs: number): Promise<NotionAiCdpSession> {
    try {
      await this.requestJson<unknown>(jsonVersionPath, timeoutMs)
      const targets = await this.requestJson<CdpTargetsResponse>(jsonListPath, timeoutMs)
      const loginTarget = findNotionLoginTarget(targets, this.config.targetUrlIncludes)
      const target = findNotionAiTarget(targets, this.config.targetUrlIncludes)

      if (!target && loginTarget) {
        throw this.toLlmError({
          message: "Notion AI page target is redirected to login.",
          code: "auth",
          isRetryable: false,
        })
      }

      if (!target) {
        throw this.toLlmError({
          message: "No Notion AI page target was found on the configured Chrome CDP port.",
          code: "connection",
          isRetryable: true,
        })
      }

      if (target.url?.includes("/login")) {
        throw this.toLlmError({
          message: "Notion AI page target is redirected to login.",
          code: "auth",
          isRetryable: false,
        })
      }

      return await withTimeout(this.sessionFactory(target), timeoutMs, timeoutTag)
    } catch (error) {
      if (error instanceof ChatbotLlmError) throw error
      if (error === timeoutTag) {
        throw this.toLlmError({
          message: "Chrome CDP connection timed out.",
          code: "timeout",
          isRetryable: true,
        })
      }

      throw this.toLlmError({
        message: "Unable to connect to the Notion AI Chrome CDP target.",
        code: "connection",
        isRetryable: true,
        cause: error,
      })
    }
  }

  private async requestJson<T>(path: string, timeoutMs: number): Promise<T> {
    const response = await withTimeout(
      this.fetchClient(`${this.config.cdpBaseUrl}${path}`, { method: httpGet }),
      timeoutMs,
      timeoutTag,
    )

    if (!response.ok) {
      throw this.toLlmError({
        message: "Chrome CDP discovery endpoint returned an unsuccessful response.",
        code: "connection",
        isRetryable: true,
      })
    }

    return (await response.json()) as T
  }

  private async evaluate<T>(
    session: NotionAiCdpSession,
    expression: string,
    timeoutMs: number,
  ): Promise<T> {
    try {
      return await withTimeout(session.evaluate<T>(expression, timeoutMs), timeoutMs, timeoutTag)
    } catch (error) {
      if (error instanceof ChatbotLlmError) throw error
      if (error === timeoutTag) {
        throw this.toLlmError({
          message: "Notion AI page evaluation timed out.",
          code: "timeout",
          isRetryable: true,
        })
      }

      throw error
    }
  }

  private mapGenerateError(error: unknown): ChatbotLlmError {
    if (error instanceof ChatbotLlmError) return error

    return this.toLlmError({
      message: "Notion AI tier failed with an unknown error.",
      code: "unknown",
      isRetryable: false,
      cause: error,
    })
  }

  private mapInferenceResult(result: Extract<NotionAiInferenceResult, { ok: false }>): ChatbotLlmError {
    return this.toLlmError({
      message: result.message,
      code: result.code,
      isRetryable: result.code !== "auth" && result.code !== "invalid-output",
    })
  }

  private toLlmError(input: {
    message: string
    code: ConstructorParameters<typeof ChatbotLlmError>[0]["code"]
    isRetryable: boolean
    cause?: unknown
  }): ChatbotLlmError {
    return new ChatbotLlmError({
      message: input.message,
      code: input.code,
      tier: this.tier,
      isRetryable: input.isRetryable,
      cause: input.cause,
    })
  }
}

export function createTier1ChromeNotionAiClient(
  overrides: Tier1ChromeNotionAiClientOptions = {},
): Tier1ChromeNotionAiClient {
  return new Tier1ChromeNotionAiClient(overrides)
}

export function buildRunInferencePayload(input: {
  request: ChatbotLlmRequest
  runtimeContext: NotionAiRuntimeContext
  preferredModel?: string
  idFactory: IdFactory
  contextPageId?: string
}): RunInferencePayload {
  const spaceId = input.runtimeContext.spaceId
  const contextPageId = input.contextPageId ?? input.runtimeContext.contextPageId

  if (!spaceId) {
    throw new ChatbotLlmError({
      message: "Notion AI runtime context does not expose a space id.",
      code: "auth",
      tier,
      isRetryable: false,
    })
  }

  const model = resolveModel(input.runtimeContext, input.preferredModel)
  const workflowValue = buildWorkflowValue({
    model,
    modelFromUser: input.runtimeContext.modelFromUser ?? Boolean(input.runtimeContext.selectedModel),
    workflowValue: input.runtimeContext.workflowValue,
  })

  return {
    traceId: input.idFactory(),
    spaceId,
    transcript: [
      { id: input.idFactory(), type: "config", value: workflowValue },
      {
        id: input.idFactory(),
        type: "context",
        value: {
          type: "context",
          currentDatetime: new Date().toISOString(),
          contextPageId,
        },
      },
      {
        id: input.idFactory(),
        type: "user",
        value: {
          type: "text",
          model,
          text: buildUserPrompt(input.request),
        },
      },
    ],
    threadId: input.idFactory(),
    createThread: true,
    debugOverrides: {
      emitAgentSearchExtractedResults: false,
      cachedInferences: [],
      annotationInferences: [],
      emitInferences: true,
    },
    generateTitle: false,
    saveAllThreadOperations: true,
    setUnreadState: false,
    createdSource: defaultCreatedSource,
    threadType: defaultThreadType,
    isPartialTranscript: false,
    asPatchResponse: false,
    hasHeartbeat: false,
    isUserInAnySalesAssistedSpace: false,
    isSpaceSalesAssisted: false,
  }
}

export function buildRunInferenceHeaders(runtimeContext: NotionAiRuntimeContext): RunInferenceHeaders {
  const { spaceId, userId } = runtimeContext

  if (!spaceId || !userId) {
    throw new ChatbotLlmError({
      message: "Notion AI runtime context does not expose space id and user id.",
      code: "auth",
      tier,
      isRetryable: false,
    })
  }

  return {
    Accept: "application/x-ndjson",
    "Content-Type": "application/json",
    "notion-audit-log-platform": "web",
    "notion-client-version": runtimeContext.notionClientVersion ?? defaultNotionClientVersion,
    "x-notion-active-user-header": userId,
    "x-notion-space-id": spaceId,
  }
}

export function buildWorkflowValue(input: {
  model: string
  modelFromUser: boolean
  workflowValue?: Partial<NotionAiWorkflowValue>
}): NotionAiWorkflowValue {
  const workflowValue: NotionAiWorkflowValue = {
    type: "workflow",
    model: input.model,
    isHipaa: false,
    isMobile: false,
    yoloMode: false,
    writerMode: false,
    searchScopes: [],
    useWebSearch: false,
    isCustomAgent: false,
    modelFromUser: input.modelFromUser,
    enableComputer: false,
    enableQueryMail: false,
    useReadOnlyMode: true,
    useSearchToolV2: false,
    enableAgentDiffs: false,
    enableScriptAgent: false,
    isOnboardingAgent: false,
    enableCustomAgents: false,
    availableConnectors: [],
    enableMarkdownVNext: true,
    enableQueryCalendar: false,
    useCustomAgentDraft: false,
    enableAgentAskSurvey: false,
    enableCrdtOperations: false,
    enableDatabaseAgents: false,
    enableScriptAgentGtm: false,
    isCustomAgentBuilder: false,
    useRulePrioritization: false,
    enableAgentAutomations: false,
    enableAgentThreadTools: false,
    enableScriptAgentSlack: false,
    isAgentResearchRequest: false,
    databaseAgentConfigMode: null,
    enableAgentIntegrations: false,
    enableSpeculativeSearch: false,
    use_draft_actor_pointer: false,
    enableAgentGenerateImage: false,
    enableCreateAndRunThread: false,
    enableSystemPromptAsPage: false,
    enableUserSessionContext: false,
    enableScriptAgentAdvanced: false,
    enableSoftwareFactoryPage: false,
    enableUpdatePageAutofixer: false,
    agentShortUpdatePageResult: false,
    enableAgentUpdatePagePatch: false,
    enableCsvAttachmentSupport: false,
    enableMailExplicitToolCalls: false,
    enableScriptAgentMcpServers: false,
    enableAgentCardCustomization: false,
    enableUpdatePageOrderUpdates: false,
    useContextualCoreDocsAutoLoad: false,
    useDocPreviewsForCoreAutoLoad: false,
    enableExperimentalIntegrations: false,
    updatePageStaleViewGuardEnabled: false,
    enableAgentSupportPropertyReorder: false,
    enableMailNotificationPreferences: false,
    showDatabaseAgentsDiscoverability: false,
    enableScriptAgentCustomToolCalling: false,
    enableMailAgentMultiProviderSupport: false,
    enableLargeToolResultComputerOffload: false,
    enableScriptAgentGoogleDriveInCustomAgent: false,
    enableScriptAgentGoogleDriveOAuthInCustomAgent: false,
    enableScriptAgentSearchConnectorsInCustomAgent: false,
    isThreadStartedByAdmin: false,
  }

  return {
    ...workflowValue,
    ...input.workflowValue,
    type: "workflow",
    model: input.model,
    modelFromUser: input.modelFromUser,
  }
}

export function extractAssistantTextFromNdjson(ndjson: string): string {
  return parseInferenceNdjsonStream(ndjson).assistantText
}

export function parseInferenceNdjsonStream(ndjson: string): ParsedInferenceNdjsonStream {
  const chunks = ndjson
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        const raw = JSON.parse(line) as unknown
        return {
          raw,
          isPartialTranscript: isPartialInferenceChunk(raw),
          assistantText: collectText(raw),
        }
      } catch {
        return undefined
      }
    })
    .filter((chunk): chunk is ParsedInferenceNdjsonChunk => Boolean(chunk))

  const partialText = chunks
    .filter((chunk) => chunk.isPartialTranscript)
    .map((chunk) => chunk.assistantText)
    .join(emptyText)
  const finalText = chunks
    .filter((chunk) => !chunk.isPartialTranscript)
    .map((chunk) => chunk.assistantText)
    .filter(Boolean)
    .at(-1) ?? emptyText
  const assistantText = finalText || partialText

  return {
    chunks,
    partialText,
    finalText,
    assistantText,
    chunkCount: chunks.length,
  }
}

function resolveModel(runtimeContext: NotionAiRuntimeContext, preferredModel?: string): string {
  const availableModels = runtimeContext.availableModels
  const selectedModel = preferredModel ?? observedNotionAiModel

  if (availableModels && !modelIsAvailable(selectedModel, availableModels)) {
    throw new ChatbotLlmError({
      message: "Preferred Notion AI model is not available in the current page context.",
      code: "connection",
      tier,
      isRetryable: true,
    })
  }

  if (selectedModel) return selectedModel

  throw new ChatbotLlmError({
    message: "Notion AI page did not expose a current model selection.",
    code: "connection",
    tier,
    isRetryable: true,
  })
}

function modelIsAvailable(model: string, availableModels?: string[]): boolean {
  return !availableModels || availableModels.includes(model)
}

function buildUserPrompt(request: ChatbotLlmRequest): string {
  return [
    request.systemPrompt,
    ...request.messages.map((message) => `${message.role}: ${message.content}`),
    request.latestUserMessage ? `user: ${request.latestUserMessage}` : undefined,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n")
}

function findNotionAiTarget(
  targets: CdpTargetsResponse,
  targetUrlIncludes: string,
): NotionAiCdpTarget | undefined {
  return targets.find((target) => {
    const url = target.url ?? emptyText
    return (
      target.type === targetTypePage &&
      url.includes(targetUrlIncludes) &&
      (url.includes("/ai") || url.includes("/chat"))
    )
  })
}

function findNotionLoginTarget(
  targets: CdpTargetsResponse,
  targetUrlIncludes: string,
): NotionAiCdpTarget | undefined {
  return targets.find((target) => {
    const url = target.url ?? emptyText
    return target.type === targetTypePage && url.includes(targetUrlIncludes) && url.includes("/login")
  })
}

function buildRunInferenceExpression(payload: RunInferencePayload, headers: RunInferenceHeaders): string {
  return `(${runInferenceInPage.toString()})(${JSON.stringify({ payload, headers })})`
}

function collectText(value: unknown): string {
  if (typeof value === "string") return value
  if (!value || typeof value !== "object") return emptyText

  if (Array.isArray(value)) {
    return value.map((entry) => collectText(entry)).join(emptyText)
  }

  const record = value as Record<string, unknown>
  const directText = record.text ?? record.content ?? record.plainText ?? record.markdown ?? record.delta
  if (typeof directText === "string") return directText

  return [
    record.message,
    record.value,
    record.result,
    record.output,
    record.assistant,
    record.response,
    record.data,
  ]
    .map((entry) => collectText(entry))
    .join(emptyText)
}

function isPartialInferenceChunk(value: unknown): boolean {
  if (!value || typeof value !== "object") return false
  const record = value as Record<string, unknown>
  return record.isPartialTranscript === true || record.type === "partial"
}

const runtimeContextExpression = `(() => {
  const root = globalThis;
  const explicit = root.__notionAiChatbotRuntimeContext;
  if (explicit && typeof explicit === "object") return explicit;

  const readStorage = (key) => {
    try {
      const value = localStorage.getItem(key);
      if (typeof value !== "string" || value.length === 0) return undefined;
      try {
        const parsed = JSON.parse(value);
        if (parsed && typeof parsed === "object" && typeof parsed.value === "string") {
          return parsed.value;
        }
      } catch {}
      return value;
    } catch {
      return undefined;
    }
  };
  const readMeta = (name) => {
    const element =
      document.querySelector(\`meta[name="\${name}"]\`) ||
      document.querySelector(\`meta[property="\${name}"]\`);
    const content = element && element.getAttribute("content");
    return typeof content === "string" && content.length > 0 ? content : undefined;
  };
  const buildId =
    typeof root.__NOTION_BUILD_ID__ === "string" && root.__NOTION_BUILD_ID__.length > 0
      ? root.__NOTION_BUILD_ID__
      : undefined;

  return {
    spaceId: root.__notionAiSpaceId || readStorage("LRU:KeyValueStore2:lastVisitedRouteSpaceId"),
    userId: root.__notionAiUserId || readStorage("LRU:KeyValueStore2:lastVisitedRouteUserId"),
    notionClientVersion: root.__notionClientVersion || buildId || readMeta("notion-client-version"),
    contextPageId: root.__notionAiContextPageId,
    selectedModel: root.__notionAiSelectedModel || "${observedNotionAiModel}",
    finalModelName: root.__notionAiFinalModelName,
    availableModels: Array.isArray(root.__notionAiAvailableModels) ? root.__notionAiAvailableModels : undefined,
    modelFromUser: true,
    workflowValue: root.__notionAiWorkflowValue,
  };
})()`

async function runInferenceInPage(input: {
  payload: RunInferencePayload
  headers: RunInferenceHeaders
}): Promise<NotionAiInferenceResult> {
  const endpoint = "/api/v3/runInferenceTranscript"
  const { payload, headers } = input
  const collectTextInPage = (value: unknown): string => {
    if (typeof value === "string") return value
    if (!value || typeof value !== "object") return ""

    if (Array.isArray(value)) {
      return value.map((entry) => collectTextInPage(entry)).join("")
    }

    const record = value as Record<string, unknown>
    const directText = record.text ?? record.content ?? record.plainText ?? record.markdown ?? record.delta
    if (typeof directText === "string") return directText

    return [
      record.message,
      record.value,
      record.result,
      record.output,
      record.assistant,
      record.response,
      record.data,
    ]
      .map((entry) => collectTextInPage(entry))
      .join("")
  }
  const parseLine = (line: string): { isPartialTranscript: boolean; text: string } => {
    try {
      const raw = JSON.parse(line) as Record<string, unknown>
      return {
        isPartialTranscript: raw.isPartialTranscript === true || raw.type === "partial",
        text: collectTextInPage(raw),
      }
    } catch {
      return { isPartialTranscript: false, text: "" }
    }
  }

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      credentials: "include",
      headers,
      body: JSON.stringify(payload),
    })

    if (response.status === 401 || response.status === 403) {
      return {
        ok: false,
        status: response.status,
        code: "auth",
        message: "Notion AI request was rejected by auth.",
      }
    }

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        code: "unknown",
        message: "Notion AI request returned an unsuccessful response.",
      }
    }

    if (!response.body) {
      return {
        ok: false,
        code: "invalid-output",
        message: "Notion AI response did not expose a readable NDJSON body.",
      }
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let pending = ""
    let partialText = ""
    let finalText = ""
    let chunkCount = 0

    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break

      pending += decoder.decode(chunk.value, { stream: true })
      const lines = pending.split("\n")
      pending = lines.pop() ?? ""

      for (const line of lines) {
        const parsed = parseLine(line)
        if (parsed.text) {
          if (parsed.isPartialTranscript) partialText += parsed.text
          else finalText = parsed.text
        }
        chunkCount += 1
      }
    }

    const flushed = decoder.decode()
    if (flushed) pending += flushed
    if (pending.trim()) {
      const parsed = parseLine(pending)
      if (parsed.text) {
        if (parsed.isPartialTranscript) partialText += parsed.text
        else finalText = parsed.text
      }
      chunkCount += 1
    }

    return { ok: true, rawText: finalText || partialText, chunkCount }
  } catch (error) {
    return {
      ok: false,
      code: "unknown",
      message: error instanceof Error ? error.message : "Notion AI request failed.",
    }
  }
}

function globalFetch(input: string, init?: RequestInit): Promise<Response> {
  return fetch(input, init)
}

function randomId(): string {
  return crypto.randomUUID()
}

function createDefaultCdpSession(target: NotionAiCdpTarget): Promise<NotionAiCdpSession> {
  if (!target.webSocketDebuggerUrl) {
    return Promise.reject(new Error("CDP target does not expose webSocketDebuggerUrl."))
  }

  return DefaultCdpSession.connect(target.webSocketDebuggerUrl)
}

class DefaultCdpSession implements NotionAiCdpSession {
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

  static connect(url: string): Promise<DefaultCdpSession> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url)
      socket.addEventListener("open", () => resolve(new DefaultCdpSession(socket)), { once: true })
      socket.addEventListener("error", () => reject(new Error("CDP socket connection failed.")), {
        once: true,
      })
    })
  }

  async evaluate<T>(expression: string, timeoutMs: number): Promise<T> {
    const result = await this.send<RuntimeEvaluateResult<T>>("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      timeout: timeoutMs,
    })

    if (result.exceptionDetails) {
      throw new Error("Notion AI page evaluation raised an exception.")
    }

    return result.result?.value as T
  }

  async close(): Promise<void> {
    this.socket.close()
  }

  private send<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const id = this.nextId
    this.nextId += 1

    const promise = new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value: unknown) => resolve(value as T),
        reject,
      })
    })

    this.socket.send(JSON.stringify({ id, method, params }))
    return promise
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, tag: TimeoutTag): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(tag), timeoutMs)

    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}
