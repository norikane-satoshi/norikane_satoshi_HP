import { NextRequest } from "next/server"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ChatbotConversation, ChatbotMessage } from "@/lib/chatbot/domain"
import {
  assertChatbotLlmResponseContract,
  isChatbotLlmResponseContractError,
  normalizeChatbotLlmChoiceSet,
} from "@/lib/chatbot/server/llm-client"
import { createChatbotLlmDisplayEnvelope } from "@/lib/chatbot/server/llm-response-normalizer"
import { chatbotLeakCorpus } from "../../../../../tests/fixtures/chatbot/leak-corpus"

function request(body: unknown, cookie?: string, headers: Record<string, string> = {}) {
  const requestBody = body && typeof body === "object" && !Array.isArray(body) &&
    typeof (body as { message?: unknown }).message === "string" &&
    !("clientUserMessageId" in body)
    ? {
        clientUserMessageId: "client_msg_00000000-0000-4000-8000-000000000001",
        ...body,
      }
    : body
  return new NextRequest("http://localhost/api/chatbot/message", {
    method: "POST",
    body: JSON.stringify(requestBody),
    headers: { ...headers, ...(cookie ? { cookie } : {}) },
  })
}

function requestWithoutClientUserMessageId(body: Record<string, unknown>, cookie?: string) {
  return new NextRequest("http://localhost/api/chatbot/message", {
    method: "POST",
    body: JSON.stringify(body),
    headers: cookie ? { cookie } : undefined,
  })
}

function conversation(overrides: Partial<ChatbotConversation> = {}): ChatbotConversation {
  return {
    id: "conv_1",
    startedAt: "2026-05-26T00:00:00.000Z",
    updatedAt: "2026-05-26T00:00:00.000Z",
    status: "open",
    context: { sessionId: "session_1" },
    messages: [],
    ...overrides,
  }
}

function message(role: ChatbotMessage["role"], content: string): ChatbotMessage {
  return {
    id: `${role}_1`,
    role,
    content,
    createdAt: "2026-05-26T00:00:00.000Z",
  }
}

function withDisplayEnvelope<T extends Record<string, unknown>>(response: T): T {
  return typeof response.rawText === "string" && !("displayEnvelope" in response)
    ? { ...response, displayEnvelope: createChatbotLlmDisplayEnvelope(response.rawText) }
    : response
}

async function loadPost({
  session = null,
  existingConversation = null,
  existingConversationById,
  loadConversationError,
  truncateConversationError,
  updateConversationRoutingError,
  slackNotificationResult = { status: "skipped", reason: "disabled" },
  llmResponse = {
    rawText: "最終媒体を教えてください",
    displayEnvelope: createChatbotLlmDisplayEnvelope("最終媒体を教えてください"),
    tier: "tier-1-hosted-chrome-notion-ai" as const,
  },
}: {
  session?: { user?: { id?: string; email?: string } } | null
  existingConversation?: ChatbotConversation | null
  existingConversationById?: ChatbotConversation | null
  loadConversationError?: Error
  truncateConversationError?: Error
  updateConversationRoutingError?: Error
  slackNotificationResult?: Record<string, unknown>
  llmResponse?: Record<string, unknown>
} = {}) {
  vi.resetModules()

  const auth = vi.fn().mockResolvedValue(session)
  const loadOrCreateConversationBySessionId = loadConversationError
    ? vi.fn().mockRejectedValue(loadConversationError)
    : vi.fn().mockResolvedValue(existingConversation ?? conversation())
  const loadConversationById = vi.fn().mockResolvedValue(
    existingConversationById === undefined ? existingConversation : existingConversationById,
  )
  const appendMessage = vi
    .fn()
    .mockImplementation((input: { id?: string; role: ChatbotMessage["role"]; content: string }) =>
      Promise.resolve({ ...message(input.role, input.content), ...(input.id ? { id: input.id } : {}) }),
    )
  const truncateConversationFromMessage = truncateConversationError
    ? vi.fn().mockRejectedValue(truncateConversationError)
    : vi.fn().mockResolvedValue({ deletedCount: 1 })
  const updateConversationRouting = updateConversationRoutingError
    ? vi.fn().mockRejectedValue(updateConversationRoutingError)
    : vi.fn().mockResolvedValue(undefined)
  const updateConversationSlackThreadTs = vi.fn().mockResolvedValue(undefined)
  const linkConversationToUser = vi.fn().mockResolvedValue(undefined)
  const loadUserChatbotContext = vi.fn().mockResolvedValue({
    userId: "user_1",
    recentConversations: [],
    recentBookings: [],
    knownProfile: { finalMediums: [], jobTypes: [], workSites: [] },
    referenceUrls: [],
  })
  const formatUserChatbotContextForPrompt = vi.fn(() => "本人文脈:\n- 既存の本人文脈はありません。")
  const generate = vi.fn().mockResolvedValue(withDisplayEnvelope(llmResponse))
  const sendChatbotSlackNotification = vi.fn().mockResolvedValue(slackNotificationResult)
  const scheduleChatbotAuditPersistence = vi.fn()
  const assertChatbotMessageRequestOwnership = vi.fn().mockResolvedValue(undefined)
  const finalizeChatbotMessageRequest = vi.fn().mockResolvedValue(undefined)
  const appendChatbotMessageRequestUserMessage = vi.fn(async (input: {
    ownership: { requestKey: string }
    content: string
  }) => ({
    id: input.ownership.requestKey,
    role: "user",
    content: input.content,
    createdAt: "2026-05-26T00:00:00.000Z",
  }))
  const recoverChatbotMessageRequestUserMessage = vi.fn(async (input: {
    ownership: { requestKey: string }
    content: string
  }) => ({
    id: input.ownership.requestKey,
    role: "user",
    content: input.content,
    createdAt: "2026-05-26T00:00:02.000Z",
  }))
  const replaceChatbotMessageRequestUserMessage = vi.fn(async (input: {
    ownership: { requestKey: string }
    content: string
  }) => ({
    id: input.ownership.requestKey,
    role: "user",
    content: input.content,
    createdAt: "2026-05-26T00:00:02.000Z",
  }))
  const persistChatbotMessageFinalization = vi.fn().mockResolvedValue(undefined)
  const coordinateChatbotMessageRequest = vi.fn(async (input: {
    requestId: string
    execute: () => Promise<unknown>
  }) => ({
    requestId: input.requestId,
    result: await input.execute(),
    replayed: false,
  }))

  vi.doMock("@/auth", () => ({ auth }))
  vi.doMock("@/lib/chatbot/server", () => ({
    loadOrCreateConversationBySessionId,
    loadConversationById,
    appendMessage,
    truncateConversationFromMessage,
    updateConversationRouting,
    updateConversationSlackThreadTs,
    linkConversationToUser,
    assertChatbotLlmResponseContract,
    isChatbotLlmResponseContractError,
    normalizeChatbotLlmChoiceSet,
    loadUserChatbotContext,
    formatUserChatbotContextForPrompt,
    createTier1HostedChromeNotionAiClient: vi.fn(() => ({ tier: "tier-1-hosted-chrome-notion-ai" })),
    createTier2GeminiFlashClient: vi.fn(() => ({ tier: "tier-2-gemini-flash" })),
    createTier3FormFallbackClient: vi.fn(() => ({ tier: "tier-3-form-fallback" })),
    createChatbotLlmTierOrchestrator: vi.fn(() => ({
      generate,
      isHealthy: vi.fn().mockResolvedValue(true),
    })),
  }))
  vi.doMock("@/lib/chatbot/server/slack-notifier", () => ({
    sendChatbotSlackNotification,
  }))
  vi.doMock("@/lib/chatbot/audit/scheduler", () => ({ scheduleChatbotAuditPersistence }))
  vi.doMock("@/lib/chatbot/server/message-request-coordinator", () => ({
    ChatbotMessageCoordinationError: class ChatbotMessageCoordinationError extends Error {},
    appendChatbotMessageRequestUserMessage,
    assertChatbotMessageRequestOwnership,
    coordinateChatbotMessageRequest,
    finalizeChatbotMessageRequest,
    recoverChatbotMessageRequestUserMessage,
    replaceChatbotMessageRequestUserMessage,
    hashChatbotMessagePayload: vi.fn(() => "payload_hash"),
  }))
  vi.doMock("@/lib/chatbot/server/repository", () => ({ persistChatbotMessageFinalization }))

  const route = await import("./route")
  return {
    POST: route.POST,
    auth,
    loadOrCreateConversationBySessionId,
    loadConversationById,
    appendMessage,
    truncateConversationFromMessage,
    updateConversationRouting,
    updateConversationSlackThreadTs,
    linkConversationToUser,
    loadUserChatbotContext,
    formatUserChatbotContextForPrompt,
    generate,
    sendChatbotSlackNotification,
    scheduleChatbotAuditPersistence,
    assertChatbotMessageRequestOwnership,
    appendChatbotMessageRequestUserMessage,
    coordinateChatbotMessageRequest,
    finalizeChatbotMessageRequest,
    recoverChatbotMessageRequestUserMessage,
    replaceChatbotMessageRequestUserMessage,
    persistChatbotMessageFinalization,
  }
}

afterEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
})

describe("POST /api/chatbot/message", () => {
  it.each([
    { label: "message", body: { message: "IDなし通常送信" } },
    { label: "edit", body: { message: "IDなし編集", editTargetMessageId: "user_original" } },
  ])("rejects an id-less $label before coordination or conversation mutation", async ({ body }) => {
    const route = await loadPost()

    const response = await route.POST(requestWithoutClientUserMessageId(body, "chatbot_session_id=session_1"))

    expect(response.status).toBe(400)
    expect(route.coordinateChatbotMessageRequest).not.toHaveBeenCalled()
    expect(route.loadOrCreateConversationBySessionId).not.toHaveBeenCalled()
    expect(route.appendMessage).not.toHaveBeenCalled()
    expect(route.truncateConversationFromMessage).not.toHaveBeenCalled()
    expect(route.updateConversationRouting).not.toHaveBeenCalled()
    expect(route.generate).not.toHaveBeenCalled()
  })

  it.each(chatbotLeakCorpus)("keeps the shared leak corpus safe at API level: $id", async (item) => {
    const route = await loadPost({
      llmResponse: {
        rawText: item.rawText,
        tier: "tier-1-hosted-chrome-notion-ai",
      },
    })

    const response = await route.POST(
      request({
        message: "相談です",
        jobContext: {
          jobKind: "cm-30s",
          finalMedium: "web",
          workSite: "remote-grading",
          documentaryAttachment: { kind: "none" },
          projectLengthMinutes: 30,
        },
        conversationState: {
          hasFinalMedium: true,
          hasJobKind: true,
          hasProjectLength: true,
          hasAdditionalWork: true,
          hasDocumentaryAttachments: true,
          hasWorkSite: true,
          hasReferenceUrls: true,
          hasContactEmail: true,
          hasDesiredSchedule: false,
        },
      }),
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    const serialized = JSON.stringify(body)

    expect(serialized).not.toContain("thinking-signature")
    expect(serialized).not.toContain("almond-croissant-low")
    expect(serialized).not.toContain("<lang")
    expect(serialized).not.toContain("user said")
    expect(serialized).not.toContain("I need")
    expect(serialized).not.toContain("聞こう")

    if (item.api.assertExactText) {
      expect(body.assistantMessage.content).toBe(item.expected.text)
    }
    if (item.api.expectedUiKind) {
      expect(body.ui.kind).toBe(item.api.expectedUiKind)
    }
  })

  it("issues a new unauthenticated session cookie and loads or creates a conversation", async () => {
    const route = await loadPost()

    const response = await route.POST(request({ message: "相談したいです" }))

    expect(response.status).toBe(200)
    expect(response.headers.get("set-cookie")).toContain("chatbot_session_id=")
    expect(response.headers.get("set-cookie")).toContain("HttpOnly")
    expect(route.loadOrCreateConversationBySessionId).toHaveBeenCalledWith({
      sessionId: expect.any(String),
      userId: null,
    })
    const payload = await response.json()
    expect(payload).toMatchObject({
      requestId: expect.any(String),
      conversationId: "conv_1",
      assistantMessage: {
        role: "assistant",
        content: "まず案件種別を選んでください\n下の選択肢から選んでください。",
      },
      ui: { kind: "choice-panel", choiceSet: { id: "job-kind" } },
    })
    expect(payload).not.toHaveProperty("auditEvidence")
    expect(payload.auditDebug).toMatchObject({
      schemaVersion: "1",
      persistenceStatus: "scheduled",
      eventCount: expect.any(Number),
      stageTimings: {
        conversationLoad: expect.any(Number),
        contextPreparation: expect.any(Number),
        totalServer: expect.any(Number),
      },
    })
    expect(route.scheduleChatbotAuditPersistence).toHaveBeenCalledOnce()
    expect(route.scheduleChatbotAuditPersistence).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ eventName: "request_received", source: "server" }),
        expect.objectContaining({ eventName: "response_normalized", source: "server" }),
        expect.objectContaining({ eventName: "conversation_persisted", source: "server" }),
        expect.objectContaining({ eventName: "slack_notification_completed", source: "server" }),
      ]),
    )
  })

  it("does not expose audit diagnostics on a public hostname", async () => {
    const route = await loadPost()
    const response = await route.POST(new NextRequest("https://www.norikane.studio/api/chatbot/message", {
      method: "POST",
      body: JSON.stringify({
        message: "相談したいです",
        clientUserMessageId: "client_msg_00000000-0000-4000-8000-000000000001",
      }),
    }))

    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload).not.toHaveProperty("auditDebug")
    expect(payload).not.toHaveProperty("auditEvidence")
  })

  it("returns a coordinated replay without duplicating audit persistence", async () => {
    const route = await loadPost()
    route.coordinateChatbotMessageRequest.mockImplementationOnce(async (input: {
      execute: () => Promise<unknown>
    }) => ({
      requestId: "request_original",
      result: await input.execute(),
      replayed: true,
    }))

    const response = await route.POST(request({
      message: "相談したいです",
      clientUserMessageId: "client_msg_11111111-1111-4111-8111-111111111111",
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      requestId: "request_original",
      requestReplay: true,
      auditDebug: {
        persistenceStatus: "complete",
        eventCount: 0,
      },
    })
    expect(route.scheduleChatbotAuditPersistence).not.toHaveBeenCalled()
  })

  it("wires assistant and routing persistence into the fenced finalization", async () => {
    const route = await loadPost()
    const ownership = {
      conversationId: "conv_1",
      requestKey: "client_msg_11111111-1111-4111-8111-111111111111",
      owner: "11111111-2222-4333-8444-555555555555",
      requestVersion: 1,
    }
    route.coordinateChatbotMessageRequest.mockImplementationOnce(async (input: {
      execute: (value: typeof ownership) => Promise<unknown>
    }) => ({
      requestId: ownership.owner,
      result: await input.execute(ownership),
      replayed: false,
    }))
    route.finalizeChatbotMessageRequest.mockImplementationOnce(async (input: {
      persistBusinessData: (transaction: unknown) => Promise<void>
    }) => input.persistBusinessData("transaction"))

    const response = await route.POST(request({
      message: "相談したいです",
      clientUserMessageId: ownership.requestKey,
    }))

    expect(response.status).toBe(200)
    expect(route.assertChatbotMessageRequestOwnership).toHaveBeenCalledWith(ownership)
    expect(route.finalizeChatbotMessageRequest).toHaveBeenCalledWith(expect.objectContaining({
      ownership,
      resultJson: expect.stringContaining("assistantMessage"),
    }))
    expect(route.persistChatbotMessageFinalization).toHaveBeenCalledWith(
      "transaction",
      expect.objectContaining({
        conversationId: "conv_1",
        assistantMessage: expect.objectContaining({ role: "assistant" }),
      }),
    )
    expect(route.appendChatbotMessageRequestUserMessage).toHaveBeenCalledWith({
      ownership,
      content: "相談したいです",
    })
    expect(route.appendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ role: "user" }))
    expect(route.updateConversationRouting).not.toHaveBeenCalled()
  })

  it("wires pending recovery through the request-owner transaction", async () => {
    const requestKey = "client_msg_11111111-1111-4111-8111-111111111111"
    const route = await loadPost({
      existingConversation: conversation({
        messages: [
          { id: requestKey, role: "user", content: "途中の相談", createdAt: "2026-05-26T00:00:00.000Z" },
        ],
      }),
    })
    const ownership = {
      conversationId: "conv_1",
      requestKey,
      owner: "11111111-2222-4333-8444-555555555555",
      requestVersion: 2,
    }
    route.coordinateChatbotMessageRequest.mockImplementationOnce(async (input: {
      execute: (value: typeof ownership) => Promise<unknown>
    }) => ({
      requestId: ownership.owner,
      result: await input.execute(ownership),
      replayed: false,
    }))

    const response = await route.POST(request({
      message: "途中の相談",
      clientUserMessageId: requestKey,
      recoverClientUserMessageId: requestKey,
      pendingRequestKind: "message",
    }))

    expect(response.status).toBe(200)
    expect(route.recoverChatbotMessageRequestUserMessage).toHaveBeenCalledWith({
      ownership,
      content: "途中の相談",
    })
    expect(route.appendMessage).not.toHaveBeenCalled()
    expect(route.truncateConversationFromMessage).not.toHaveBeenCalled()
  })

  it("recovers an already-saved edit request before looking for its removed edit target", async () => {
    const requestKey = "client_msg_11111111-1111-4111-8111-111111111111"
    const route = await loadPost({
      existingConversation: conversation({
        messages: [
          { id: "user_prior", role: "user", content: "先行相談", createdAt: "2026-05-26T00:00:00.000Z" },
          { id: requestKey, role: "user", content: "編集後", createdAt: "2026-05-26T00:00:01.000Z" },
        ],
      }),
    })
    const ownership = {
      conversationId: "conv_1",
      requestKey,
      owner: "11111111-2222-4333-8444-555555555555",
      requestVersion: 2,
    }
    route.coordinateChatbotMessageRequest.mockImplementationOnce(async (input: {
      execute: (value: typeof ownership) => Promise<unknown>
    }) => ({
      requestId: ownership.owner,
      result: await input.execute(ownership),
      replayed: false,
    }))

    const response = await route.POST(request({
      message: "編集後",
      clientUserMessageId: requestKey,
      recoverClientUserMessageId: requestKey,
      editTargetMessageId: "client_msg_22222222-2222-4222-8222-222222222222",
      pendingRequestKind: "edit",
    }))

    expect(response.status).toBe(200)
    expect(route.recoverChatbotMessageRequestUserMessage).toHaveBeenCalledWith({
      ownership,
      content: "編集後",
    })
    expect(route.replaceChatbotMessageRequestUserMessage).not.toHaveBeenCalled()
    expect(route.appendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ role: "user" }))
  })

  it("wires edit replacement through the request-owner transaction", async () => {
    const requestKey = "client_msg_11111111-1111-4111-8111-111111111111"
    const route = await loadPost({
      existingConversation: conversation({
        messages: [
          { id: "user_original", role: "user", content: "編集前", createdAt: "2026-05-26T00:00:00.000Z" },
          { id: "assistant_original", role: "assistant", content: "元の回答", createdAt: "2026-05-26T00:00:01.000Z" },
        ],
      }),
    })
    const ownership = {
      conversationId: "conv_1",
      requestKey,
      owner: "11111111-2222-4333-8444-555555555555",
      requestVersion: 1,
    }
    route.coordinateChatbotMessageRequest.mockImplementationOnce(async (input: {
      execute: (value: typeof ownership) => Promise<unknown>
    }) => ({
      requestId: ownership.owner,
      result: await input.execute(ownership),
      replayed: false,
    }))

    const response = await route.POST(request({
      message: "編集後",
      clientUserMessageId: requestKey,
      editTargetMessageId: "user_original",
      pendingRequestKind: "edit",
    }))

    expect(response.status).toBe(200)
    expect(route.replaceChatbotMessageRequestUserMessage).toHaveBeenCalledWith({
      ownership,
      targetMessageId: "user_original",
      content: "編集後",
    })
    expect(route.appendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ role: "user" }))
    expect(route.truncateConversationFromMessage).not.toHaveBeenCalled()
  })

  it("uses the authenticated user id when loading or creating the conversation", async () => {
    const route = await loadPost({ session: { user: { id: "user_1", email: "client@example.com" } } })

    const response = await route.POST(request({ message: "ログイン済みです" }, "chatbot_session_id=session_1"))

    expect(response.status).toBe(200)
    expect(route.loadOrCreateConversationBySessionId).toHaveBeenCalledWith({
      sessionId: "session_1",
      userId: "user_1",
    })
    expect(route.loadUserChatbotContext).toHaveBeenCalledWith({
      userId: "user_1",
      currentConversationId: "conv_1",
    })
  })

  it("accepts client session, client user message, and edit target ids", async () => {
    const route = await loadPost()
    const clientSessionId = "11111111-1111-4111-8111-111111111111"
    const clientUserMessageId = "client_msg_11111111-1111-4111-8111-111111111111"
    const editTargetMessageId = "client_msg_22222222-2222-4222-8222-222222222222"
    const recoverClientUserMessageId = "client_msg_33333333-3333-4333-8333-333333333333"

    const response = await route.POST(
      request({
        message: "編集後です",
        clientSessionId,
        clientUserMessageId,
        editTargetMessageId,
        recoverClientUserMessageId,
        pendingRequestKind: "message",
      }),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get("set-cookie")).toContain(`chatbot_session_id=${clientSessionId}`)
    expect(route.loadOrCreateConversationBySessionId).toHaveBeenCalledWith({
      sessionId: clientSessionId,
      userId: null,
    })
    expect(route.appendMessage).toHaveBeenCalledWith({
      id: clientUserMessageId,
      conversationId: "conv_1",
      role: "user",
      content: "編集後です",
    })
    await expect(response.json()).resolves.toMatchObject({
      userMessage: { id: clientUserMessageId, role: "user", content: "編集後です" },
    })
  })

  it("recovers a stale mobile edit with an old conversation id and missing server message id", async () => {
    const route = await loadPost({
      existingConversation: conversation({
        id: "conv_current",
        messages: [
          { id: "user_last", role: "user", content: "保存済み直近", createdAt: "2026-05-26T00:00:00.000Z" },
          { id: "assistant_last", role: "assistant", content: "保存済み回答", createdAt: "2026-05-26T00:00:01.000Z" },
        ],
      }),
    })
    const clientSessionId = "11111111-1111-4111-8111-111111111111"

    const response = await route.POST(
      request({
        message: "モバイルの古い編集再送",
        conversationId: "conv_old_from_local_storage",
        clientSessionId,
        editTargetMessageId: "user_missing_from_stale_local_storage",
      }),
    )

    expect(response.status).toBe(200)
    expect(route.truncateConversationFromMessage).toHaveBeenCalledWith({
      conversationId: "conv_current",
      messageId: "user_last",
    })
    await expect(response.json()).resolves.toMatchObject({
      conversationId: "conv_current",
      userMessage: { role: "user", content: "モバイルの古い編集再送" },
    })
  })

  it("prefers the client storage session over a stale session cookie", async () => {
    const route = await loadPost()
    const clientSessionId = "11111111-1111-4111-8111-111111111111"

    const response = await route.POST(
      request(
        {
          message: "保存データ削除後の新規相談です",
          clientSessionId,
        },
        "chatbot_session_id=stale_cookie_session",
      ),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get("set-cookie")).toContain(`chatbot_session_id=${clientSessionId}`)
    expect(response.headers.get("set-cookie")).toContain("Max-Age=604800")
    expect(route.loadOrCreateConversationBySessionId).toHaveBeenCalledWith({
      sessionId: clientSessionId,
      userId: null,
    })
  })

  it("returns tier3-inquiry-form ui for deterministic tier3 fallback", async () => {
    const route = await loadPost({
      llmResponse: {
        rawText: "最終媒体を教えてください",
        tier: "tier-3-form-fallback",
      },
    })

    const response = await route.POST(request({ message: "媒体を選びます" }, "chatbot_session_id=session_1"))

    expect(response.status).toBe(200)
    expect(route.appendMessage).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: "conv_1",
      role: "user",
      content: "媒体を選びます",
    }))
    await expect(response.json()).resolves.toMatchObject({
      tier: "tier-3-form-fallback",
      ui: { kind: "tier3-inquiry-form" },
    })
  })

  it("returns tier3-inquiry-form ui for Tier 3 fallback", async () => {
    const route = await loadPost({
      llmResponse: {
        rawText: "フォームに切り替えます",
        tier: "tier-3-form-fallback",
      },
    })

    const response = await route.POST(request({ message: "応答できない相談です" }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      tier: "tier-3-form-fallback",
      ui: { kind: "tier3-inquiry-form" },
    })
  })

  it("returns 400 for invalid body", async () => {
    const route = await loadPost()

    const response = await route.POST(request({ message: "" }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: "invalid_request" })
    expect(route.loadOrCreateConversationBySessionId).not.toHaveBeenCalled()
  })

  it("returns structured failure metadata when conversation loading fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const route = await loadPost({
      loadConversationError: new Error("Invalid chatbot active choices JSON"),
    })

    const response = await route.POST(
      request(
        {
          message: "選択: web",
          conversationId: "conv_legacy",
          editTargetMessageId: "user_missing_from_stale_local_storage",
          clientSessionId: "11111111-1111-4111-8111-111111111111",
        },
        "chatbot_session_id=session_legacy",
        { "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148" },
      ),
    )

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toMatchObject({
      error: "chatbot_operation_failed",
      operation: "message",
      failure: {
        stage: "conversation-load",
        retryable: true,
        fallback: "tier3-inquiry-form",
      },
      requestId: expect.any(String),
    })
    expect(route.scheduleChatbotAuditPersistence).toHaveBeenCalledWith([
      expect.objectContaining({
        eventName: "operation_failed",
        result: "failure",
        errorCode: "message-conversation-load-failed",
      }),
    ])
    expect(consoleError).toHaveBeenCalledWith(
      "[CHATBOT_OPERATION_FAILURE]",
      expect.stringContaining("\"operation\":\"message\""),
    )
    expect(consoleError).toHaveBeenCalledWith(
      "[CHATBOT_OPERATION_FAILURE]",
      expect.stringContaining("\"isChoicePanelSelection\":true"),
    )
    expect(consoleError).toHaveBeenCalledWith(
      "[CHATBOT_OPERATION_FAILURE]",
      expect.stringContaining("\"requestId\":\""),
    )
    expect(consoleError).not.toHaveBeenCalledWith(
      "[CHATBOT_OPERATION_FAILURE]",
      expect.stringContaining("Mozilla/5.0"),
    )
    expect(consoleError).not.toHaveBeenCalledWith(
      "[CHATBOT_OPERATION_FAILURE]",
      expect.stringContaining("conv_legacy"),
    )
    expect(consoleError).not.toHaveBeenCalledWith(
      "[CHATBOT_OPERATION_FAILURE]",
      expect.stringContaining("session_legacy"),
    )
    expect(consoleError).toHaveBeenCalledWith(
      "[CHATBOT_OPERATION_FAILURE]",
      expect.stringContaining("\"hasEditTargetMessageId\":true"),
    )
    expect(consoleError).toHaveBeenCalledWith(
      "[CHATBOT_OPERATION_FAILURE]",
      expect.stringContaining("\"editTargetMessageIdKind\":\"server\""),
    )
    expect(consoleError).not.toHaveBeenCalledWith(
      "[CHATBOT_OPERATION_FAILURE]",
      expect.stringContaining("user_missing_from_stale_local_storage"),
    )
    consoleError.mockRestore()
  })

  it("returns request-scoped conversation-save metadata when routing persistence fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const route = await loadPost({
      existingConversation: conversation({
        context: {
          sessionId: "session_1",
          activeChoices: {
            id: "final-medium",
            question: "最終媒体を教えてください",
            selectionMode: "single",
            choices: [{ id: "web", label: "Web" }],
          },
        },
      }),
      updateConversationRoutingError: new Error("Unknown argument `currentQuestion`"),
    })

    const response = await route.POST(
      request(
        {
          message: "選択: web",
          clientSessionId: "11111111-1111-4111-8111-111111111111",
        },
        "chatbot_session_id=session_1",
      ),
    )

    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body).toMatchObject({
      error: "chatbot_operation_failed",
      requestId: expect.any(String),
      operation: "message",
      failure: {
        stage: "conversation-save",
        retryable: true,
        fallback: "tier3-inquiry-form",
      },
    })
    expect(consoleError).toHaveBeenCalledWith(
      "[CHATBOT_OPERATION_FAILURE]",
      expect.stringContaining("\"stage\":\"conversation-save\""),
    )
    expect(consoleError).toHaveBeenCalledWith(
      "[CHATBOT_OPERATION_FAILURE]",
      expect.stringContaining("\"dbWrite\":\"updateConversationRouting\""),
    )
    consoleError.mockRestore()
  })

  it("classifies edited-turn truncation failures as conversation-save failures", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const error = new Error("Driver adapter failed")
    error.stack = "DriverAdapterError: Driver adapter failed\n    at truncateConversationFromMessage (repository.ts:175:1)"
    const route = await loadPost({
      existingConversation: conversation({
        messages: [
          { id: "user_last", role: "user", content: "再テスト", createdAt: "2026-08-24T13:55:16.761Z" },
        ],
      }),
      truncateConversationError: error,
    })

    const response = await route.POST(
      request({
        message: "再テストします",
        conversationId: "conv_1",
        clientSessionId: "11111111-1111-4111-8111-111111111111",
        editTargetMessageId: "user_last",
      }),
    )

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toMatchObject({
      error: "chatbot_operation_failed",
      failure: {
        stage: "conversation-save",
        retryable: true,
        fallback: "tier3-inquiry-form",
      },
    })
    expect(route.scheduleChatbotAuditPersistence).toHaveBeenCalledWith([
      expect.objectContaining({
        eventName: "operation_failed",
        result: "failure",
        errorCode: "message-conversation-save-failed",
      }),
    ])
    expect(consoleError).toHaveBeenCalledWith(
      "[CHATBOT_OPERATION_FAILURE]",
      expect.stringContaining("\"stage\":\"conversation-save\""),
    )
    consoleError.mockRestore()
  })

  it("posts message failures into an existing Slack thread when the conversation can be loaded by id", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const route = await loadPost({
      loadConversationError: new Error("Invalid chatbot active choices JSON"),
      existingConversationById: conversation({
        id: "conv_threaded",
        context: { sessionId: "session_threaded", slackThreadTs: "1700000000.000100" },
      }),
      slackNotificationResult: { status: "sent", ts: "1700000000.000200" },
    })

    const response = await route.POST(
      request(
        {
          message: "選択: web",
          conversationId: "conv_threaded",
          clientSessionId: "11111111-1111-4111-8111-111111111111",
        },
        "chatbot_session_id=session_legacy",
      ),
    )

    expect(response.status).toBe(500)
    expect(route.loadConversationById).toHaveBeenCalledWith("conv_threaded")
    expect(route.sendChatbotSlackNotification).toHaveBeenCalledWith(expect.objectContaining({
      kind: "issue",
      conversationId: "conv_threaded",
      sessionId: "session_threaded",
      threadTs: "1700000000.000100",
      issueReasons: ["message-conversation-load"],
    }))
    expect(route.updateConversationSlackThreadTs).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it("saves a new Slack thread ts for message failures when a real conversation is found", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const route = await loadPost({
      loadConversationError: new Error("Invalid chatbot conversation state JSON"),
      existingConversationById: conversation({
        id: "conv_unthreaded",
        context: { sessionId: "session_unthreaded" },
      }),
      slackNotificationResult: { status: "sent", ts: "1700000000.000300" },
    })

    const response = await route.POST(
      request(
        {
          message: "選択: web",
          conversationId: "conv_unthreaded",
          clientSessionId: "11111111-1111-4111-8111-111111111111",
        },
        "chatbot_session_id=session_legacy",
      ),
    )

    expect(response.status).toBe(500)
    expect(route.sendChatbotSlackNotification).toHaveBeenCalledWith(expect.objectContaining({
      kind: "issue",
      conversationId: "conv_unthreaded",
      threadTs: undefined,
    }))
    expect(route.updateConversationSlackThreadTs).toHaveBeenCalledWith({
      conversationId: "conv_unthreaded",
      slackThreadTs: "1700000000.000300",
    })
    consoleError.mockRestore()
  })
})
