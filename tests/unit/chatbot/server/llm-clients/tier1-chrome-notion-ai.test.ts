import { describe, expect, it, vi } from "vitest"

import type { ConversationState, JobContext } from "@/lib/chatbot/domain"
import type { ChatbotLlmRequest } from "@/lib/chatbot/server/llm-client"
import { ChatbotLlmError } from "@/lib/chatbot/server/llm-client"
import {
  assertNotionAiChatbotTargetUrl,
  buildRunInferenceHeaders,
  buildRunInferencePayload,
  buildWorkflowValue,
  chatbotNotionAiModelPolicy,
  createTier1ChromeNotionAiClient,
  extractAssistantTextFromNdjson,
  isNotionAiRateLimitResponse,
  isNotionAiChatbotTargetUrl,
  parseInferenceNdjsonStream,
  Tier1ChromeNotionAiClient,
  tier1ChromeNotionAiDefaults,
} from "@/lib/chatbot/server/llm-clients/tier1-chrome-notion-ai"
import {
  getNotionAiChatbotThreadUrl,
  notionAiChatbotThreadId,
  notionAiChatbotThreadUrl,
} from "@/lib/chatbot/server/llm-clients/tier1-chrome-notion-ai-config"
import type {
  NotionAiCdpSession,
  NotionAiCdpTarget,
} from "@/lib/chatbot/server/llm-clients/tier1-chrome-notion-ai"

const target: NotionAiCdpTarget = {
  type: "page",
  url: "https://www.notion.so/chat?t=36b13ee3141a8073885d00a99ebb676c&wfv=chat",
  webSocketDebuggerUrl: "ws://127.0.0.1:9223/devtools/page/notion-ai",
}
const operationsThreadUrl =
  "https://www.notion.so/chat?t=36b13ee3141a805b9bf600a92a4641a4&wfv=chat"

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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
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

  it("keeps the default target scoped to the chatbot-only Notion AI thread", () => {
    expect(notionAiChatbotThreadId).toBe("36b13ee3-141a-8073-885d-00a99ebb676c")
    expect(tier1ChromeNotionAiDefaults.targetUrlIncludes).toBe(notionAiChatbotThreadUrl)
    expect(getNotionAiChatbotThreadUrl({ NOTION_AI_CHATBOT_THREAD_URL: "" })).toBe(
      notionAiChatbotThreadUrl,
    )
    expect(
      getNotionAiChatbotThreadUrl({
        NOTION_AI_CHATBOT_THREAD_URL:
          "https://www.notion.so/chat?t=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      }),
    ).toBe("https://www.notion.so/chat?t=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
  })

  it("builds the observed runInferenceTranscript payload shape", () => {
    const ids = ["trace-id", "config-id", "context-id", "user-id", "thread-id"]
    const payload = buildRunInferencePayload({
      request: llmRequest(),
      runtimeContext: {
        spaceId: "space-id",
        userId: "user-id",
        notionClientVersion: "23.13.20260523.0626",
        contextPageId: "context-page-id",
        threadId: "thread-id",
        selectedModel: "diagnostic-page-model",
        availableModels: ["diagnostic-page-model"],
      },
      idFactory: () => ids.shift() ?? "extra-id",
    })
    const normalizedPayload = {
      ...payload,
      transcript: payload.transcript.map((entry) => {
        const normalizedEntry = entry.createdAt ? { ...entry, createdAt: "<iso>" } : entry
        if (entry.type !== "context") return normalizedEntry
        return {
          ...normalizedEntry,
          value: {
            ...(entry.value as Record<string, unknown>),
            currentDatetime: "<iso>",
          },
        }
      }),
    }

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
      },
    })
    expect(payload.transcript[0]).toHaveProperty(
      "value.model",
      chatbotNotionAiModelPolicy.notionModel,
    )
    expect(payload.transcript[0]).toHaveProperty("value.modelFromUser", true)
    expect(payload.transcript[1]).toMatchObject({
      id: "context-id",
      type: "context",
      value: {
        context_page_id: "context-page-id",
        surface: "full_page_chat",
      },
    })
    expect(payload.transcript[2]).toMatchObject({
      id: "user-id",
      type: "user",
      userId: "user-id",
      value: [[expect.stringContaining("Collect only new project intake details.")]],
    })
    expect(payload.debugOverrides).toEqual({
      emitAgentSearchExtractedResults: true,
      cachedInferences: {},
      annotationInferences: {},
      emitInferences: false,
    })
    expect(JSON.stringify(payload).length).toBeGreaterThanOrEqual(2800)
    expect(normalizedPayload).toMatchInlineSnapshot(`
      {
        "asPatchResponse": true,
        "createThread": false,
        "createdSource": "workflows",
        "debugOverrides": {
          "annotationInferences": {},
          "cachedInferences": {},
          "emitAgentSearchExtractedResults": true,
          "emitInferences": false,
        },
        "generateTitle": false,
        "hasHeartbeat": false,
        "isPartialTranscript": true,
        "isSpaceSalesAssisted": false,
        "isUserInAnySalesAssistedSpace": false,
        "saveAllThreadOperations": true,
        "setUnreadState": true,
        "spaceId": "space-id",
        "threadId": "thread-id",
        "threadType": "workflow",
        "traceId": "trace-id",
        "transcript": [
          {
            "id": "config-id",
            "type": "config",
            "value": {
              "agentShortUpdatePageResult": false,
              "availableConnectors": [
                "slack",
              ],
              "databaseAgentConfigMode": false,
              "enableAgentAskSurvey": false,
              "enableAgentAutomations": false,
              "enableAgentCardCustomization": false,
              "enableAgentDiffs": false,
              "enableAgentGenerateImage": false,
              "enableAgentIntegrations": false,
              "enableAgentSupportPropertyReorder": false,
              "enableAgentThreadTools": false,
              "enableAgentUpdatePagePatch": false,
              "enableComputer": false,
              "enableCrdtOperations": false,
              "enableCreateAndRunThread": false,
              "enableCsvAttachmentSupport": true,
              "enableCustomAgents": false,
              "enableDatabaseAgents": false,
              "enableExperimentalIntegrations": false,
              "enableLargeToolResultComputerOffload": false,
              "enableMailAgentMultiProviderSupport": false,
              "enableMailExplicitToolCalls": false,
              "enableMailNotificationPreferences": false,
              "enableMarkdownVNext": false,
              "enableQueryCalendar": false,
              "enableQueryMail": false,
              "enableScriptAgent": false,
              "enableScriptAgentAdvanced": false,
              "enableScriptAgentCustomToolCalling": false,
              "enableScriptAgentGoogleDriveInCustomAgent": false,
              "enableScriptAgentGoogleDriveOAuthInCustomAgent": false,
              "enableScriptAgentGtm": false,
              "enableScriptAgentMcpServers": false,
              "enableScriptAgentSearchConnectorsInCustomAgent": false,
              "enableScriptAgentSlack": false,
              "enableSoftwareFactoryPage": false,
              "enableSpeculativeSearch": false,
              "enableSystemPromptAsPage": false,
              "enableUpdatePageAutofixer": false,
              "enableUpdatePageOrderUpdates": false,
              "enableUserSessionContext": false,
              "isAgentResearchRequest": false,
              "isCustomAgent": false,
              "isCustomAgentBuilder": false,
              "isHipaa": false,
              "isMobile": false,
              "isOnboardingAgent": false,
              "model": "angel-cake-high",
              "modelFromUser": true,
              "searchScopes": [
                {
                  "type": "everything",
                },
              ],
              "showDatabaseAgentsDiscoverability": false,
              "type": "workflow",
              "updatePageStaleViewGuardEnabled": false,
              "useCustomAgentDraft": false,
              "useReadOnlyMode": false,
              "useRulePrioritization": true,
              "useSearchToolV2": false,
              "useWebSearch": true,
              "use_draft_actor_pointer": false,
              "writerMode": false,
              "yoloMode": false,
            },
          },
          {
            "id": "context-id",
            "type": "context",
            "value": {
              "context_page_id": "context-page-id",
              "currentDatetime": "<iso>",
              "spaceId": "space-id",
              "surface": "full_page_chat",
              "timezone": "Asia/Tokyo",
              "userId": "user-id",
            },
          },
          {
            "createdAt": "<iso>",
            "id": "user-id",
            "type": "user",
            "userId": "user-id",
            "value": [
              [
                "Collect only new project intake details.
      user: 来月のWeb CM案件です",
              ],
            ],
          },
        ],
      }
    `)
  })

  it("builds the observed browser fetch headers from runtime context", () => {
    expect(
      buildRunInferenceHeaders({
        spaceId: "space-id",
        userId: "user-id",
        notionClientVersion: "23.13.20260523.0626",
      }),
    ).toEqual({
      Accept: "application/x-ndjson",
      "Content-Type": "application/json",
      "notion-audit-log-platform": "web",
      "notion-client-version": "23.13.20260523.0626",
      "x-notion-active-user-header": "user-id",
      "x-notion-space-id": "space-id",
    })
  })

  it("keeps every observed workflow.value field in the config item", () => {
    const workflowValue = buildWorkflowValue()

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
    ])
  })

  it("serializes the policy Notion AI model in the browser request", async () => {
    const session = sessionReturning([
      {
        spaceId: "space-id",
        userId: "user-id",
        selectedModel: "notion-current-model",
        availableModels: ["notion-current-model"],
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
    expect(evaluate.mock.calls[1][0]).toContain('"model":"angel-cake-high"')
    expect(evaluate.mock.calls[1][0]).toContain('"modelFromUser":true')
  })

  it("serializes concurrent generate calls against the shared Chrome target", async () => {
    let activeRunInference = 0
    let maxActiveRunInference = 0
    const sessionFactory = vi.fn(async (): Promise<NotionAiCdpSession> => {
      const evaluate = vi.fn(async <T,>(expression: string): Promise<T> => {
        if (!expression.includes("runInferenceTranscript")) {
        return {
          spaceId: "space-id",
          userId: "user-id",
          selectedModel: "notion-current-model",
          availableModels: ["notion-current-model"],
        } as T
        }

        activeRunInference += 1
        maxActiveRunInference = Math.max(maxActiveRunInference, activeRunInference)
        await delay(5)
        activeRunInference -= 1
        return {
          ok: true,
          rawText: "相談内容を整理します。",
          chunkCount: 1,
          postDataBytes: 100,
          responseBytes: 20,
          responseContentType: "application/x-ndjson",
          responseHeaders: {},
          parsedPartial: false,
          parsedFinal: true,
        } as T
      }) as unknown as NotionAiCdpSession["evaluate"]

      return {
        evaluate,
        close: vi.fn(async () => undefined),
      }
    })
    const client = new Tier1ChromeNotionAiClient({
      fetchClient: cdpFetch(),
      sessionFactory,
    })

    await expect(Promise.all([client.generate(llmRequest()), client.generate(llmRequest())])).resolves.toHaveLength(2)

    expect(sessionFactory).toHaveBeenCalledTimes(2)
    expect(maxActiveRunInference).toBe(1)
  })

  it("returns healthy only when CDP and Notion AI target context are available", async () => {
    const healthySession = sessionReturning([
      {
        spaceId: "space-id",
        userId: "user-id",
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
    })

    await expect(healthyClient.isHealthy()).resolves.toBe(true)
    await expect(missingTargetClient.isHealthy()).resolves.toBe(false)
  })

  it("does not require the chatbot Notion AI target URL to use the www host", async () => {
    const session = sessionReturning([
      {
        spaceId: "space-id",
        userId: "user-id",
        selectedModel: "notion-current-model",
        availableModels: ["notion-current-model"],
      },
    ])
    const client = new Tier1ChromeNotionAiClient({
      fetchClient: cdpFetch([
        { type: "page", url: "https://notion.so/chat?t=36b13ee3141a8073885d00a99ebb676c" },
      ]),
      sessionFactory: async () => session,
    })

    await expect(client.isHealthy()).resolves.toBe(true)
  })

  it("attaches to the app Notion AI runtime target when the configured chat target redirects", async () => {
    const attachedTargets: NotionAiCdpTarget[] = []
    const session = sessionReturning([
      {
        spaceId: "space-id",
        userId: "user-id",
        selectedModel: "notion-current-model",
        availableModels: ["notion-current-model"],
      },
    ])
    const client = new Tier1ChromeNotionAiClient({
      fetchClient: cdpFetch([
        {
          type: "page",
          url: "https://www.notion.so/chat?t=36b13ee3141a8073885d00a99ebb676c",
          webSocketDebuggerUrl: "ws://127.0.0.1:9223/devtools/page/redirect-stub",
        },
        {
          type: "page",
          url: "https://app.notion.com/ai",
          webSocketDebuggerUrl: "ws://127.0.0.1:9223/devtools/page/notion-ai-runtime",
        },
      ]),
      sessionFactory: async (attachedTarget) => {
        attachedTargets.push(attachedTarget)
        return session
      },
    })

    expect(isNotionAiChatbotTargetUrl("https://app.notion.com/ai", notionAiChatbotThreadUrl)).toBe(
      true,
    )
    await expect(client.isHealthy()).resolves.toBe(true)
    expect(attachedTargets[0]?.webSocketDebuggerUrl).toContain("notion-ai-runtime")
  })

  it("keeps the redirected app Notion AI runtime target healthy after the chat target is gone", async () => {
    const attachedTargets: NotionAiCdpTarget[] = []
    const session = sessionReturning([
      {
        spaceId: "space-id",
        userId: "user-id",
        selectedModel: "notion-current-model",
        availableModels: ["notion-current-model"],
      },
    ])
    const client = new Tier1ChromeNotionAiClient({
      fetchClient: cdpFetch([
        {
          type: "page",
          url: "https://app.notion.com/ai",
          webSocketDebuggerUrl: "ws://127.0.0.1:9223/devtools/page/notion-ai-runtime",
        },
      ]),
      sessionFactory: async (attachedTarget) => {
        attachedTargets.push(attachedTarget)
        return session
      },
    })

    await expect(client.isHealthy()).resolves.toBe(true)
    expect(attachedTargets[0]?.webSocketDebuggerUrl).toContain("notion-ai-runtime")
  })

  it("uses the configured chat thread id when the attached app runtime URL has no thread id", async () => {
    let evaluationCount = 0
    const evaluate = vi.fn(async <T,>(expression: string): Promise<T> => {
      evaluationCount += 1
      if (evaluationCount === 1) {
        return {
          spaceId: "space-id",
          userId: "user-id",
          selectedModel: "notion-current-model",
          availableModels: ["notion-current-model"],
        } as T
      }

      expect(expression).toContain('"threadId":"36b13ee3-141a-8073-885d-00a99ebb676c"')
      expect(expression).toContain('"createThread":false')
      return {
        ok: true,
        rawText: "相談内容を整理します。",
        chunkCount: 1,
        postDataBytes: 100,
        responseBytes: 20,
        responseContentType: "application/x-ndjson",
        responseHeaders: {},
        parsedPartial: false,
        parsedFinal: true,
      } as T
    }) as unknown as NotionAiCdpSession["evaluate"]
    const session: NotionAiCdpSession = {
      evaluate,
      close: vi.fn(async () => undefined),
    }
    const client = new Tier1ChromeNotionAiClient({
      fetchClient: cdpFetch([
        {
          type: "page",
          url: "https://www.notion.so/chat?t=36b13ee3141a8073885d00a99ebb676c",
          webSocketDebuggerUrl: "ws://127.0.0.1:9223/devtools/page/redirect-stub",
        },
        {
          type: "page",
          url: "https://app.notion.com/ai",
          webSocketDebuggerUrl: "ws://127.0.0.1:9223/devtools/page/notion-ai-runtime",
        },
      ]),
      sessionFactory: async () => session,
    })

    await expect(client.generate(llmRequest())).resolves.toMatchObject({
      tier: "tier-1-chrome-notion-ai",
      rawText: "相談内容を整理します。",
    })
  })

  it("rejects non-chatbot Notion AI targets before attaching", async () => {
    const client = new Tier1ChromeNotionAiClient({
      fetchClient: cdpFetch([
        { type: "page", url: operationsThreadUrl },
        {
          type: "page",
          url: "https://www.notion.so/3088971f957b481baff8499ff911051b?d=ee7696789d034f89b17f16b942ff24c7&pvs=42",
        },
      ]),
      sessionFactory: async () => sessionReturning([]),
    })

    expect(isNotionAiChatbotTargetUrl(target.url, notionAiChatbotThreadUrl)).toBe(true)
    expect(isNotionAiChatbotTargetUrl(operationsThreadUrl, notionAiChatbotThreadUrl)).toBe(false)
    expect(() => assertNotionAiChatbotTargetUrl(operationsThreadUrl, notionAiChatbotThreadUrl)).toThrow(
      ChatbotLlmError,
    )
    await expectLlmError(client.generate(llmRequest()), {
      code: "connection",
      isRetryable: true,
    })
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

  it("overrides page workflow model selection with the policy model before inference", async () => {
    let evaluationCount = 0
    const evaluate = vi.fn(async <T,>(expression: string): Promise<T> => {
      evaluationCount += 1
      if (evaluationCount === 1) {
        return {
          spaceId: "space-id",
          userId: "user-id",
          selectedModel: "page-diagnostic-model",
          availableModels: ["page-diagnostic-model"],
          workflowValue: {
            model: "page-diagnostic-model",
            modelFromUser: true,
            useWebSearch: false,
          },
        } as T
      }

      expect(expression).toContain('"model":"angel-cake-high"')
      expect(expression).toContain('"modelFromUser":true')
      expect(expression).not.toContain('"model":"page-diagnostic-model"')
      expect(expression).toContain('"useWebSearch":false')
      return {
        ok: true,
        rawText: "相談内容を整理します。",
        chunkCount: 1,
        postDataBytes: 100,
        responseBytes: 20,
        responseContentType: "application/x-ndjson",
        responseHeaders: {},
        parsedPartial: false,
        parsedFinal: true,
      } as T
    }) as unknown as NotionAiCdpSession["evaluate"]
    const session: NotionAiCdpSession = {
      evaluate,
      close: vi.fn(async () => undefined),
    }
    const client = new Tier1ChromeNotionAiClient({
      fetchClient: cdpFetch(),
      sessionFactory: async () => session,
    })

    await expect(client.generate(llmRequest())).resolves.toMatchObject({
      tier: "tier-1-chrome-notion-ai",
      rawText: "相談内容を整理します。",
    })
  })

  it("retries transient empty Notion AI responses before falling back", async () => {
    const client = new Tier1ChromeNotionAiClient({
      fetchClient: cdpFetch(),
      sessionFactory: async () =>
        sessionReturning([
          {
            spaceId: "space-id",
            userId: "user-id",
            selectedModel: "notion-current-model",
            availableModels: ["notion-current-model"],
          },
          {
            ok: false,
            code: "invalid-output",
            message: "Notion AI response text could not be extracted. bytes=0 preview=",
          },
          {
            ok: true,
            rawText: "相談内容を整理します。",
            chunkCount: 1,
            postDataBytes: 100,
            responseBytes: 20,
            responseContentType: "application/x-ndjson",
            responseHeaders: {},
            parsedPartial: false,
            parsedFinal: true,
          },
        ]),
    })

    await expect(client.generate(llmRequest())).resolves.toMatchObject({
      rawText: "相談内容を整理します。",
      diagnostics: {
        inferenceAttempts: 2,
      },
    })
  })

  it("throws invalid-output when the NDJSON stream has no assistant text", async () => {
    const client = new Tier1ChromeNotionAiClient({
      fetchClient: cdpFetch(),
      sessionFactory: async () =>
        sessionReturning([
          {
            spaceId: "space-id",
            userId: "user-id",
            selectedModel: "notion-current-model",
            availableModels: ["notion-current-model"],
          },
          { ok: true, rawText: "", chunkCount: 1 },
          { ok: true, rawText: "", chunkCount: 1 },
        ]),
    })

    await expectLlmError(client.generate(llmRequest()), {
      code: "invalid-output",
      isRetryable: false,
    })
  })

  it("classifies Notion fair-use error patches as non-retryable rate limits", async () => {
    expect(
      isNotionAiRateLimitResponse(
        JSON.stringify({
          type: "patch-start",
          data: {
            s: [
              {
                type: "error",
                message: "Please try again later.",
                stack: "UserRateLimitResponse: Please try again later.\\n    at fairUseAIRateLimit (...)",
              },
            ],
          },
        }),
      ),
    ).toBe(true)

    const client = new Tier1ChromeNotionAiClient({
      fetchClient: cdpFetch(),
      sessionFactory: async () =>
        sessionReturning([
          {
            spaceId: "space-id",
            userId: "user-id",
            selectedModel: "notion-current-model",
            availableModels: ["notion-current-model"],
          },
          {
            ok: false,
            code: "rate-limit",
            message: "Notion AI rate limit response was returned.",
          },
        ]),
    })

    await expectLlmError(client.generate(llmRequest()), {
      code: "rate-limit",
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

  it("parses partial and final NDJSON transcript lines separately", () => {
    const parsed = parseInferenceNdjsonStream(
      [
        JSON.stringify({ isPartialTranscript: true, value: { content: "候補日を" } }),
        JSON.stringify({ isPartialTranscript: false, assistant: { message: "確認しました。" } }),
      ].join("\n"),
    )

    expect(parsed).toMatchObject({
      partialText: "候補日を",
      finalText: "確認しました。",
      assistantText: "確認しました。",
      chunkCount: 2,
    })
  })

  it("reconstructs Notion patch chunks and final record-map text", () => {
    const parsed = parseInferenceNdjsonStream(
      [
        JSON.stringify({ type: "patch-start", data: { s: [{ type: "agent-turn-full-record-map" }] } }),
        JSON.stringify({
          type: "patch",
          v: [{ o: "x", p: "/s/2/value/1/content", v: "途中" }],
        }),
        JSON.stringify({
          type: "record-map",
          recordMap: {
            workflow: {
              step: {
                value: {
                  value: {
                    step: {
                      type: "agent-inference",
                      value: [
                        { type: "thinking", content: "hidden" },
                        { type: "text", content: "最終回答" },
                      ],
                    },
                  },
                },
              },
            },
          },
        }),
      ].join("\n"),
    )

    expect(parsed).toMatchObject({
      partialText: "途中",
      finalText: "最終回答",
      assistantText: "最終回答",
      chunkCount: 3,
    })
  })

  it("does not collect thinking signatures from generic NDJSON fields", () => {
    const parsed = parseInferenceNdjsonStream(
      [
        JSON.stringify({
          type: "record-map",
          response: {
            message: {
              type: "thinking",
              content: "I need to ask for a project name.",
              signature: "claude-sonnet-thinking-signature-" + "a".repeat(120),
            },
            value: {
              type: "text",
              content: "承知しました。案件名を教えていただけますでしょうか？",
            },
          },
        }),
      ].join("\n"),
    )

    expect(parsed.assistantText).toBe("承知しました。案件名を教えていただけますでしょうか？")
    expect(parsed.assistantText).not.toContain("thinking")
    expect(parsed.assistantText).not.toMatch(/[A-Za-z0-9+/=_-]{80,}/u)
  })
})
