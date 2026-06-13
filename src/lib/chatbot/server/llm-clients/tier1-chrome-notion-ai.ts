import { spawn } from "node:child_process"
import { homedir, platform } from "node:os"
import path from "node:path"

import type { ChatbotLlmClient, ChatbotLlmRequest, ChatbotLlmResponse } from "@/lib/chatbot/server/llm-client"
import { ChatbotLlmError } from "@/lib/chatbot/server/llm-client"
import { getNotionAiChatbotThreadUrl } from "@/lib/chatbot/server/llm-clients/tier1-chrome-notion-ai-config"

type Tier1ChromeNotionAiClientConfig = {
  cdpBaseUrl: string
  targetUrlIncludes: string
  connectTimeoutMs: number
  requestTimeoutMs: number
  healthCheckTimeoutMs: number
  preferredModel?: string
  preferredModels: ReadonlyArray<string>
  chromeProfileDir: string
  chromeCommand?: string
  chromeApp: string
  chromeWaitMs: number
}

type Tier1ChromeNotionAiClientOptions = Partial<Tier1ChromeNotionAiClientConfig> & {
  fetchClient?: CdpFetchClient
  sessionFactory?: NotionAiCdpSessionFactory
  idFactory?: IdFactory
  chromeLauncher?: Tier1ChromeLauncher
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
type Tier1ChromeLauncher = (config: Tier1ChromeNotionAiClientConfig) => Promise<void>

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
  threadParentPointer?: NotionAiPointer
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

type NotionAiPointer = {
  table: string
  id: string
  spaceId: string
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

type NotionAiModelFallback = {
  model: string
  errorCode: string
  reason: string
}

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

type JsonContainer = Record<string, unknown> | unknown[]
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
// Notion's runInferenceTranscript API expects internal codenames for picker labels.
export const tier1Fabre5HighNotionAiModel = "apricot-sorbet-high"
export const tier1Gpt55NotionAiModel = "opal-quince-medium"
export const tier1Opus48NotionAiModel = "ambrosia-tart-high"
export const tier1NotionAiModelFallbackChain = [
  tier1Fabre5HighNotionAiModel,
  tier1Gpt55NotionAiModel,
  tier1Opus48NotionAiModel,
] as const
export const tier1ObservedNotionAiModel = tier1Fabre5HighNotionAiModel
const defaultCreatedSource = "assistant"
const defaultThreadType = "workflow"
const defaultNotionClientVersion = "unknown"
const emptyText = ""
const defaultChromeApp = "Google Chrome"
const defaultChromeWaitMs = 30000
const historyCompressionThreshold = 16
const recentVerbatimMessageCount = 6
const compressedHistoryMaxItems = 5
const compressedHistoryExcerptMaxChars = 48

export const tier1ChromeNotionAiDefaults = {
  cdpBaseUrl: "http://127.0.0.1:9223",
  targetUrlIncludes: getNotionAiChatbotThreadUrl(),
  connectTimeoutMs: 10000,
  requestTimeoutMs: 180000,
  healthCheckTimeoutMs: 3000,
  chromeProfileDir: path.join(homedir(), ".chrome-cdp-profile-chatbot"),
  chromeApp: defaultChromeApp,
  chromeWaitMs: defaultChromeWaitMs,
} as const

export class Tier1ChromeNotionAiClient implements ChatbotLlmClient {
  readonly tier = tier
  private readonly config: Tier1ChromeNotionAiClientConfig
  private readonly fetchClient: CdpFetchClient
  private readonly sessionFactory: NotionAiCdpSessionFactory
  private readonly idFactory: IdFactory
  private readonly chromeLauncher: Tier1ChromeLauncher
  private lastHealthError?: ChatbotLlmError | Error

  constructor(options: Tier1ChromeNotionAiClientOptions = {}) {
    this.config = {
      cdpBaseUrl: options.cdpBaseUrl ?? tier1ChromeNotionAiDefaults.cdpBaseUrl,
      targetUrlIncludes: options.targetUrlIncludes ?? tier1ChromeNotionAiDefaults.targetUrlIncludes,
      connectTimeoutMs: options.connectTimeoutMs ?? tier1ChromeNotionAiDefaults.connectTimeoutMs,
      requestTimeoutMs: options.requestTimeoutMs ?? tier1ChromeNotionAiDefaults.requestTimeoutMs,
      healthCheckTimeoutMs:
        options.healthCheckTimeoutMs ?? tier1ChromeNotionAiDefaults.healthCheckTimeoutMs,
      preferredModel: options.preferredModel,
      preferredModels: normalizePreferredModels(options.preferredModels, options.preferredModel),
      chromeProfileDir: options.chromeProfileDir ?? tier1ChromeNotionAiDefaults.chromeProfileDir,
      chromeCommand: options.chromeCommand,
      chromeApp: options.chromeApp ?? tier1ChromeNotionAiDefaults.chromeApp,
      chromeWaitMs: options.chromeWaitMs ?? tier1ChromeNotionAiDefaults.chromeWaitMs,
    }
    this.fetchClient = options.fetchClient ?? globalFetch
    this.sessionFactory = options.sessionFactory ?? createDefaultCdpSession
    this.idFactory = options.idFactory ?? randomId
    this.chromeLauncher = options.chromeLauncher ?? launchTier1Chrome
  }

  async generate(request: ChatbotLlmRequest): Promise<ChatbotLlmResponse> {
    const startedAt = Date.now()
    const { session, target } = await this.openTargetSession(this.config.connectTimeoutMs)

    try {
      const runtimeContext = await this.evaluate<NotionAiRuntimeContext>(
        session,
        runtimeContextExpression,
        this.config.connectTimeoutMs,
      )
      const headers = buildRunInferenceHeaders(runtimeContext)
      const modelFallbacks: NotionAiModelFallback[] = []
      let lastModelError: ChatbotLlmError | undefined

      for (const preferredModel of this.config.preferredModels) {
        try {
          return await this.generateWithModel({
            request,
            runtimeContext,
            headers,
            session,
            target,
            startedAt,
            preferredModel,
            modelFallbacks,
          })
        } catch (error) {
          const normalizedError = this.mapGenerateError(error)
          lastModelError = normalizedError
          if (!shouldTryNextNotionAiModel(normalizedError, preferredModel, this.config.preferredModels)) {
            throw normalizedError
          }
          modelFallbacks.push({
            model: preferredModel,
            errorCode: normalizedError.code,
            reason: normalizedError.message,
          })
        }
      }

      throw lastModelError ?? this.toLlmError({
        message: "No Notion AI model completed successfully.",
        code: "unknown",
        isRetryable: false,
      })
    } catch (error) {
      throw this.mapGenerateError(error)
    } finally {
      await session.close()
    }
  }

  private async generateWithModel(input: {
    request: ChatbotLlmRequest
    runtimeContext: NotionAiRuntimeContext
    headers: RunInferenceHeaders
    session: NotionAiCdpSession
    target: NotionAiCdpTarget
    startedAt: number
    preferredModel: string
    modelFallbacks: ReadonlyArray<NotionAiModelFallback>
  }): Promise<ChatbotLlmResponse> {
      const { request, runtimeContext, headers, session, target, startedAt, preferredModel } = input
      let effectiveRequest = request
      let createdDedicatedThreadStats:
        | {
            threadId: string
            postDataBytes: number
            responseBytes: number
          }
        | undefined
      let payload = buildRunInferencePayload({
        request,
        runtimeContext,
        preferredModel,
        idFactory: this.idFactory,
      })
      let notionAiThreadFallbackReason: string | undefined
      let result: NotionAiInferenceResult

      if (shouldCreateDedicatedThread(request)) {
        const createPayload = buildRunInferencePayload({
          request,
          runtimeContext,
          preferredModel,
          idFactory: this.idFactory,
          createThreadOnly: true,
        })
        const createResult = await this.evaluate<NotionAiInferenceResult>(
          session,
          buildRunInferenceExpression(createPayload, headers, { requireAssistantText: false }),
          this.config.requestTimeoutMs,
        )

        if (createResult.ok) {
          createdDedicatedThreadStats = {
            threadId: createPayload.threadId,
            postDataBytes: createResult.postDataBytes,
            responseBytes: createResult.responseBytes,
          }
          effectiveRequest = {
            ...request,
            notionAiThread: { threadId: createPayload.threadId },
          }
          payload = buildRunInferencePayload({
            request: effectiveRequest,
            runtimeContext,
            preferredModel,
            idFactory: this.idFactory,
            forceFullPrompt: true,
          })
          result = await this.evaluate<NotionAiInferenceResult>(
            session,
            buildRunInferenceExpression(payload, headers),
            this.config.requestTimeoutMs,
          )
        } else {
          result = createResult
        }
      } else {
        result = await this.evaluate<NotionAiInferenceResult>(
          session,
          buildRunInferenceExpression(payload, headers),
          this.config.requestTimeoutMs,
        )
      }

      if (!result.ok && shouldRetryWithoutDedicatedThread(result, request)) {
        notionAiThreadFallbackReason = result.message
        createdDedicatedThreadStats = undefined
        effectiveRequest = { ...request, notionAiThread: undefined }
        payload = buildRunInferencePayload({
          request: effectiveRequest,
          runtimeContext,
          preferredModel,
          idFactory: this.idFactory,
        })
        result = await this.evaluate<NotionAiInferenceResult>(
          session,
          buildRunInferenceExpression(payload, headers),
          this.config.requestTimeoutMs,
        )
      }

      if (!result.ok) throw this.mapInferenceResult(result)

      const rawText = result.rawText.trim()
      if (rawText === emptyText || result.chunkCount === 0) {
        throw this.toLlmError({
          message: "Notion AI tier returned an empty NDJSON stream.",
          code: "invalid-output",
          isRetryable: true,
        })
      }

      return {
        rawText,
        tier: this.tier,
        latencyMs: Date.now() - startedAt,
        diagnostics: {
          endpoint: "/api/v3/runInferenceTranscript",
          notionAiModel: preferredModel,
          ...(input.modelFallbacks.length > 0 ? { notionAiModelFallbacks: input.modelFallbacks } : {}),
          contentType: result.responseContentType,
          responseHeaders: result.responseHeaders,
          postDataBytes: result.postDataBytes,
          responseBytes: result.responseBytes,
          ndjsonPartialParsed: result.parsedPartial,
          ndjsonFinalParsed: result.parsedFinal,
          chunkCount: result.chunkCount,
          notionAiThreadId: createdDedicatedThreadStats?.threadId ?? payload.threadId,
          notionAiThreadCreated: createdDedicatedThreadStats ? true : payload.createThread,
          notionAiThreadPartialTranscript: payload.isPartialTranscript,
          notionAiThreadMode: createdDedicatedThreadStats
            ? "dedicated-created"
            : resolveNotionAiThreadMode(effectiveRequest),
          ...(createdDedicatedThreadStats
            ? {
                notionAiThreadCreatePostDataBytes: createdDedicatedThreadStats.postDataBytes,
                notionAiThreadCreateResponseBytes: createdDedicatedThreadStats.responseBytes,
              }
            : {}),
          ...(notionAiThreadFallbackReason
            ? { notionAiThreadFallbackReason }
            : {}),
          attachTargetUrl: target.url,
          attachTargetUrlMatches: isNotionAiChatbotTargetUrl(target.url, this.config.targetUrlIncludes),
        },
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
      if (this.config.preferredModels.length === 0) return true

      const modelAvailable = modelChainHasAvailableModel(this.config.preferredModels, runtimeContext.availableModels)
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
      const preferredModel = this.config.preferredModels[0] ?? tier1ObservedNotionAiModel

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
      await this.ensureCdpAvailable(timeoutMs)
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

  private async ensureCdpAvailable(timeoutMs: number): Promise<void> {
    try {
      await this.requestJson<unknown>(jsonVersionPath, timeoutMs)
      return
    } catch (error) {
      if (error instanceof ChatbotLlmError && error.code !== "connection") throw error
    }

    await this.chromeLauncher(this.config)
    const deadline = Date.now() + this.config.chromeWaitMs
    let latestError: unknown

    while (Date.now() < deadline) {
      try {
        await this.requestJson<unknown>(jsonVersionPath, timeoutMs)
        return
      } catch (error) {
        latestError = error
        await sleep(500)
      }
    }

    throw this.toLlmError({
      message: "Tier 1 Chrome CDP did not become ready after launch.",
      code: "connection",
      isRetryable: true,
      cause: latestError,
    })
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
      isRetryable: result.code !== "auth",
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
  createThreadOnly?: boolean
  forceFullPrompt?: boolean
}): RunInferencePayload {
  const spaceId = input.runtimeContext.spaceId
  const contextPageId = input.contextPageId ?? input.runtimeContext.contextPageId
  const currentDatetime = new Date().toISOString()
  const dedicatedThread = input.request.notionAiThread
  const dedicatedThreadId = dedicatedThread?.threadId?.trim()
  const threadId = dedicatedThread
    ? dedicatedThreadId || input.idFactory()
    : input.runtimeContext.threadId ?? input.idFactory()
  const hasExistingThread = dedicatedThread ? Boolean(dedicatedThreadId) : Boolean(input.runtimeContext.threadId)

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
      ...(input.createThreadOnly
        ? []
        : [
            {
              id: input.idFactory(),
              type: "user",
              value: [[buildUserPrompt(input.request, { forceFullPrompt: input.forceFullPrompt })]],
              userId: input.runtimeContext.userId,
              createdAt: currentDatetime,
            },
          ]),
    ],
    threadId,
    ...(dedicatedThread && !hasExistingThread
      ? { threadParentPointer: { table: "space", id: spaceId, spaceId } }
      : {}),
    createThread: !hasExistingThread,
    debugOverrides: {
      emitAgentSearchExtractedResults: true,
      cachedInferences: {},
      annotationInferences: {},
      emitInferences: false,
    },
    generateTitle: false,
    saveAllThreadOperations: true,
    setUnreadState: true,
    createdSource: hasExistingThread ? "workflows" : defaultCreatedSource,
    threadType: input.createThreadOnly ? "context" : defaultThreadType,
    isPartialTranscript: hasExistingThread,
    asPatchResponse: true,
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
  const chunks: ParsedInferenceNdjsonChunk[] = []
  let patchState: unknown[] | undefined

  for (const line of ndjson
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean)) {
    try {
      const raw = JSON.parse(line) as unknown
      const seed = extractPatchSeed(raw)
      if (seed) {
        patchState = seed
        chunks.push({ raw, isPartialTranscript: true, assistantText: emptyText })
        continue
      }

      if (patchState && applyPatchOperations(patchState, raw)) {
        chunks.push({
          raw,
          isPartialTranscript: true,
          assistantText: collectText(patchState),
        })
        continue
      }

      chunks.push({
        raw,
        isPartialTranscript: isPartialInferenceChunk(raw),
        assistantText: collectText(raw),
      })
    } catch {
      continue
    }
  }

  const patchText = patchState ? collectText(patchState) : emptyText
  const linePartialText = chunks
    .filter((chunk) => chunk.isPartialTranscript)
    .map((chunk) => chunk.assistantText)
    .join(emptyText)
  const finalText = chunks
    .filter((chunk) => !chunk.isPartialTranscript)
    .map((chunk) => chunk.assistantText)
    .filter(Boolean)
    .at(-1) ?? emptyText
  const partialText = patchText || linePartialText
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

function modelChainHasAvailableModel(models: ReadonlyArray<string>, availableModels?: string[]): boolean {
  return models.some((model) => modelIsAvailable(model, availableModels))
}

function normalizePreferredModels(
  preferredModels: ReadonlyArray<string> | undefined,
  preferredModel: string | undefined,
): ReadonlyArray<string> {
  const candidates = preferredModels ?? (preferredModel ? [preferredModel] : tier1NotionAiModelFallbackChain)
  return [...new Set(candidates.map((model) => model.trim()).filter(Boolean))]
}

function shouldTryNextNotionAiModel(
  error: ChatbotLlmError,
  model: string,
  models: ReadonlyArray<string>,
): boolean {
  const modelIndex = models.indexOf(model)
  if (modelIndex < 0 || modelIndex >= models.length - 1) return false
  return error.code !== "auth"
}

function buildUserPrompt(request: ChatbotLlmRequest, options: { forceFullPrompt?: boolean } = {}): string {
  if (request.notionAiThread?.threadId && !options.forceFullPrompt) {
    return buildDedicatedThreadPatchPrompt(request)
  }

  const promptMessages = buildPromptMessages(request)

  return [
    request.systemPrompt,
    request.knowledgeContext?.notionReferencePrompt,
    ...promptMessages.map((message) => `${message.role}: ${message.content}`),
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n")
}

function buildDedicatedThreadPatchPrompt(request: ChatbotLlmRequest): string {
  const latestUserMessage = request.latestUserMessage?.trim()
  if (latestUserMessage) {
    return [
      request.knowledgeContext?.notionReferencePrompt,
      buildConfirmedFactsPrompt(request),
      `user: ${latestUserMessage}`,
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n")
  }

  const lastMessage = request.messages.at(-1)
  if (!lastMessage) return emptyText
  return [
    request.knowledgeContext?.notionReferencePrompt,
    buildConfirmedFactsPrompt(request),
    `${lastMessage.role}: ${lastMessage.content}`,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n")
}

function buildConfirmedFactsPrompt(request: ChatbotLlmRequest): string {
  const facts = [
    request.conversationState.hasFinalMedium ? `媒体=${request.jobContext.finalMedium}` : undefined,
    request.conversationState.hasJobKind && request.jobContext.jobKind ? `案件種別=${request.jobContext.jobKind}` : undefined,
    request.conversationState.hasDesiredSchedule && request.jobContext.preferredStartDate
      ? `開始希望=${request.jobContext.preferredStartDate}`
      : undefined,
    request.conversationState.hasDesiredSchedule && request.jobContext.publicReleaseDate
      ? `公開/納品=${request.jobContext.publicReleaseDate}`
      : undefined,
    request.conversationState.hasWorkSite ? `作業場所=${request.jobContext.workSite}` : undefined,
    request.conversationState.hasContactEmail && request.conversationState.contactEmail
      ? `メール=${request.conversationState.contactEmail}`
      : undefined,
    request.conversationState.hasCustomerIdentity && request.conversationState.customerName
      ? `氏名=${request.conversationState.customerName}`
      : undefined,
    request.conversationState.hasCustomerIdentity && request.conversationState.companyName
      ? `会社=${request.conversationState.companyName}`
      : undefined,
  ].filter((fact): fact is string => Boolean(fact))

  if (facts.length === 0) return emptyText
  return `confirmed_facts: ${facts.join(" / ")}`
}

function buildPromptMessages(
  request: ChatbotLlmRequest,
): ReadonlyArray<{ role: ChatbotLlmRequest["messages"][number]["role"]; content: string }> {
  const messages = withLatestUserMessage(request.messages, request.latestUserMessage)
  if (messages.length <= historyCompressionThreshold) return messages

  const recentMessages = messages.slice(-recentVerbatimMessageCount)
  const olderMessages = messages.slice(0, -recentVerbatimMessageCount)

  return [
    {
      role: "system",
      content: buildCompressedHistorySummary(olderMessages),
    },
    ...recentMessages,
  ]
}

function withLatestUserMessage(
  messages: ChatbotLlmRequest["messages"],
  latestUserMessage: string | undefined,
): ReadonlyArray<{ role: ChatbotLlmRequest["messages"][number]["role"]; content: string }> {
  if (!latestUserMessage) return messages

  const lastMessage = messages.at(-1)
  if (lastMessage?.role === "user" && lastMessage.content === latestUserMessage) return messages

  return [...messages, { role: "user", content: latestUserMessage }]
}

function buildCompressedHistorySummary(
  messages: ReadonlyArray<{ role: ChatbotLlmRequest["messages"][number]["role"]; content: string }>,
): string {
  const roleCounts = messages.reduce<Record<string, number>>((counts, message) => {
    counts[message.role] = (counts[message.role] ?? 0) + 1
    return counts
  }, {})
  const countSummary = Object.entries(roleCounts)
    .map(([role, count]) => `${role} ${count}件`)
    .join(" / ")
  const excerpts = messages
    .slice(0, compressedHistoryMaxItems)
    .map((message) => `${message.role}: ${truncatePromptExcerpt(message.content)}`)
    .join(" | ")
  const omittedCount = Math.max(messages.length - compressedHistoryMaxItems, 0)
  const omittedSummary = omittedCount > 0 ? ` | ほか ${omittedCount}件` : ""

  return `過去の会話要約: 古い履歴 ${messages.length}件を決定的に圧縮（${countSummary}）。要点: ${excerpts}${omittedSummary}`
}

function truncatePromptExcerpt(content: string): string {
  const compact = content.replace(/\s+/g, " ").trim()
  if (compact.length <= compressedHistoryExcerptMaxChars) return compact
  return `${compact.slice(0, compressedHistoryExcerptMaxChars)}...`
}

function shouldRetryWithoutDedicatedThread(
  result: Extract<NotionAiInferenceResult, { ok: false }>,
  request: ChatbotLlmRequest,
): boolean {
  return (
    result.code === "invalid-output" &&
    request.notionAiThread !== undefined &&
    !request.notionAiThread.threadId &&
    result.message.includes("preview=[")
  )
}

function shouldCreateDedicatedThread(request: ChatbotLlmRequest): boolean {
  return request.notionAiThread !== undefined && !request.notionAiThread.threadId
}

function resolveNotionAiThreadMode(request: ChatbotLlmRequest): string {
  if (!request.notionAiThread) return "fixed-full-resend"
  if (request.notionAiThread.threadId) return "dedicated-patch"
  return "dedicated-created"
}

function findNotionAiTarget(
  targets: CdpTargetsResponse,
  targetUrlIncludes: string,
): NotionAiCdpTarget | undefined {
  return targets.find((target) => {
    return target.type === targetTypePage && isNotionAiChatbotTargetUrl(target.url, targetUrlIncludes)
  })
}

export function isNotionAiChatbotTargetUrl(url: string | undefined, targetUrlIncludes: string): boolean {
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

function buildRunInferenceExpression(
  payload: RunInferencePayload,
  headers: RunInferenceHeaders,
  options: { requireAssistantText?: boolean } = {},
): string {
  return `(() => { const __name = (target) => target; return (${runInferenceInPage.toString()})(${JSON.stringify({ payload, headers, requireAssistantText: options.requireAssistantText ?? true })}); })()`
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
  return (
    record.isPartialTranscript === true ||
    record.type === "partial" ||
    record.type === "patch" ||
    record.type === "patch-start"
  )
}

function extractPatchSeed(value: unknown): unknown[] | undefined {
  if (!value || typeof value !== "object") return undefined
  const record = value as Record<string, unknown>
  if (record.type !== "patch-start") return undefined
  const data = record.data
  const seed =
    Array.isArray(record.s)
      ? record.s
      : data && typeof data === "object"
        ? (data as Record<string, unknown>).s
        : undefined
  if (!Array.isArray(seed)) return undefined
  return cloneJson(seed)
}

function applyPatchOperations(root: unknown[], value: unknown): boolean {
  if (!value || typeof value !== "object") return false
  const record = value as Record<string, unknown>
  if (record.type !== "patch") return false
  const operations = extractPatchOperations(record)
  if (!operations.length) return false

  for (const operation of operations) {
    if (!operation || typeof operation !== "object") continue
    const patch = operation as Record<string, unknown>
    const path = normalizePatchPath(patch.p ?? patch.path)
    if (!path) continue
    applyPatchOperation(root, path, patch.v ?? patch.value, typeof patch.o === "string" ? patch.o : String(patch.type ?? "r"))
  }

  return true
}

function applyPatchOperation(root: JsonContainer, path: string, value: unknown, operation: string): void {
  const parts = decodeJsonPointer(path)
  if (parts[0] === "s") parts.shift()
  if (parts.length === 0) return

  let cursor: unknown = root
  for (let index = 0; index < parts.length - 1; index += 1) {
    const part = parts[index]
    const nextPart = parts[index + 1]
    if (!isJsonContainer(cursor)) return

    if (Array.isArray(cursor)) {
      const arrayIndex = part === "-" ? cursor.length : Number(part)
      if (!Number.isInteger(arrayIndex) || arrayIndex < 0) return
      if (cursor[arrayIndex] === undefined) cursor[arrayIndex] = nextPart === "-" || /^\d+$/.test(nextPart) ? [] : {}
      cursor = cursor[arrayIndex]
      continue
    }

    if (cursor[part] === undefined) cursor[part] = nextPart === "-" || /^\d+$/.test(nextPart) ? [] : {}
    cursor = cursor[part]
  }

  if (!isJsonContainer(cursor)) return
  const key = parts.at(-1)
  if (key === undefined) return
  const nextValue = cloneJson(value)

  if (Array.isArray(cursor)) {
    const arrayIndex = key === "-" ? cursor.length : Number(key)
    if (!Number.isInteger(arrayIndex) || arrayIndex < 0) return
    if (isAddOperation(operation)) cursor.splice(arrayIndex, 0, nextValue)
    else cursor[arrayIndex] = nextValue
    return
  }

  const currentValue = cursor[key]
  if (isStringAppendOperation(operation) && typeof currentValue === "string" && typeof nextValue === "string") {
    cursor[key] = currentValue + nextValue
    return
  }
  cursor[key] = nextValue
}

function extractPatchOperations(record: Record<string, unknown>): unknown[] {
  const candidates = [record.v, record.ops, record.operations, record.patches]
  const data = record.data
  if (data && typeof data === "object") {
    const dataRecord = data as Record<string, unknown>
    candidates.push(dataRecord.v, dataRecord.ops, dataRecord.operations, dataRecord.patches)
  }

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate
  }

  return []
}

function normalizePatchPath(value: unknown): string | undefined {
  if (typeof value === "string") return value
  if (!Array.isArray(value)) return undefined
  return `/${value.map((part) => String(part).replace(/~/g, "~0").replace(/\//g, "~1")).join("/")}`
}

function isAddOperation(operation: string): boolean {
  return ["a", "add", "insert", "li", "listinsert", "list-after", "listafter"].includes(
    operation.toLowerCase(),
  )
}

function isStringAppendOperation(operation: string): boolean {
  return ["a", "add", "append", "si", "stringinsert", "text-insert", "textinsert"].includes(
    operation.toLowerCase(),
  )
}

function decodeJsonPointer(path: string): string[] {
  return path
    .split("/")
    .slice(1)
    .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"))
}

function isJsonContainer(value: unknown): value is JsonContainer {
  return Boolean(value && typeof value === "object")
}

function cloneJson<T>(value: T): T {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
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
  const uuidPatternText = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
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
  const readCurrentSpaceIdFromStorageKeys = (userId) => {
    if (!isUuid(userId)) return undefined;
    const currentSpacePattern = new RegExp("currentSpace:(" + uuidPatternText + "):" + userId + "(?::|$)", "i");
    const sidebarPattern = new RegExp("notion-sidebar-sidebar-state-(" + uuidPatternText + ")-" + userId + "$", "i");
    try {
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index) || "";
        const currentSpaceMatch = key.match(currentSpacePattern);
        if (currentSpaceMatch && isUuid(currentSpaceMatch[1])) return currentSpaceMatch[1];
        const sidebarMatch = key.match(sidebarPattern);
        if (sidebarMatch && isUuid(sidebarMatch[1])) return sidebarMatch[1];
      }
    } catch {}
    return undefined;
  };
  const readSpaceIdFromStorage = (userId) => {
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
  const spaceId =
    root.__notionAiSpaceId ||
    readCurrentSpaceIdFromStorageKeys(userId) ||
    readSpaceIdFromStorage(userId) ||
    apiContext.spaceId;

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
  requireAssistantText?: boolean
}): Promise<NotionAiInferenceResult> {
  const endpoint = "/api/v3/runInferenceTranscript"
  const { payload, headers, requireAssistantText = true } = input
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
  const cloneJsonInPage = <T,>(value: T): T => {
    if (value === undefined) return value
    return JSON.parse(JSON.stringify(value)) as T
  }
  const decodeJsonPointerInPage = (path: string): string[] => {
    return path
      .split("/")
      .slice(1)
      .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"))
  }
  const isJsonContainerInPage = (value: unknown): value is Record<string, unknown> | unknown[] => {
    return Boolean(value && typeof value === "object")
  }
  const extractPatchSeedInPage = (value: unknown): unknown[] | undefined => {
    if (!value || typeof value !== "object") return undefined
    const record = value as Record<string, unknown>
    if (record.type !== "patch-start") return undefined
    const data = record.data
    const seed =
      Array.isArray(record.s)
        ? record.s
        : data && typeof data === "object"
          ? (data as Record<string, unknown>).s
          : undefined
    if (!Array.isArray(seed)) return undefined
    return cloneJsonInPage(seed)
  }
  const extractPatchOperationsInPage = (record: Record<string, unknown>): unknown[] => {
    const candidates = [record.v, record.ops, record.operations, record.patches]
    const data = record.data
    if (data && typeof data === "object") {
      const dataRecord = data as Record<string, unknown>
      candidates.push(dataRecord.v, dataRecord.ops, dataRecord.operations, dataRecord.patches)
    }

    for (const candidate of candidates) {
      if (Array.isArray(candidate)) return candidate
    }

    return []
  }
  const normalizePatchPathInPage = (value: unknown): string | undefined => {
    if (typeof value === "string") return value
    if (!Array.isArray(value)) return undefined
    return `/${value.map((part) => String(part).replace(/~/g, "~0").replace(/\//g, "~1")).join("/")}`
  }
  const isAddOperationInPage = (operation: string): boolean => {
    return ["a", "add", "insert", "li", "listinsert", "list-after", "listafter"].includes(
      operation.toLowerCase(),
    )
  }
  const isStringAppendOperationInPage = (operation: string): boolean => {
    return ["a", "add", "append", "si", "stringinsert", "text-insert", "textinsert"].includes(
      operation.toLowerCase(),
    )
  }
  const applyPatchOperationInPage = (
    root: Record<string, unknown> | unknown[],
    path: string,
    value: unknown,
    operation: string,
  ): void => {
    const parts = decodeJsonPointerInPage(path)
    if (parts[0] === "s") parts.shift()
    if (parts.length === 0) return

    let cursor: unknown = root
    for (let index = 0; index < parts.length - 1; index += 1) {
      const part = parts[index]
      const nextPart = parts[index + 1]
      if (!isJsonContainerInPage(cursor)) return

      if (Array.isArray(cursor)) {
        const arrayIndex = part === "-" ? cursor.length : Number(part)
        if (!Number.isInteger(arrayIndex) || arrayIndex < 0) return
        if (cursor[arrayIndex] === undefined) {
          cursor[arrayIndex] = nextPart === "-" || /^\d+$/.test(nextPart) ? [] : {}
        }
        cursor = cursor[arrayIndex]
        continue
      }

      if (cursor[part] === undefined) cursor[part] = nextPart === "-" || /^\d+$/.test(nextPart) ? [] : {}
      cursor = cursor[part]
    }

    if (!isJsonContainerInPage(cursor)) return
    const key = parts.at(-1)
    if (key === undefined) return
    const nextValue = cloneJsonInPage(value)

    if (Array.isArray(cursor)) {
      const arrayIndex = key === "-" ? cursor.length : Number(key)
      if (!Number.isInteger(arrayIndex) || arrayIndex < 0) return
      if (isAddOperationInPage(operation)) cursor.splice(arrayIndex, 0, nextValue)
      else cursor[arrayIndex] = nextValue
      return
    }

    const currentValue = cursor[key]
    if (isStringAppendOperationInPage(operation) && typeof currentValue === "string" && typeof nextValue === "string") {
      cursor[key] = currentValue + nextValue
      return
    }
    cursor[key] = nextValue
  }
  const applyPatchOperationsInPage = (root: unknown[], value: unknown): boolean => {
    if (!value || typeof value !== "object") return false
    const record = value as Record<string, unknown>
    if (record.type !== "patch") return false
    const operations = extractPatchOperationsInPage(record)
    if (!operations.length) return false

    for (const operation of operations) {
      if (!operation || typeof operation !== "object") continue
      const patch = operation as Record<string, unknown>
      const path = normalizePatchPathInPage(patch.p ?? patch.path)
      if (!path) continue
      applyPatchOperationInPage(
        root,
        path,
        patch.v ?? patch.value,
        typeof patch.o === "string" ? patch.o : String(patch.type ?? "r"),
      )
    }

    return true
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
    let patchState: unknown[] | undefined

    for (const line of responseText
      .split("\n")
      .map((entry) => entry.trim())
      .filter(Boolean)) {
      let raw: unknown
      try {
        raw = JSON.parse(line) as unknown
      } catch {
        chunkCount += 1
        continue
      }
      const patchSeed = extractPatchSeedInPage(raw)
      if (patchSeed) {
        patchState = patchSeed
        chunkCount += 1
        continue
      }
      if (patchState && applyPatchOperationsInPage(patchState, raw)) {
        const patchText = collectTextInPage(patchState)
        if (patchText) partialText = patchText
        chunkCount += 1
        continue
      }
      const parsed = parseLine(line)
      if (parsed.text) {
        if (parsed.isPartialTranscript) partialText += parsed.text
        else finalText = parsed.text
      }
      chunkCount += 1
    }

    const rawText = finalText || partialText
    if (!rawText) {
      if (!requireAssistantText) {
        const createdThreadRecordMap =
          responseText.length > 1 &&
          responseText.includes('"recordMap"') &&
          responseText.includes('"thread"') &&
          responseText.includes(payload.threadId)

        if (createdThreadRecordMap) {
          return {
            ok: true,
            rawText: "",
            chunkCount,
            postDataBytes,
            responseBytes,
            responseContentType,
            responseHeaders,
            parsedPartial: false,
            parsedFinal: false,
          }
        }
      }

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

async function launchTier1Chrome(config: Tier1ChromeNotionAiClientConfig): Promise<void> {
  const currentPlatform = platform()
  const executable = config.chromeCommand ?? (currentPlatform === "darwin" ? "/usr/bin/open" : "google-chrome")
  const args =
    currentPlatform === "darwin" && !config.chromeCommand
      ? [
          "-na",
          config.chromeApp,
          "--args",
          ...chromeArgs(config),
          config.targetUrlIncludes,
        ]
      : [...chromeArgs(config), config.targetUrlIncludes]
  const child = spawn(executable, args, { detached: true, stdio: "ignore" })
  child.unref()
}

function chromeArgs(config: Tier1ChromeNotionAiClientConfig): string[] {
  const cdpUrl = new URL(config.cdpBaseUrl)
  const port = cdpUrl.port || "9223"
  const host = cdpUrl.hostname || "127.0.0.1"

  return [
    `--user-data-dir=${config.chromeProfileDir}`,
    `--remote-debugging-address=${host}`,
    `--remote-debugging-port=${port}`,
    `--remote-allow-origins=${config.cdpBaseUrl}`,
    "--no-first-run",
    "--no-default-browser-check",
  ]
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
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
