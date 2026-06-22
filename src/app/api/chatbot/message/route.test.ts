import { NextRequest } from "next/server"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ChatbotConversation, ChatbotMessage } from "@/lib/chatbot/domain"

function request(body: unknown, cookie?: string) {
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

async function loadPost({
  session = null,
  existingConversation = null,
  existingConversationById,
  loadConversationError,
  updateConversationRoutingError,
  slackNotificationResult = { status: "skipped", reason: "disabled" },
  llmResponse = {
    rawText: "最終媒体を教えてください",
    tier: "tier-3-ollama-deepseek" as const,
  },
}: {
  session?: { user?: { id?: string; email?: string } } | null
  existingConversation?: ChatbotConversation | null
  existingConversationById?: ChatbotConversation | null
  loadConversationError?: Error
  updateConversationRoutingError?: Error
  slackNotificationResult?: Record<string, unknown>
  llmResponse?: Record<string, unknown>
} = {}) {
  vi.resetModules()

  const auth = vi.fn().mockResolvedValue(session)
  const loadConversationBySessionId = loadConversationError
    ? vi.fn().mockRejectedValue(loadConversationError)
    : vi.fn().mockResolvedValue(existingConversation)
  const loadConversationById = vi.fn().mockResolvedValue(
    existingConversationById === undefined ? existingConversation : existingConversationById,
  )
  const createConversation = vi.fn().mockResolvedValue(conversation())
  const appendMessage = vi
    .fn()
    .mockImplementation((input: { id?: string; role: ChatbotMessage["role"]; content: string }) =>
      Promise.resolve({ ...message(input.role, input.content), ...(input.id ? { id: input.id } : {}) }),
    )
  const truncateConversationFromMessage = vi.fn().mockResolvedValue({ deletedCount: 1 })
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
  const generate = vi.fn().mockResolvedValue(llmResponse)
  const sendChatbotSlackNotification = vi.fn().mockResolvedValue(slackNotificationResult)

  vi.doMock("@/auth", () => ({ auth }))
  vi.doMock("@/lib/chatbot/server", () => ({
    loadConversationBySessionId,
    loadConversationById,
    createConversation,
    appendMessage,
    truncateConversationFromMessage,
    updateConversationRouting,
    updateConversationSlackThreadTs,
    linkConversationToUser,
    loadUserChatbotContext,
    formatUserChatbotContextForPrompt,
    createTier1ChromeNotionAiClient: vi.fn(() => ({ tier: "tier-1-chrome-notion-ai" })),
    createTier2HostedChromeNotionAiClient: vi.fn(() => ({ tier: "tier-2-hosted-chrome-notion-ai" })),
    createTier3OllamaDeepSeekClient: vi.fn(() => ({ tier: "tier-3-ollama-deepseek" })),
    createTier4FormFallbackClient: vi.fn(() => ({ tier: "tier-4-form-fallback" })),
    createChatbotLlmTierOrchestrator: vi.fn(() => ({
      generate,
      isHealthy: vi.fn().mockResolvedValue(true),
    })),
  }))
  vi.doMock("@/lib/chatbot/server/slack-notifier", () => ({
    sendChatbotSlackNotification,
  }))

  const route = await import("./route")
  return {
    POST: route.POST,
    auth,
    loadConversationBySessionId,
    loadConversationById,
    createConversation,
    appendMessage,
    truncateConversationFromMessage,
    updateConversationRouting,
    updateConversationSlackThreadTs,
    linkConversationToUser,
    loadUserChatbotContext,
    formatUserChatbotContextForPrompt,
    generate,
    sendChatbotSlackNotification,
  }
}

afterEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
})

describe("POST /api/chatbot/message", () => {
  it("issues a new unauthenticated session cookie and creates a conversation", async () => {
    const route = await loadPost()

    const response = await route.POST(request({ message: "相談したいです" }))

    expect(response.status).toBe(200)
    expect(response.headers.get("set-cookie")).toContain("chatbot_session_id=")
    expect(response.headers.get("set-cookie")).toContain("HttpOnly")
    expect(route.createConversation).toHaveBeenCalledWith({
      sessionId: expect.any(String),
      userId: null,
    })
    await expect(response.json()).resolves.toMatchObject({
      conversationId: "conv_1",
      assistantMessage: { role: "assistant", content: "最終媒体を教えてください" },
      ui: { kind: "none" },
    })
  })

  it("uses the authenticated user id when creating the conversation", async () => {
    const route = await loadPost({ session: { user: { id: "user_1", email: "client@example.com" } } })

    const response = await route.POST(request({ message: "ログイン済みです" }, "chatbot_session_id=session_1"))

    expect(response.status).toBe(200)
    expect(route.createConversation).toHaveBeenCalledWith({
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

    const response = await route.POST(
      request({
        message: "編集後です",
        clientSessionId,
        clientUserMessageId,
        editTargetMessageId,
      }),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get("set-cookie")).toContain(`chatbot_session_id=${clientSessionId}`)
    expect(route.createConversation).toHaveBeenCalledWith({
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
    expect(route.createConversation).toHaveBeenCalledWith({
      sessionId: clientSessionId,
      userId: null,
    })
  })

  it("returns tier4-inquiry-form ui for deterministic tier4 fallback", async () => {
    const route = await loadPost({
      llmResponse: {
        rawText: "最終媒体を教えてください",
        tier: "tier-4-form-fallback",
      },
    })

    const response = await route.POST(request({ message: "媒体を選びます" }, "chatbot_session_id=session_1"))

    expect(response.status).toBe(200)
    expect(route.appendMessage).toHaveBeenCalledWith({
      conversationId: "conv_1",
      role: "user",
      content: "媒体を選びます",
    })
    await expect(response.json()).resolves.toMatchObject({
      tier: "tier-4-form-fallback",
      ui: { kind: "tier4-inquiry-form" },
    })
  })

  it("returns tier4-inquiry-form ui for Tier 4 fallback", async () => {
    const route = await loadPost({
      llmResponse: {
        rawText: "フォームに切り替えます",
        tier: "tier-4-form-fallback",
      },
    })

    const response = await route.POST(request({ message: "応答できない相談です" }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      tier: "tier-4-form-fallback",
      ui: { kind: "tier4-inquiry-form" },
    })
  })

  it("returns 400 for invalid body", async () => {
    const route = await loadPost()

    const response = await route.POST(request({ message: "" }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: "invalid_request" })
    expect(route.createConversation).not.toHaveBeenCalled()
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
          clientSessionId: "11111111-1111-4111-8111-111111111111",
        },
        "chatbot_session_id=session_legacy",
      ),
    )

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toMatchObject({
      error: "chatbot_operation_failed",
      operation: "message",
      failure: {
        stage: "conversation-load",
        retryable: true,
        fallback: "tier4-inquiry-form",
      },
      requestId: expect.any(String),
    })
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
        fallback: "tier4-inquiry-form",
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
