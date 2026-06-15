import type { ChatbotLlmClient, ChatbotLlmRequest, ChatbotLlmResponse } from "@/lib/chatbot/server/llm-client"
import { ChatbotLlmError } from "@/lib/chatbot/server/llm-client"
import { getNotionAiChatbotThreadUrl } from "@/lib/chatbot/server/llm-clients/tier1-chrome-notion-ai-config"

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
  threadId?: string
  selectedModel?: string
  finalModelName?: string
  availableModels?: string[]
  modelFromUser?: boolean
  workflowValue?: Partial<NotionAiWorkflowValue>
}

export type NotionAiRuntimeInspection = {
  targetUrl?: string
  selectedModel?: string
  finalModelName?: string
  availableModels?: string[]
  preferredModelAvailable: boolean
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
  databaseAgentConfigMode: string | boolean | null
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
  useContextualCoreDocsAutoLoad?: boolean
  useDocPreviewsForCoreAutoLoad?: boolean
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
  isThreadStartedByAdmin?: boolean
}

type RunInferencePayload = {
  traceId: string
  spaceId: string
  transcript: Array<{ id: string; type: string; value: unknown; userId?: string; createdAt?: string }>
  threadId: string
  createThread: boolean
  debugOverrides: {
    emitAgentSearchExtractedResults: boolean
    cachedInferences: unknown[] | Record<string, never>
    annotationInferences: unknown[] | Record<string, never>
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

type RunInferenceContextValue = {
  userId?: string
  spaceId: string
  surface: string
  timezone: string
  context_page_id?: string
  currentDatetime: string
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
  | {
      ok: true
      rawText: string
      chunkCount: number
      postDataBytes: number
      responseBytes: number
      responseContentType: string
      responseHeaders: Record<string, string>
      parsedPartial: boolean
      parsedFinal: boolean
    }
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
export const tier1ObservedNotionAiModel = "apricot-sorbet-high"
const defaultCreatedSource = "assistant"
const defaultThreadType = "workflow"
const defaultNotionClientVersion = "unknown"
const emptyText = ""

export const tier1ChromeNotionAiDefaults = {
  cdpBaseUrl: "http://127.0.0.1:9223",
  targetUrlIncludes: getNotionAiChatbotThreadUrl(),
  requestTimeoutMs: 180000,
  healthCheckTimeoutMs: 3000,
} as const

export class Tier1ChromeNotionAiClient implements ChatbotLlmClient {
  readonly tier = tier
  private readonly config: Tier1ChromeNotionAiClientConfig
  private readonly fetchClient: CdpFetchClient
  private readonly sessionFactory: NotionAiCdpSessionFactory
  private readonly idFactory: IdFactory
  private lastHealthError?: ChatbotLlmError | Error

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
    const { session, target } = await this.openTargetSession(this.config.requestTimeoutMs)

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
        diagnostics: {
          endpoint: "/api/v3/runInferenceTranscript",
          contentType: result.responseContentType,
          responseHeaders: result.responseHeaders,
          postDataBytes: result.postDataBytes,
          responseBytes: result.responseBytes,
          ndjsonPartialParsed: result.parsedPartial,
          ndjsonFinalParsed: result.parsedFinal,
          chunkCount: result.chunkCount,
          attachTargetUrl: target.url,
          attachTargetUrlMatches: isNotionAiChatbotTargetUrl(target.url, this.config.targetUrlIncludes),
        },
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
      this.lastHealthError = undefined
      const opened = await this.openTargetSession(this.config.healthCheckTimeoutMs)
      session = opened.session
      const runtimeContext = await this.evaluate<NotionAiRuntimeContext>(
        session,
        runtimeContextExpression,
        this.config.healthCheckTimeoutMs,
      )

      if (!runtimeContext.spaceId) {
        this.lastHealthError = this.toLlmError({
          message: "Notion AI runtime context does not expose a space id.",
          code: "auth",
          isRetryable: false,
        })
        return false
      }
      if (!this.config.preferredModel) return true

      const modelAvailable = modelIsAvailable(this.config.preferredModel, runtimeContext.availableModels)
      if (!modelAvailable) {
        this.lastHealthError = this.toLlmError({
          message: "Preferred Notion AI model is not available in the current page context.",
          code: "connection",
          isRetryable: true,
        })
      }
      return modelAvailable
    } catch (error) {
      this.lastHealthError = error instanceof Error ? error : this.mapGenerateError(error)
      return false
    } finally {
      await session?.close()
    }
  }

  getLastHealthError(): ChatbotLlmError | Error | undefined {
    return this.lastHealthError
  }

  async inspectRuntimeContext(): Promise<NotionAiRuntimeInspection> {
    const { session, target } = await this.openTargetSession(this.config.healthCheckTimeoutMs)

    try {
      const runtimeContext = await this.evaluate<NotionAiRuntimeContext>(
        session,
        runtimeContextExpression,
        this.config.healthCheckTimeoutMs,
      )
      const preferredModel = this.config.preferredModel ?? tier1ObservedNotionAiModel

      return {
        targetUrl: target.url,
        selectedModel: runtimeContext.selectedModel,
        finalModelName: runtimeContext.finalModelName,
        availableModels: runtimeContext.availableModels,
        preferredModelAvailable: modelIsAvailable(preferredModel, runtimeContext.availableModels),
      }
    } finally {
      await session.close()
    }
  }

  private async openTargetSession(
    timeoutMs: number,
  ): Promise<{ session: NotionAiCdpSession; target: NotionAiCdpTarget }> {
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

      assertNotionAiChatbotTargetUrl(target.url, this.config.targetUrlIncludes)

      return {
        session: await withTimeout(this.sessionFactory(target), timeoutMs, timeoutTag),
        target,
      }
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
  const currentDatetime = new Date().toISOString()
  const threadId = input.runtimeContext.threadId ?? input.idFactory()

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
        value: buildContextValue({
          spaceId,
          userId: input.runtimeContext.userId,
          contextPageId,
          currentDatetime,
        }),
      },
      {
        id: input.idFactory(),
        type: "user",
        value: [[buildUserPrompt(input.request)]],
        userId: input.runtimeContext.userId,
        createdAt: currentDatetime,
      },
    ],
    threadId,
    createThread: !input.runtimeContext.threadId,
    debugOverrides: {
      emitAgentSearchExtractedResults: true,
      cachedInferences: {},
      annotationInferences: {},
      emitInferences: false,
    },
    generateTitle: false,
    saveAllThreadOperations: true,
    setUnreadState: true,
    createdSource: input.runtimeContext.threadId ? "workflows" : defaultCreatedSource,
    threadType: defaultThreadType,
    isPartialTranscript: Boolean(input.runtimeContext.threadId),
    asPatchResponse: Boolean(input.runtimeContext.threadId),
    hasHeartbeat: false,
    isUserInAnySalesAssistedSpace: false,
    isSpaceSalesAssisted: false,
  }
}

function buildContextValue(input: {
  spaceId: string
  userId?: string
  contextPageId?: string
  currentDatetime: string
}): RunInferenceContextValue {
  return {
    userId: input.userId,
    spaceId: input.spaceId,
    surface: "full_page_chat",
    timezone: "Asia/Tokyo",
    context_page_id: input.contextPageId,
    currentDatetime: input.currentDatetime,
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
    searchScopes: [{ type: "everything" }],
    useWebSearch: true,
    isCustomAgent: false,
    modelFromUser: input.modelFromUser,
    enableComputer: false,
    enableQueryMail: false,
    useReadOnlyMode: false,
    useSearchToolV2: false,
    enableAgentDiffs: false,
    enableScriptAgent: false,
    isOnboardingAgent: false,
    enableCustomAgents: false,
    availableConnectors: ["slack"],
    enableMarkdownVNext: false,
    enableQueryCalendar: false,
    useCustomAgentDraft: false,
    enableAgentAskSurvey: false,
    enableCrdtOperations: false,
    enableDatabaseAgents: false,
    enableScriptAgentGtm: false,
    isCustomAgentBuilder: false,
    useRulePrioritization: true,
    enableAgentAutomations: false,
    enableAgentThreadTools: false,
    enableScriptAgentSlack: false,
    isAgentResearchRequest: false,
    databaseAgentConfigMode: false,
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
    enableCsvAttachmentSupport: true,
    enableMailExplicitToolCalls: false,
    enableScriptAgentMcpServers: false,
    enableAgentCardCustomization: false,
    enableUpdatePageOrderUpdates: false,
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
  const selectedModel = preferredModel ?? tier1ObservedNotionAiModel

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
  const configuredTarget = targets.find((target) => {
    return target.type === targetTypePage && isConfiguredNotionAiChatTargetUrl(target.url, targetUrlIncludes)
  })
  const runtimeTarget = targets.find((target) => {
    return target.type === targetTypePage && isNotionAiRuntimeTargetUrl(target.url)
  })

  return configuredTarget && runtimeTarget ? runtimeTarget : configuredTarget
}

export function isNotionAiChatbotTargetUrl(url: string | undefined, targetUrlIncludes: string): boolean {
  if (isExpectedChatTargetUrl(targetUrlIncludes) && isNotionAiRuntimeTargetUrl(url)) return true

  return isConfiguredNotionAiChatTargetUrl(url, targetUrlIncludes)
}

function isConfiguredNotionAiChatTargetUrl(url: string | undefined, targetUrlIncludes: string): boolean {
  if (!url) return false
  const expected = targetUrlIncludes.trim()
  if (!expected) return false
  if (!(url.includes("/ai") || url.includes("/chat"))) return false
  if (url.includes(expected)) return true

  try {
    const actualUrl = new URL(url)
    const expectedUrl = new URL(expected)
    const actualThreadId = actualUrl.searchParams.get("t")
    const expectedThreadId = expectedUrl.searchParams.get("t")

    return Boolean(expectedThreadId && actualThreadId === expectedThreadId)
  } catch {
    return url.includes(expected)
  }
}

function isExpectedChatTargetUrl(targetUrlIncludes: string): boolean {
  try {
    const expectedUrl = new URL(targetUrlIncludes.trim())
    return expectedUrl.pathname.includes("/chat") && Boolean(expectedUrl.searchParams.get("t"))
  } catch {
    return targetUrlIncludes.includes("/chat")
  }
}

function isNotionAiRuntimeTargetUrl(url: string | undefined): boolean {
  if (!url) return false

  try {
    const parsed = new URL(url)
    return parsed.hostname === "app.notion.com" && parsed.pathname === "/ai"
  } catch {
    return url.includes("app.notion.com/ai")
  }
}

export function assertNotionAiChatbotTargetUrl(
  url: string | undefined,
  targetUrlIncludes: string,
): void {
  if (isNotionAiChatbotTargetUrl(url, targetUrlIncludes)) return

  throw new ChatbotLlmError({
    message: "Notion AI target URL does not match the configured chatbot-only thread.",
    code: "connection",
    tier,
    isRetryable: true,
  })
}

function findNotionLoginTarget(
  targets: CdpTargetsResponse,
  targetUrlIncludes: string,
): NotionAiCdpTarget | undefined {
  void targetUrlIncludes
  return targets.find((target) => {
    const url = target.url ?? emptyText
    return target.type === targetTypePage && url.includes("notion.so") && url.includes("/login")
  })
}

function buildRunInferenceExpression(payload: RunInferencePayload, headers: RunInferenceHeaders): string {
  return `(() => { const __name = (target) => target; return (${runInferenceInPage.toString()})(${JSON.stringify({ payload, headers })}); })()`
}

function collectText(value: unknown): string {
  if (typeof value === "string") return value
  if (!value || typeof value !== "object") return emptyText

  if (Array.isArray(value)) {
    return value.map((entry) => collectText(entry)).join(emptyText)
  }

  const record = value as Record<string, unknown>
  const agentInferenceText = collectAgentInferenceText(record)
  if (agentInferenceText) return agentInferenceText

  const directText = record.text ?? record.content ?? record.plainText ?? record.markdown ?? record.delta
  if (typeof directText === "string") return directText

  return [
    record.v,
    record.message,
    record.value,
    record.result,
    record.output,
    record.assistant,
    record.response,
    record.data,
    record.recordMap,
    record.step,
  ]
    .map((entry) => collectText(entry))
    .join(emptyText)
}

function isPartialInferenceChunk(value: unknown): boolean {
  if (!value || typeof value !== "object") return false
  const record = value as Record<string, unknown>
  return record.isPartialTranscript === true || record.type === "partial" || record.type === "patch"
}

function collectAgentInferenceText(value: unknown): string {
  if (!value || typeof value !== "object") return emptyText

  if (Array.isArray(value)) {
    return value.map((entry) => collectAgentInferenceText(entry)).join(emptyText)
  }

  const record = value as Record<string, unknown>
  if (record.type === "agent-inference" && Array.isArray(record.value)) {
    return record.value
      .map((entry) => {
        if (!entry || typeof entry !== "object") return emptyText
        const item = entry as Record<string, unknown>
        return item.type === "text" && typeof item.content === "string" ? item.content : emptyText
      })
      .join(emptyText)
  }

  return Object.values(record)
    .map((entry) => collectAgentInferenceText(entry))
    .join(emptyText)
}

const runtimeContextExpression = `(() => (async () => {
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
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const uuidGlobalPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
  const isUuid = (value) => typeof value === "string" && uuidPattern.test(value);
  const objectKeys = (value) => value && typeof value === "object" ? Object.keys(value) : [];
  const readJson = (raw) => {
    try {
      return typeof raw === "string" && raw.length > 0 ? JSON.parse(raw) : undefined;
    } catch {
      return undefined;
    }
  };
  const readCurrentUserId = () => {
    const explicitUserId = readStorage("LRU:KeyValueStore2:lastVisitedRouteUserId") || readStorage("LRU:KeyValueStore2:current-user-id");
    return isUuid(explicitUserId) ? explicitUserId : undefined;
  };
  const readSpaceIdFromStorage = (userId) => {
    try {
      const explicitSpaceId = readStorage("LRU:KeyValueStore2:lastVisitedRouteSpaceId");
      if (isUuid(explicitSpaceId)) return explicitSpaceId;

      const spaceIdToShortId = readJson(localStorage.getItem("LRU:KeyValueStore2:spaceIdToShortId"));
      const spaceIdToShortIdValue = spaceIdToShortId && typeof spaceIdToShortId === "object" && spaceIdToShortId.value
        ? spaceIdToShortId.value
        : spaceIdToShortId;
      const storedSpaceId = objectKeys(spaceIdToShortIdValue).find((id) => isUuid(id) && id !== userId);
      if (storedSpaceId) return storedSpaceId;

      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index) || "";
        const matches = key.match(uuidGlobalPattern) || [];
        const candidate = matches.find((id) => isUuid(id) && id !== userId);
        if (candidate) return candidate;
      }
    } catch {
      return undefined;
    }
    return undefined;
  };
  const readContextFromGetSpaces = async () => {
    try {
      const response = await fetch("/api/v3/getSpaces", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      if (!response.ok) return {};
      const spaces = await response.json();
      if (!spaces || typeof spaces !== "object") return {};
      const topLevelUserId = objectKeys(spaces).find(isUuid);
      const firstRecord = topLevelUserId ? spaces[topLevelUserId] : Object.values(spaces).find((entry) => entry && typeof entry === "object");
      if (!firstRecord || typeof firstRecord !== "object") return { userId: topLevelUserId };

      const notionUser = firstRecord.notion_user;
      const userId = objectKeys(notionUser).find(isUuid) || topLevelUserId;
      const space = firstRecord.space;
      const directSpaceId = objectKeys(space).find(isUuid);
      if (directSpaceId) return { spaceId: directSpaceId, userId };

      const spaceView = firstRecord.space_view;
      for (const entry of Object.values(spaceView || {})) {
        const value = entry && typeof entry === "object" ? entry.value : undefined;
        const spaceId = value && typeof value === "object" && isUuid(value.space_id) ? value.space_id : undefined;
        if (spaceId) return { spaceId, userId };
      }
      return { userId };
    } catch {
      return {};
    }
  };
  const readNotionAiContextPageId = () => {
    try {
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index) || "";
        if (!key.includes("sidebarSection:itemStores") || !key.endsWith(":private")) continue;
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        const items = Array.isArray(parsed && parsed.value) ? parsed.value : [];
        const match = items.find((item) => {
          const title = item && Array.isArray(item.title) ? item.title.flat(Infinity).join("") : "";
          return title === "Notion AI";
        });
        const id = match && match.pointer && match.pointer.id;
        if (typeof id === "string" && id.length > 0) return id;
      }
    } catch {}
    return undefined;
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
  const threadId = (() => {
    try {
      const value = new URL(location.href).searchParams.get("t");
      if (!value) return undefined;
      if (/^[0-9a-f]{32}$/i.test(value)) {
        return value.slice(0, 8) + "-" + value.slice(8, 12) + "-" + value.slice(12, 16) + "-" + value.slice(16, 20) + "-" + value.slice(20);
      }
      return value.length > 0 ? value : undefined;
    } catch {
      return undefined;
    }
  })();

  const apiContext = await readContextFromGetSpaces();
  const userId = root.__notionAiUserId || readCurrentUserId() || apiContext.userId;
  const spaceId = root.__notionAiSpaceId || readSpaceIdFromStorage(userId) || apiContext.spaceId;

  return {
    spaceId,
    userId,
    notionClientVersion: root.__notionClientVersion || buildId || readMeta("notion-client-version"),
    contextPageId: root.__notionAiContextPageId || readNotionAiContextPageId(),
    threadId,
    selectedModel: root.__notionAiSelectedModel || "${tier1ObservedNotionAiModel}",
    finalModelName: root.__notionAiFinalModelName,
    availableModels: Array.isArray(root.__notionAiAvailableModels) ? root.__notionAiAvailableModels : undefined,
    modelFromUser: true,
    workflowValue: root.__notionAiWorkflowValue,
  };
})())()`

async function runInferenceInPage(input: {
  payload: RunInferencePayload
  headers: RunInferenceHeaders
}): Promise<NotionAiInferenceResult> {
  const endpoint = "/api/v3/runInferenceTranscript"
  const { payload, headers } = input
  const collectAgentInferenceTextInPage = (value: unknown): string => {
    if (!value || typeof value !== "object") return ""

    if (Array.isArray(value)) {
      return value.map((entry) => collectAgentInferenceTextInPage(entry)).join("")
    }

    const record = value as Record<string, unknown>
    if (record.type === "agent-inference" && Array.isArray(record.value)) {
      return record.value
        .map((entry) => {
          if (!entry || typeof entry !== "object") return ""
          const item = entry as Record<string, unknown>
          return item.type === "text" && typeof item.content === "string" ? item.content : ""
        })
        .join("")
    }

    return Object.values(record)
      .map((entry) => collectAgentInferenceTextInPage(entry))
      .join("")
  }
  const collectTextInPage = (value: unknown): string => {
    if (typeof value === "string") return value
    if (!value || typeof value !== "object") return ""

    if (Array.isArray(value)) {
      return value.map((entry) => collectTextInPage(entry)).join("")
    }

    const record = value as Record<string, unknown>
    const agentInferenceText = collectAgentInferenceTextInPage(record)
    if (agentInferenceText) return agentInferenceText

    const directText = record.text ?? record.content ?? record.plainText ?? record.markdown ?? record.delta
    if (typeof directText === "string") return directText

    return [
      record.v,
      record.message,
      record.value,
      record.result,
      record.output,
      record.assistant,
      record.response,
      record.data,
      record.recordMap,
      record.step,
    ]
      .map((entry) => collectTextInPage(entry))
      .join("")
  }
  const extractResponseTextInPage = (value: unknown): string => {
    const chunks: string[] = []
    const visit = (entry: unknown): void => {
      if (!entry || typeof entry !== "object") return
      if (Array.isArray(entry)) {
        entry.forEach(visit)
        return
      }

      const record = entry as Record<string, unknown>
      if (record.type === "text" && typeof record.content === "string") {
        chunks.push(record.content)
        return
      }
      if (record.type === "agent-inference" && Array.isArray(record.value)) {
        record.value.forEach(visit)
        return
      }
      if (
        typeof record.p === "string" &&
        record.p.includes("/content") &&
        typeof record.v === "string"
      ) {
        chunks.push(record.v)
        return
      }

      Object.values(record).forEach(visit)
    }
    visit(value)
    return chunks.join("")
  }
  const parseLine = (line: string): { isPartialTranscript: boolean; text: string } => {
    try {
      const raw = JSON.parse(line) as Record<string, unknown>
      const responseText = extractResponseTextInPage(raw)
      return {
        isPartialTranscript:
          raw.isPartialTranscript === true || raw.type === "partial" || raw.type === "patch",
        text: responseText || collectTextInPage(raw),
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
    const postDataBytes = JSON.stringify(payload).length
    const responseContentType = response.headers.get("content-type") ?? ""
    const responseHeaders = Object.fromEntries(response.headers.entries())

    if (response.status === 401 || response.status === 403) {
      const errorText = await response.text().catch(() => "")
      return {
        ok: false,
        status: response.status,
        code: "auth",
        message: `Notion AI request was rejected by auth. ${errorText}`.trim(),
      }
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => "")
      return {
        ok: false,
        status: response.status,
        code: "unknown",
        message: `Notion AI request returned ${response.status}. ${errorText}`.trim(),
      }
    }

    const responseText = await response.text()
    const responseBytes = responseText.length
    let partialText = ""
    let finalText = ""
    let chunkCount = 0

    for (const line of responseText
      .split("\n")
      .map((entry) => entry.trim())
      .filter(Boolean)) {
      const parsed = parseLine(line)
      if (parsed.text) {
        if (parsed.isPartialTranscript) partialText += parsed.text
        else finalText = parsed.text
      }
      chunkCount += 1
    }

    const rawText = finalText || partialText
    if (!rawText) {
      return {
        ok: false,
        code: "invalid-output",
        message: `Notion AI response text could not be extracted. bytes=${responseText.length} preview=${responseText.slice(0, 300)}`,
      }
    }

    return {
      ok: true,
      rawText,
      chunkCount,
      postDataBytes,
      responseBytes,
      responseContentType,
      responseHeaders,
      parsedPartial: partialText.length > 0,
      parsedFinal: finalText.length > 0,
    }
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
      throw new Error(`Notion AI page evaluation raised an exception: ${JSON.stringify(result.exceptionDetails)}`)
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
