import { NextRequest } from "next/server"
import { afterEach, describe, expect, it, vi } from "vitest"

import { finalMediumChoices } from "@/lib/chatbot/domain"
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
  llmResponse = {
    rawText: "最終媒体を教えてください",
    tier: "tier-2-ollama-deepseek" as const,
    proposedRoutingDecision: {
      kind: "continue" as const,
      nextQuestion: "最終媒体を教えてください",
      presentChoices: finalMediumChoices,
    },
  },
}: {
  session?: { user?: { id?: string; email?: string } } | null
  existingConversation?: ChatbotConversation | null
  llmResponse?: Record<string, unknown>
} = {}) {
  vi.resetModules()

  const auth = vi.fn().mockResolvedValue(session)
  const loadConversationBySessionId = vi.fn().mockResolvedValue(existingConversation)
  const createConversation = vi.fn().mockResolvedValue(conversation())
  const appendMessage = vi
    .fn()
    .mockImplementation((input: { role: ChatbotMessage["role"]; content: string }) =>
      Promise.resolve(message(input.role, input.content)),
    )
  const updateConversationRouting = vi.fn().mockResolvedValue(undefined)
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

  vi.doMock("@/auth", () => ({ auth }))
  vi.doMock("@/lib/chatbot/server", () => ({
    loadConversationBySessionId,
    createConversation,
    appendMessage,
    updateConversationRouting,
    linkConversationToUser,
    loadUserChatbotContext,
    formatUserChatbotContextForPrompt,
    createTier1ChromeNotionAiClient: vi.fn(() => ({ tier: "tier-1-chrome-notion-ai" })),
    createTier2OllamaDeepSeekClient: vi.fn(() => ({ tier: "tier-2-ollama-deepseek" })),
    createTier4FormFallbackClient: vi.fn(() => ({ tier: "tier-4-form-fallback" })),
    createChatbotLlmTierOrchestrator: vi.fn(() => ({
      generate,
      isHealthy: vi.fn().mockResolvedValue(true),
    })),
  }))

  const route = await import("./route")
  return {
    POST: route.POST,
    auth,
    loadConversationBySessionId,
    createConversation,
    appendMessage,
    updateConversationRouting,
    linkConversationToUser,
    loadUserChatbotContext,
    formatUserChatbotContextForPrompt,
    generate,
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
      ui: { kind: "choice-panel" },
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

  it("returns assistant message and choice-panel ui on orchestrator success", async () => {
    const route = await loadPost()

    const response = await route.POST(request({ message: "媒体を選びます" }, "chatbot_session_id=session_1"))

    expect(response.status).toBe(200)
    expect(route.appendMessage).toHaveBeenCalledWith({
      conversationId: "conv_1",
      role: "user",
      content: "媒体を選びます",
    })
    await expect(response.json()).resolves.toMatchObject({
      tier: "tier-2-ollama-deepseek",
      ui: { kind: "choice-panel", choiceSet: { id: "final-medium" } },
    })
  })

  it("returns tier4-inquiry-form ui for Tier 4 fallback", async () => {
    const route = await loadPost({
      llmResponse: {
        rawText: "フォームに切り替えます",
        tier: "tier-4-form-fallback",
        proposedRoutingDecision: { kind: "continue", nextQuestion: "フォームに切り替えます" },
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
})
