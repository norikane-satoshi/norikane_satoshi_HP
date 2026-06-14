import { readFileSync } from "node:fs"

import { describe, expect, it, vi } from "vitest"

import type { ConversationState, JobContext } from "@/lib/chatbot/domain"
import type { ChatbotLlmRequest } from "@/lib/chatbot/server/llm-client"
import { ChatbotLlmError } from "@/lib/chatbot/server/llm-client"
import {
  assertNotionAiChatbotTargetUrl,
  buildRunInferenceHeaders,
  buildRunInferencePayload,
  buildWorkflowValue,
  createTier1ChromeNotionAiClient,
  extractAssistantTextFromNdjson,
  isNotionAiChatbotTargetUrl,
  parseInferenceNdjsonStream,
  Tier1ChromeNotionAiClient,
  tier1ChromeNotionAiDefaults,
  tier1Gpt55NotionAiModel,
  tier1NotionAiModelFallbackChain,
  tier1Opus48NotionAiModel,
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
    hasProjectLength: true,
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

function payloadPrompt(payload: ReturnType<typeof buildRunInferencePayload>): string {
  return String((payload.transcript[2].value as string[][])[0][0])
}

function buildPayloadForRequest(request: ChatbotLlmRequest) {
  const ids = ["trace-id", "config-id", "context-id", "user-id", "thread-id"]
  return buildRunInferencePayload({
    request,
    runtimeContext: {
      spaceId: "space-id",
      userId: "user-id",
      notionClientVersion: "23.13.20260523.0626",
      contextPageId: "context-page-id",
      threadId: "thread-id",
      selectedModel: "ignored-page-model",
      availableModels: ["acai-budino-high"],
      modelFromUser: true,
    },
    idFactory: () => ids.shift() ?? "extra-id",
  })
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

  it("keeps discovery fail-fast while allowing long Notion AI inference", () => {
    expect(tier1ChromeNotionAiDefaults.connectTimeoutMs).toBe(10000)
    expect(tier1ChromeNotionAiDefaults.requestTimeoutMs).toBe(180000)
    expect(tier1ChromeNotionAiDefaults.chromeProfileDir).toContain(".cc-notion/chrome-profiles/notion-ai")
    expect(tier1ChromeNotionAiDefaults.chromeWaitMs).toBe(30000)
  })

  it("keeps the observed Notion AI model fallback chain explicit", () => {
    expect(tier1NotionAiModelFallbackChain).toEqual([
      "acai-budino-high",
      "opal-quince-high",
      "ambrosia-tart-high",
    ])
    expect(tier1Gpt55NotionAiModel).toBe("opal-quince-high")
    expect(tier1Opus48NotionAiModel).toBe("ambrosia-tart-high")
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
        selectedModel: "ignored-page-model",
        availableModels: ["acai-budino-high"],
        modelFromUser: true,
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
        model: "acai-budino-high",
        modelFromUser: true,
      },
    })
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
              "model": "acai-budino-high",
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
      user: 来月のWeb CM案件です
      user: 立ち会い候補を相談したいです",
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

  it("does not duplicate the latest user message when messages already include it", () => {
    const request = llmRequest()
    const latestUserMessage = "立ち会い候補を相談したいです"
    const payload = buildPayloadForRequest({
      ...request,
      messages: [
        ...request.messages,
        { role: "user", content: latestUserMessage },
      ],
      latestUserMessage,
    })

    expect(payloadPrompt(payload).match(new RegExp(latestUserMessage, "g"))).toHaveLength(1)
  })

  it("keeps short conversation prompts unchanged when latest user message is not in messages yet", () => {
    const request = llmRequest()
    const payload = buildPayloadForRequest(request)

    expect(payloadPrompt(payload)).toBe([
      "Collect only new project intake details.",
      "user: 来月のWeb CM案件です",
      "user: 立ち会い候補を相談したいです",
    ].join("\n"))
  })

  it("creates a dedicated conversation thread with a generated id instead of the fixed page thread", () => {
    const ids = ["dedicated-thread-id", "trace-id", "config-id", "context-id", "user-id"]
    const payload = buildRunInferencePayload({
      request: {
        ...llmRequest(),
        notionAiThread: {},
      },
      runtimeContext: {
        spaceId: "space-id",
        userId: "user-id",
        contextPageId: "context-page-id",
        threadId: "fixed-page-thread-id",
        availableModels: ["acai-budino-high"],
      },
      idFactory: () => ids.shift() ?? "extra-id",
    })

    expect(payload).toMatchObject({
      threadId: "dedicated-thread-id",
      createThread: true,
      isPartialTranscript: false,
      asPatchResponse: true,
      createdSource: "assistant",
    })
    expect(payloadPrompt(payload)).toContain("Collect only new project intake details.")
  })

  it("falls back to the attached Notion thread when fresh thread creation returns a lone array opener", async () => {
    const session = sessionReturning([
      {
        spaceId: "space-id",
        userId: "user-id",
        contextPageId: "context-page-id",
        threadId: "fixed-page-thread-id",
        selectedModel: "notion-current-model",
        availableModels: ["acai-budino-high"],
      },
      {
        ok: false,
        code: "invalid-output",
        message: "Notion AI response text could not be extracted. bytes=1 preview=[",
      },
      { ok: true, rawText: "1〜2日です。", chunkCount: 3 },
    ])
    const client = new Tier1ChromeNotionAiClient({
      fetchClient: cdpFetch(),
      sessionFactory: async () => session,
    })

    await expect(
      client.generate({
        ...llmRequest(),
        notionAiThread: {},
      }),
    ).resolves.toMatchObject({
      rawText: "1〜2日です。",
      diagnostics: {
        notionAiThreadId: "fixed-page-thread-id",
        notionAiThreadCreated: false,
        notionAiThreadPartialTranscript: true,
        notionAiThreadMode: "fixed-full-resend",
        notionAiThreadFallbackReason:
          "Notion AI response text could not be extracted. bytes=1 preview=[",
      },
    })
    expect(vi.mocked(session.evaluate)).toHaveBeenCalledTimes(3)
  })

  it("bootstraps a dedicated thread with the fixed prompt before patching only the first user message", async () => {
    const session = sessionReturning([
      {
        spaceId: "space-id",
        userId: "user-id",
        contextPageId: "context-page-id",
        threadId: "fixed-page-thread-id",
        selectedModel: "notion-current-model",
        availableModels: ["acai-budino-high"],
      },
      {
        ok: true,
        rawText: "",
        chunkCount: 2,
        postDataBytes: 1213,
        responseBytes: 2314,
        responseContentType: "application/x-ndjson",
        responseHeaders: {},
        parsedPartial: false,
        parsedFinal: false,
      },
      {
        ok: true,
        rawText: "1〜2日です。",
        chunkCount: 4,
        postDataBytes: 3055,
        responseBytes: 18000,
        responseContentType: "application/x-ndjson",
        responseHeaders: {},
        parsedPartial: true,
        parsedFinal: true,
      },
    ])
    const client = new Tier1ChromeNotionAiClient({
      fetchClient: cdpFetch(),
      sessionFactory: async () => session,
      idFactory: vi.fn(() => "dedicated-thread-id"),
    })

    await expect(
      client.generate({
        ...llmRequest(),
        notionAiThread: {},
      }),
    ).resolves.toMatchObject({
      rawText: "1〜2日です。",
      diagnostics: {
        postDataBytes: 3055,
        notionAiThreadId: "dedicated-thread-id",
        notionAiThreadCreated: true,
        notionAiThreadCreatePostDataBytes: 1213,
        notionAiThreadCreateResponseBytes: 2314,
        notionAiThreadMode: "dedicated-created",
      },
    })

    const evaluate = vi.mocked(session.evaluate)
    expect(evaluate).toHaveBeenCalledTimes(3)
    expect(evaluate.mock.calls[1]?.[0]).toContain("threadParentPointer")
    expect(evaluate.mock.calls[1]?.[0]).toContain("Collect only new project intake details.")
    expect(evaluate.mock.calls[1]?.[0]).not.toContain("立ち会い候補を相談したいです")
    expect(evaluate.mock.calls[2]?.[0]).not.toContain("Collect only new project intake details.")
    expect(evaluate.mock.calls[2]?.[0]).toContain("立ち会い候補を相談したいです")
    expect(evaluate.mock.calls[2]?.[0]).toContain("dedicated-thread-id")
  })

  it("patches only the new user message into an existing dedicated conversation thread", () => {
    const payload = buildPayloadForRequest({
      ...llmRequest(),
      systemPrompt: "固定プロンプトは再送しない",
      messages: [
        { role: "user", content: "会話Aの発言が混じったら失敗" },
        { role: "assistant", content: "過去の応答も再送しない" },
        { role: "user", content: "会話Bの直前発言" },
      ],
      latestUserMessage: "会話Bの今回の新規発言",
      notionAiThread: { threadId: "thread-b" },
    })
    const prompt = payloadPrompt(payload)

    expect(payload).toMatchObject({
      threadId: "thread-b",
      createThread: false,
      isPartialTranscript: true,
      asPatchResponse: true,
      createdSource: "workflows",
    })
    expect(prompt.split("\n")).toEqual([
      "confirmed_facts: 媒体=web / 案件種別=cm-30s / 作業場所=remote-grading",
      "user: 会話Bの今回の新規発言",
    ])
    expect(prompt).not.toContain("固定プロンプト")
    expect(prompt).not.toContain("会話Aの発言")
    expect(prompt).not.toContain("会話Bの直前発言")
  })

  it("includes confirmed project length in dedicated-thread patch facts", () => {
    const payload = buildPayloadForRequest({
      ...llmRequest(),
      latestUserMessage: "予約候補を相談したいです",
      notionAiThread: { threadId: "thread-b" },
      jobContext: {
        ...jobContext(),
        projectLengthMinutes: 150,
      },
    })
    const prompt = payloadPrompt(payload)

    expect(prompt).toContain("confirmed_facts: 媒体=web / 案件種別=cm-30s / 尺=150分 / 作業場所=remote-grading")
  })

  it("measures fixed-thread full resend versus dedicated-thread patch payload size", () => {
    const messages = [
      { role: "user" as const, content: "A社のWeb CM、尺は30秒です" },
      { role: "assistant" as const, content: "媒体と納期を確認します" },
      { role: "user" as const, content: "納期は7月末、リモート希望です" },
      { role: "assistant" as const, content: "素材状態と立ち会い有無を確認します" },
      { role: "user" as const, content: "オンライン立ち会いでお願いします" },
    ]
    const latestUserMessage = "見積もりに必要な情報を教えてください"
    const beforePayload = buildPayloadForRequest({
      ...llmRequest(),
      systemPrompt: "固定プロンプト全文",
      messages,
      latestUserMessage,
    })
    const afterPayload = buildPayloadForRequest({
      ...llmRequest(),
      systemPrompt: "固定プロンプト全文",
      messages,
      latestUserMessage,
      notionAiThread: { threadId: "thread-a" },
    })
    const beforePrompt = payloadPrompt(beforePayload)
    const afterPrompt = payloadPrompt(afterPayload)
    const beforeMetrics = {
      transcriptMessages: beforePayload.transcript.length,
      promptLines: beforePrompt.split("\n").length,
      promptChars: beforePrompt.length,
      postDataBytes: JSON.stringify(beforePayload).length,
    }
    const afterMetrics = {
      transcriptMessages: afterPayload.transcript.length,
      promptLines: afterPrompt.split("\n").length,
      promptChars: afterPrompt.length,
      postDataBytes: JSON.stringify(afterPayload).length,
    }

    expect(beforeMetrics).toEqual({
      transcriptMessages: 3,
      promptLines: 7,
      promptChars: 155,
      postDataBytes: 2963,
    })
    expect(afterMetrics).toEqual({
      transcriptMessages: 3,
      promptLines: 2,
      promptChars: 84,
      postDataBytes: 2886,
    })
    expect(afterPrompt.split("\n")).toEqual([
      "confirmed_facts: 媒体=web / 案件種別=cm-30s / 作業場所=remote-grading",
      "user: 見積もりに必要な情報を教えてください",
    ])
    expect(afterPrompt).not.toContain("固定プロンプト全文")
    expect(afterPrompt).not.toContain("A社のWeb CM")
  })

  it("can force a full prompt into an isolated dedicated thread for internal JSON reads", () => {
    const payload = buildPayloadForRequest({
      ...llmRequest(),
      systemPrompt: "予約フォーム初期値だけをJSONで返す",
      messages: [
        { role: "user", content: "担当者はテストユーザーです" },
        { role: "assistant", content: "候補を確認します" },
        { role: "user", content: "会社名はテスト株式会社、メールは test@example.com です" },
      ],
      latestUserMessage: undefined,
      notionAiThread: {},
      forceFullPrompt: true,
    })
    const prompt = payloadPrompt(payload)

    expect(payload).toMatchObject({
      threadId: "trace-id",
      createThread: true,
      isPartialTranscript: false,
    })
    expect(prompt.split("\n")).toEqual([
      "予約フォーム初期値だけをJSONで返す",
      "user: 担当者はテストユーザーです",
      "assistant: 候補を確認します",
      "user: 会社名はテスト株式会社、メールは test@example.com です",
    ])
  })

  it("patches selected Notion knowledge references without resending the fixed prompt", () => {
    const payload = buildPayloadForRequest({
      ...llmRequest(),
      systemPrompt: "固定プロンプトは再送しない",
      messages: [{ role: "user", content: "過去の応答も再送しない" }],
      latestUserMessage: "ライブの工程日数を知りたいです",
      notionAiThread: { threadId: "thread-b" },
      knowledgeContext: {
        selectedSourceIds: ["notion:chatbot-consultation-design"],
        notionReferencePrompt:
          "オンデマンド知識参照（TIA1/TIA2 Notion AI）:\n- AIチャットボット 相談窓口の設計: 工程別日数テーブル",
        localMirrorPrompt: "オンデマンド知識詳細（TIA3 local mirror）:\n- ライブ 60分: 7〜8日",
      },
    })
    const prompt = payloadPrompt(payload)

    expect(prompt).toContain("オンデマンド知識参照")
    expect(prompt).toContain("AIチャットボット 相談窓口の設計")
    expect(prompt).toContain("confirmed_facts: 媒体=web / 案件種別=cm-30s / 作業場所=remote-grading")
    expect(prompt).toContain("user: ライブの工程日数を知りたいです")
    expect(prompt).not.toContain("固定プロンプト")
    expect(prompt).not.toContain("7〜8日")
  })

  it("compresses only older long history while keeping recent messages and fixed slots intact", () => {
    const messages = Array.from({ length: 20 }, (_, index) => ({
      role: index % 2 === 0 ? "user" as const : "assistant" as const,
      content: `履歴${index + 1}: Web CM の相談詳細 ${index + 1}`,
    }))
    const latestUserMessage = "履歴20: Web CM の相談詳細 20"
    messages[messages.length - 1] = { role: "user", content: latestUserMessage }
    const request: ChatbotLlmRequest = {
      ...llmRequest(),
      messages,
      latestUserMessage,
      conversationState: {
        ...conversationState(),
        contactEmail: "client@example.com",
      },
      jobContext: {
        ...jobContext(),
        preferredStartDate: "2026-06-15",
      },
    }
    const payload = buildPayloadForRequest(request)
    const prompt = payloadPrompt(payload)

    expect(prompt.split("\n")).toEqual([
      "Collect only new project intake details.",
      expect.stringContaining("過去の会話要約: 古い履歴 14件を決定的に圧縮"),
      "user: 履歴15: Web CM の相談詳細 15",
      "assistant: 履歴16: Web CM の相談詳細 16",
      "user: 履歴17: Web CM の相談詳細 17",
      "assistant: 履歴18: Web CM の相談詳細 18",
      "user: 履歴19: Web CM の相談詳細 19",
      "user: 履歴20: Web CM の相談詳細 20",
    ])
    expect(prompt).not.toContain("assistant: 履歴14: Web CM の相談詳細 14")
    expect(prompt.match(new RegExp(latestUserMessage, "g"))).toHaveLength(1)
    expect(request.conversationState.contactEmail).toBe("client@example.com")
    expect(request.jobContext.preferredStartDate).toBe("2026-06-15")
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

  it("uses the observed Notion AI model codename in the browser request", async () => {
    const session = sessionReturning([
      {
        spaceId: "space-id",
        userId: "user-id",
        selectedModel: "notion-current-model",
        availableModels: ["acai-budino-high"],
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
    expect(evaluate.mock.calls[0][1]).toBe(tier1ChromeNotionAiDefaults.connectTimeoutMs)
    expect(evaluate.mock.calls[1][1]).toBe(tier1ChromeNotionAiDefaults.requestTimeoutMs)
    expect(evaluate.mock.calls[1][0]).toContain("/api/v3/runInferenceTranscript")
    expect(evaluate.mock.calls[1][0]).toContain("acai-budino-high")
  })

  it("falls back from Fable 5 High to GPT-5.5 when the first model returns invalid output", async () => {
    const session = sessionReturning([
      {
        spaceId: "space-id",
        userId: "user-id",
        selectedModel: "notion-current-model",
        availableModels: ["acai-budino-high", "opal-quince-high", "ambrosia-tart-high"],
        modelFromUser: true,
      },
      {
        ok: false,
        code: "invalid-output",
        message: 'Model resolution failed for "acai-budino-high".',
      },
      { ok: true, rawText: "GPT-5.5で復旧しました。", chunkCount: 1 },
    ])
    const client = new Tier1ChromeNotionAiClient({
      fetchClient: cdpFetch(),
      sessionFactory: async () => session,
      idFactory: vi.fn(() => "stable-id"),
    })

    await expect(client.generate(llmRequest())).resolves.toMatchObject({
      rawText: "GPT-5.5で復旧しました。",
      diagnostics: {
        notionAiModel: "opal-quince-high",
        notionAiModelFallbacks: [
          {
            model: "acai-budino-high",
            errorCode: "invalid-output",
            reason: 'Model resolution failed for "acai-budino-high".',
          },
        ],
      },
    })

    const evaluate = vi.mocked(session.evaluate)
    expect(evaluate).toHaveBeenCalledTimes(3)
    expect(evaluate.mock.calls[1][0]).toContain("acai-budino-high")
    expect(evaluate.mock.calls[2][0]).toContain("opal-quince-high")
  })

  it("falls back from GPT-5.5 to Opus 4.8 only after the second model also fails", async () => {
    const session = sessionReturning([
      {
        spaceId: "space-id",
        userId: "user-id",
        selectedModel: "notion-current-model",
        availableModels: ["acai-budino-high", "opal-quince-high", "ambrosia-tart-high"],
        modelFromUser: true,
      },
      {
        ok: false,
        code: "invalid-output",
        message: 'Model resolution failed for "acai-budino-high".',
      },
      {
        ok: false,
        code: "invalid-output",
        message: 'Model resolution failed for "opal-quince-high".',
      },
      { ok: true, rawText: "Opus 4.8で復旧しました。", chunkCount: 1 },
    ])
    const client = new Tier1ChromeNotionAiClient({
      fetchClient: cdpFetch(),
      sessionFactory: async () => session,
      idFactory: vi.fn(() => "stable-id"),
    })

    await expect(client.generate(llmRequest())).resolves.toMatchObject({
      rawText: "Opus 4.8で復旧しました。",
      diagnostics: {
        notionAiModel: "ambrosia-tart-high",
        notionAiModelFallbacks: [
          { model: "acai-budino-high", errorCode: "invalid-output" },
          { model: "opal-quince-high", errorCode: "invalid-output" },
        ],
      },
    })

    const evaluate = vi.mocked(session.evaluate)
    expect(evaluate).toHaveBeenCalledTimes(4)
    expect(evaluate.mock.calls[1][0]).toContain("acai-budino-high")
    expect(evaluate.mock.calls[2][0]).toContain("opal-quince-high")
    expect(evaluate.mock.calls[3][0]).toContain("ambrosia-tart-high")
  })

  it("uses a long inference timeout without extending runtime-context evaluation", async () => {
    const session = sessionReturning([
      {
        spaceId: "space-id",
        userId: "user-id",
        selectedModel: "notion-current-model",
        availableModels: ["acai-budino-high"],
        modelFromUser: true,
      },
      { ok: true, rawText: "12秒を超えても完了しました。", chunkCount: 1 },
    ])
    const client = new Tier1ChromeNotionAiClient({
      fetchClient: cdpFetch(),
      sessionFactory: async () => session,
      connectTimeoutMs: 12000,
      requestTimeoutMs: 180000,
    })

    await expect(client.generate(llmRequest())).resolves.toMatchObject({
      rawText: "12秒を超えても完了しました。",
    })

    const evaluate = vi.mocked(session.evaluate)
    expect(evaluate.mock.calls[0][1]).toBe(12000)
    expect(evaluate.mock.calls[1][1]).toBe(180000)
  })

  it("does not let the long inference timeout slow failed CDP attachment", async () => {
    const client = new Tier1ChromeNotionAiClient({
      fetchClient: cdpFetch(),
      sessionFactory: () => new Promise<NotionAiCdpSession>(() => undefined),
      connectTimeoutMs: 1,
      requestTimeoutMs: 180000,
    })

    await expectLlmError(client.generate(llmRequest()), {
      code: "timeout",
      isRetryable: true,
    })
  })

  it("returns healthy only when CDP and Notion AI target context are available", async () => {
    const healthySession = sessionReturning([
      {
        spaceId: "space-id",
        userId: "user-id",
        selectedModel: "notion-current-model",
        availableModels: ["acai-budino-high"],
      },
    ])
    const missingTargetClient = new Tier1ChromeNotionAiClient({
      fetchClient: cdpFetch([{ type: "page", url: "https://www.notion.so/workspace" }]),
      sessionFactory: async () => healthySession,
    })
    const healthyClient = new Tier1ChromeNotionAiClient({
      fetchClient: cdpFetch(),
      sessionFactory: async () => healthySession,
      preferredModel: "acai-budino-high",
    })

    await expect(healthyClient.isHealthy()).resolves.toBe(true)
    await expect(missingTargetClient.isHealthy()).resolves.toBe(false)

    const evaluate = vi.mocked(healthySession.evaluate)
    expect(evaluate.mock.calls[0][0]).toContain("LRU:KeyValueStore2:current-user-id")
    expect(evaluate.mock.calls[0][0]).toContain("LRU:KeyValueStore2:spaceIdToShortId")
    expect(evaluate.mock.calls[0][0]).toContain("notion-sidebar-sidebar-state")
  })

  it("launches the dedicated Tier 1 Chrome only when CDP is unreachable", async () => {
    let reachable = false
    const launchedConfigs: unknown[] = []
    const chromeLauncher = vi.fn(async (config: unknown) => {
      launchedConfigs.push(config)
      reachable = true
    })
    const fetchClient = vi.fn(async (input: string) => {
      if (!reachable) throw new Error("ECONNREFUSED")
      if (input.endsWith("/json/version")) return jsonResponse({ Browser: "Chrome" })
      if (input.endsWith("/json/list")) return jsonResponse([target])
      return jsonResponse({}, { ok: false, status: 404 })
    })
    const session = sessionReturning([
      {
        spaceId: "space-id",
        userId: "user-id",
        selectedModel: "notion-current-model",
        availableModels: ["acai-budino-high"],
      },
      { ok: true, rawText: "候補日を確認しました。", chunkCount: 1 },
    ])
    const client = new Tier1ChromeNotionAiClient({
      fetchClient,
      sessionFactory: async () => session,
      chromeLauncher,
      chromeWaitMs: 100,
    })

    await expect(client.generate(llmRequest())).resolves.toMatchObject({
      rawText: "候補日を確認しました。",
    })
    expect(chromeLauncher).toHaveBeenCalledOnce()
    expect(launchedConfigs[0]).toMatchObject({
      cdpBaseUrl: "http://127.0.0.1:9223",
      chromeProfileDir: expect.stringContaining(".cc-notion/chrome-profiles/notion-ai"),
    })
  })

  it("reuses an already reachable Tier 1 Chrome without spawning another process", async () => {
    const chromeLauncher = vi.fn(async () => undefined)
    const session = sessionReturning([
      {
        spaceId: "space-id",
        userId: "user-id",
        selectedModel: "notion-current-model",
        availableModels: ["acai-budino-high"],
      },
      { ok: true, rawText: "候補日を確認しました。", chunkCount: 1 },
    ])
    const client = new Tier1ChromeNotionAiClient({
      fetchClient: cdpFetch(),
      sessionFactory: async () => session,
      chromeLauncher,
    })

    await expect(client.generate(llmRequest())).resolves.toMatchObject({
      rawText: "候補日を確認しました。",
    })
    expect(chromeLauncher).not.toHaveBeenCalled()
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
      preferredModel: "notion-current-model",
    })

    await expect(client.isHealthy()).resolves.toBe(true)
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

  it("throws a retryable fallback error when preferred model is unavailable", async () => {
    const client = new Tier1ChromeNotionAiClient({
      fetchClient: cdpFetch(),
      sessionFactory: async () =>
        sessionReturning([
          {
            spaceId: "space-id",
            userId: "user-id",
            selectedModel: "notion-current-model",
            availableModels: ["acai-budino-high"],
          },
        ]),
      preferredModel: "preferred-policy-model",
    })

    await expectLlmError(client.generate(llmRequest()), {
      code: "connection",
      isRetryable: true,
    })
  })

  it("throws retryable invalid-output when the NDJSON stream has no assistant text", async () => {
    const client = new Tier1ChromeNotionAiClient({
      fetchClient: cdpFetch(),
      sessionFactory: async () =>
        sessionReturning([
          {
            spaceId: "space-id",
            userId: "user-id",
            selectedModel: "notion-current-model",
            availableModels: ["acai-budino-high"],
          },
          { ok: true, rawText: "", chunkCount: 1 },
        ]),
      preferredModel: "acai-budino-high",
    })

    await expectLlmError(client.generate(llmRequest()), {
      code: "invalid-output",
      isRetryable: true,
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

  it("reconstructs seeded patch-start text with subsequent patch operations", () => {
    const parsed = parseInferenceNdjsonStream(
      [
        JSON.stringify({
          type: "patch-start",
          data: {
            s: [
              {
                id: "turn-id",
                type: "agent-inference",
                value: [{ type: "text", content: "承知" }],
              },
            ],
          },
        }),
        JSON.stringify({
          type: "patch",
          v: [{ o: "a", p: "/s/0/value/0/content", v: "しました。" }],
        }),
      ].join("\n"),
    )

    expect(parsed).toMatchObject({
      partialText: "承知しました。",
      finalText: "",
      assistantText: "承知しました。",
      chunkCount: 2,
    })
  })

  it("reconstructs patch streams with top-level seeds, array paths, and renamed operation lists", () => {
    const ndjson = readFileSync(
      new URL("../../../../fixtures/chatbot/tier1/notion-run-inference-patch-array-path.ndjson", import.meta.url),
      "utf8",
    )

    expect(parseInferenceNdjsonStream(ndjson)).toMatchObject({
      partialText: "承知しました。追加です。",
      finalText: "",
      assistantText: "承知しました。追加です。",
      chunkCount: 3,
    })
  })
})
