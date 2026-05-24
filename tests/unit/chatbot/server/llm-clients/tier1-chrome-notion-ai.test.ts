import { describe, expect, it, vi } from "vitest"

import type { ConversationState, JobContext } from "@/lib/chatbot/domain"
import type { ChatbotLlmRequest } from "@/lib/chatbot/server/llm-client"
import { ChatbotLlmError } from "@/lib/chatbot/server/llm-client"
import {
  buildRunInferencePayload,
  buildWorkflowValue,
  createTier1ChromeNotionAiClient,
  extractAssistantTextFromNdjson,
  Tier1ChromeNotionAiClient,
} from "@/lib/chatbot/server/llm-clients/tier1-chrome-notion-ai"
import type {
  NotionAiCdpSession,
  NotionAiCdpTarget,
} from "@/lib/chatbot/server/llm-clients/tier1-chrome-notion-ai"

const target: NotionAiCdpTarget = {
  type: "page",
  url: "https://www.notion.so/ai",
  webSocketDebuggerUrl: "ws://127.0.0.1:9223/devtools/page/notion-ai",
}

function conversationState(): ConversationState {
  return {
    hasFinalMedium: true,
    hasJobKind: true,
    hasAdditionalWork: true,
    hasDocumentaryAttachments: true,
    hasWorkSite: true,
    hasReferenceUrls: true,
    hasContactEmail: true,
    hasDesiredSchedule: true,
    turnCount: 1,
  }
}

function jobContext(): JobContext {
  return {
    jobKind: "cm-30s",
    finalMedium: "web",
    workSite: "remote-grading",
    documentaryAttachment: { kind: "none" },
  }
}

function llmRequest(): ChatbotLlmRequest {
  return {
    systemPrompt: "Collect only new project intake details.",
    messages: [{ role: "user", content: "来月のWeb CM案件です" }],
    latestUserMessage: "立ち会い候補を相談したいです",
    conversationState: conversationState(),
    jobContext: jobContext(),
  }
}

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: vi.fn(async () => body),
  } as unknown as Response
}

function sessionReturning(values: unknown[]): NotionAiCdpSession {
  const evaluate = vi.fn(async <T,>(expression: string, timeoutMs: number): Promise<T> => {
    void expression
    void timeoutMs
    const value = values.shift()
    if (value instanceof Error) throw value
    return value as T
  }) as unknown as NotionAiCdpSession["evaluate"]

  return {
    evaluate,
    close: vi.fn(async () => undefined),
  }
}

function cdpFetch(targets: NotionAiCdpTarget[] = [target]) {
  return vi.fn(async (input: string) => {
    if (input.endsWith("/json/version")) return jsonResponse({ Browser: "Chrome" })
    if (input.endsWith("/json/list")) return jsonResponse(targets)
    return jsonResponse({}, { ok: false, status: 404 })
  })
}

async function expectLlmError(
  promise: Promise<unknown>,
  expected: { code: ChatbotLlmError["code"]; isRetryable: boolean },
) {
  await expect(promise).rejects.toBeInstanceOf(ChatbotLlmError)
  await expect(promise).rejects.toMatchObject({
    code: expected.code,
    isRetryable: expected.isRetryable,
    tier: "tier-1-chrome-notion-ai",
  })
}

describe("Tier1ChromeNotionAiClient", () => {
  it("keeps the tier property fixed to tier 1 Chrome Notion AI", () => {
    const client = createTier1ChromeNotionAiClient()

    expect(client.tier).toBe("tier-1-chrome-notion-ai")
  })

  it("builds the observed runInferenceTranscript payload shape", () => {
    const ids = ["trace-id", "config-id", "user-id", "thread-id"]
    const payload = buildRunInferencePayload({
      request: llmRequest(),
      runtimeContext: {
        spaceId: "space-id",
        selectedModel: "notion-current-model",
        availableModels: ["notion-current-model"],
        modelFromUser: true,
      },
      idFactory: () => ids.shift() ?? "extra-id",
    })

    expect(Object.keys(payload)).toEqual([
      "traceId",
      "spaceId",
      "transcript",
      "threadId",
      "createThread",
      "debugOverrides",
      "generateTitle",
      "saveAllThreadOperations",
      "setUnreadState",
      "createdSource",
      "threadType",
      "isPartialTranscript",
      "asPatchResponse",
      "hasHeartbeat",
      "isUserInAnySalesAssistedSpace",
      "isSpaceSalesAssisted",
    ])
    expect(payload.transcript[0]).toMatchObject({
      id: "config-id",
      type: "config",
      value: {
        type: "workflow",
        model: "notion-current-model",
        modelFromUser: true,
      },
    })
    expect(payload.debugOverrides).toEqual({
      emitAgentSearchExtractedResults: false,
      cachedInferences: [],
      annotationInferences: [],
      emitInferences: true,
    })
  })

  it("keeps every observed workflow.value field in the config item", () => {
    const workflowValue = buildWorkflowValue({
      model: "notion-current-model",
      modelFromUser: true,
    })

    expect(Object.keys(workflowValue)).toEqual([
      "type",
      "model",
      "isHipaa",
      "isMobile",
      "yoloMode",
      "writerMode",
      "searchScopes",
      "useWebSearch",
      "isCustomAgent",
      "modelFromUser",
      "enableComputer",
      "enableQueryMail",
      "useReadOnlyMode",
      "useSearchToolV2",
      "enableAgentDiffs",
      "enableScriptAgent",
      "isOnboardingAgent",
      "enableCustomAgents",
      "availableConnectors",
      "enableMarkdownVNext",
      "enableQueryCalendar",
      "useCustomAgentDraft",
      "enableAgentAskSurvey",
      "enableCrdtOperations",
      "enableDatabaseAgents",
      "enableScriptAgentGtm",
      "isCustomAgentBuilder",
      "useRulePrioritization",
      "enableAgentAutomations",
      "enableAgentThreadTools",
      "enableScriptAgentSlack",
      "isAgentResearchRequest",
      "databaseAgentConfigMode",
      "enableAgentIntegrations",
      "enableSpeculativeSearch",
      "use_draft_actor_pointer",
      "enableAgentGenerateImage",
      "enableCreateAndRunThread",
      "enableSystemPromptAsPage",
      "enableUserSessionContext",
      "enableScriptAgentAdvanced",
      "enableSoftwareFactoryPage",
      "enableUpdatePageAutofixer",
      "agentShortUpdatePageResult",
      "enableAgentUpdatePagePatch",
      "enableCsvAttachmentSupport",
      "enableMailExplicitToolCalls",
      "enableScriptAgentMcpServers",
      "enableAgentCardCustomization",
      "enableUpdatePageOrderUpdates",
      "useContextualCoreDocsAutoLoad",
      "useDocPreviewsForCoreAutoLoad",
      "enableExperimentalIntegrations",
      "updatePageStaleViewGuardEnabled",
      "enableAgentSupportPropertyReorder",
      "enableMailNotificationPreferences",
      "showDatabaseAgentsDiscoverability",
      "enableScriptAgentCustomToolCalling",
      "enableMailAgentMultiProviderSupport",
      "enableLargeToolResultComputerOffload",
      "enableScriptAgentGoogleDriveInCustomAgent",
      "enableScriptAgentGoogleDriveOAuthInCustomAgent",
      "enableScriptAgentSearchConnectorsInCustomAgent",
      "isThreadStartedByAdmin",
    ])
  })

  it("uses current page model selection instead of a fixed model", async () => {
    const session = sessionReturning([
      {
        spaceId: "space-id",
        selectedModel: "notion-current-model",
        availableModels: ["notion-current-model"],
        modelFromUser: true,
      },
      { ok: true, rawText: "候補日を確認しました。", chunkCount: 1 },
    ])
    const client = new Tier1ChromeNotionAiClient({
      fetchClient: cdpFetch(),
      sessionFactory: async () => session,
      idFactory: vi.fn(() => "stable-id"),
    })

    await expect(client.generate(llmRequest())).resolves.toMatchObject({
      rawText: "候補日を確認しました。",
      tier: "tier-1-chrome-notion-ai",
    })

    const evaluate = vi.mocked(session.evaluate)
    expect(evaluate).toHaveBeenCalledTimes(2)
    expect(evaluate.mock.calls[1][0]).toContain("/api/v3/runInferenceTranscript")
    expect(evaluate.mock.calls[1][0]).toContain("notion-current-model")
  })

  it("returns healthy only when CDP and Notion AI target context are available", async () => {
    const healthySession = sessionReturning([
      {
        spaceId: "space-id",
        selectedModel: "notion-current-model",
        availableModels: ["notion-current-model"],
      },
    ])
    const missingTargetClient = new Tier1ChromeNotionAiClient({
      fetchClient: cdpFetch([{ type: "page", url: "https://www.notion.so/workspace" }]),
      sessionFactory: async () => healthySession,
    })
    const healthyClient = new Tier1ChromeNotionAiClient({
      fetchClient: cdpFetch(),
      sessionFactory: async () => healthySession,
      preferredModel: "notion-current-model",
    })

    await expect(healthyClient.isHealthy()).resolves.toBe(true)
    await expect(missingTargetClient.isHealthy()).resolves.toBe(false)
  })

  it("does not require the Notion AI target URL to use the www host", async () => {
    const session = sessionReturning([
      {
        spaceId: "space-id",
        selectedModel: "notion-current-model",
        availableModels: ["notion-current-model"],
      },
    ])
    const client = new Tier1ChromeNotionAiClient({
      fetchClient: cdpFetch([{ type: "page", url: "https://notion.so/ai" }]),
      sessionFactory: async () => session,
    })

    await expect(client.isHealthy()).resolves.toBe(true)
  })

  it("maps login redirects and missing space id to auth errors", async () => {
    const loginClient = new Tier1ChromeNotionAiClient({
      fetchClient: cdpFetch([{ type: "page", url: "https://www.notion.so/login" }]),
      sessionFactory: async () => sessionReturning([]),
    })
    const missingSpaceClient = new Tier1ChromeNotionAiClient({
      fetchClient: cdpFetch(),
      sessionFactory: async () =>
        sessionReturning([
          {
            selectedModel: "notion-current-model",
            availableModels: ["notion-current-model"],
          },
        ]),
    })

    await expectLlmError(loginClient.generate(llmRequest()), {
      code: "auth",
      isRetryable: false,
    })
    await expectLlmError(missingSpaceClient.generate(llmRequest()), {
      code: "auth",
      isRetryable: false,
    })
  })

  it("throws a retryable fallback error when preferred model is unavailable", async () => {
    const client = new Tier1ChromeNotionAiClient({
      fetchClient: cdpFetch(),
      sessionFactory: async () =>
        sessionReturning([
          {
            spaceId: "space-id",
            selectedModel: "notion-current-model",
            availableModels: ["notion-current-model"],
          },
        ]),
      preferredModel: "preferred-policy-model",
    })

    await expectLlmError(client.generate(llmRequest()), {
      code: "connection",
      isRetryable: true,
    })
  })

  it("throws invalid-output when the NDJSON stream has no assistant text", async () => {
    const client = new Tier1ChromeNotionAiClient({
      fetchClient: cdpFetch(),
      sessionFactory: async () =>
        sessionReturning([
          {
            spaceId: "space-id",
            selectedModel: "notion-current-model",
            availableModels: ["notion-current-model"],
          },
          { ok: true, rawText: "", chunkCount: 1 },
        ]),
    })

    await expectLlmError(client.generate(llmRequest()), {
      code: "invalid-output",
      isRetryable: false,
    })
  })

  it("extracts assistant text from NDJSON chunks without DOM completion checks", () => {
    const ndjson = [
      JSON.stringify({ type: "partial", text: "候補日を" }),
      JSON.stringify({ type: "partial", value: { content: "確認しました。" } }),
    ].join("\n")

    expect(extractAssistantTextFromNdjson(ndjson)).toBe("候補日を確認しました。")
  })
})
