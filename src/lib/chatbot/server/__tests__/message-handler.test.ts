import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({ prisma: {} }))

import type { ChatbotConversation, ChatbotMessage } from "@/lib/chatbot/domain"
import {
  additionalWorkChoices,
  finalMediumChoices,
  remoteWorkSiteConfirmationChoices,
  workSiteChoices,
} from "@/lib/chatbot/domain"
import { handleChatbotMessage } from "@/lib/chatbot/server/message-handler"
import type { UserChatbotContext } from "@/lib/chatbot/server/user-context-loader"

function conversation(overrides: Partial<ChatbotConversation> = {}): ChatbotConversation {
  return {
    id: "conv_1",
    startedAt: "2026-05-26T00:00:00.000Z",
    updatedAt: "2026-05-26T00:00:00.000Z",
    status: "open",
    context: { sessionId: "session_1", userId: "user_a" },
    messages: [{ id: "old_user_1", role: "user", content: "current session text", createdAt: "2026-05-26T00:00:00.000Z" }],
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

function userContext(overrides: Partial<UserChatbotContext> = {}): UserChatbotContext {
  return {
    userId: "user_a",
    recentConversations: [
      {
        id: "conv_past_1",
        subject: "過去案件",
        finalMedium: "web",
        jobType: "short movie",
        workSite: "remote-grading",
        summaryText: "本人だけの過去要約",
        lastMessageAt: "2026-05-25T00:00:00.000Z",
      },
    ],
    recentBookings: [],
    knownProfile: { finalMediums: ["web"], jobTypes: ["short movie"], workSites: ["remote-grading"] },
    referenceUrls: ["https://a.example/ref"],
    ...overrides,
  }
}

async function waitForMockCalls(mock: { mock: { calls: unknown[] } }, count: number): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (mock.mock.calls.length >= count) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

function bookingInput() {
  return {
    projectTitle: "テスト案件",
    dueDate: "2026-07-31",
    companyName: "テスト株式会社",
    contactName: "テストユーザー",
    sessionEmail: "customer@example.com",
    phone: "",
    memo: "",
    agreed: true,
    selectedSlots: [
      {
        start: "2026-07-01T01:00:00.000Z",
        end: "2026-07-01T02:00:00.000Z",
      },
    ],
  }
}

function setup(overrides: {
  existingConversation?: ChatbotConversation | null
  isolatedConversation?: ChatbotConversation | null
} = {}) {
  const existingConversation =
    "existingConversation" in overrides ? overrides.existingConversation : conversation()
  const isolatedConversation =
    "isolatedConversation" in overrides
      ? overrides.isolatedConversation
      : conversation({
          id: "conv_isolated",
          context: { sessionId: "session_1:user_b", userId: "user_b" },
          messages: [],
        })
  const repository = {
    loadConversationBySessionId: vi.fn(async (sessionId: string) => {
      if (sessionId === "session_1") return existingConversation ?? null
      if (sessionId === "session_1:user_b") return isolatedConversation ?? null
      if (sessionId === "session_1:anonymous") {
        return conversation({
          id: "conv_anonymous",
          context: { sessionId: "session_1:anonymous" },
          messages: [],
        })
      }
      return null
    }),
    createConversation: vi.fn(async (input: { sessionId: string; userId?: string | null }) =>
      conversation({
        id: `created_${input.sessionId}`,
        context: { sessionId: input.sessionId, ...(input.userId ? { userId: input.userId } : {}) },
        messages: [],
      }),
    ),
    appendMessage: vi
      .fn()
      .mockImplementation((input: { id?: string; role: ChatbotMessage["role"]; content: string; llmModel?: string | null }) =>
        Promise.resolve({
          ...message(input.role, input.content),
          ...(input.id ? { id: input.id } : {}),
          ...(input.llmModel ? { llmModel: input.llmModel } : {}),
        }),
      ),
    truncateConversationFromMessage: vi.fn().mockResolvedValue({ deletedCount: 0 }),
    updateConversationRouting: vi.fn(),
    linkConversationToUser: vi.fn(),
    setConversationNotionAiThreadId: vi.fn(),
  }
  const generate = vi.fn().mockResolvedValue({
    rawText: "返信です",
    tier: "tier-3-ollama-deepseek",
    proposedRoutingDecision: { kind: "continue", nextQuestion: "次の質問" },
  })
  const userContextLoader = vi.fn().mockResolvedValue(userContext())
  const userContextFormatter = vi.fn().mockReturnValue("本人文脈:\n- 本人だけの過去要約")
  const candidateWindowFinder = vi.fn().mockResolvedValue([
    {
      start: "2026-06-15T01:00:00.000Z",
      end: "2026-06-15T02:00:00.000Z",
      label: "6月15日 10:00",
      note: "1時間候補",
      available: true,
    },
  ])

  return {
    repository,
    generate,
    userContextLoader,
    userContextFormatter,
    candidateWindowFinder,
    operatorNotificationSender: vi.fn().mockResolvedValue({ status: "sent", id: "email_1" }),
    options: {
      repository,
      orchestratorFactory: () => ({ generate, isHealthy: vi.fn() }),
      userContextLoader,
      userContextFormatter,
      candidateWindowFinder,
    },
  }
}

describe("handleChatbotMessage user context", () => {
  it("keeps the fixed-thread request shape when dedicated Notion AI threads are disabled", async () => {
    const harness = setup({
      existingConversation: conversation({
        context: { sessionId: "session_1", userId: "user_a", notionAiThreadId: "thread-existing" },
      }),
    })

    await handleChatbotMessage(
      { sessionId: "session_1", userId: "user_a", message: "相談です" },
      { ...harness.options, dedicatedNotionAiThreadsEnabled: false },
    )

    expect(harness.generate.mock.calls[0]?.[0]).not.toHaveProperty("notionAiThread")
    expect(harness.generate.mock.calls[0]?.[0].messages).toEqual([
      { role: "user", content: "current session text" },
      { role: "user", content: "相談です" },
    ])
    expect(harness.repository.setConversationNotionAiThreadId).not.toHaveBeenCalled()
  })

  it("injects the Phase 1 create_booking tool definition into the main prompt", async () => {
    const harness = setup()

    await handleChatbotMessage(
      { sessionId: "session_1", userId: "user_a", message: "相談です" },
      harness.options,
    )

    const systemPrompt = harness.generate.mock.calls[0]?.[0].systemPrompt
    expect(systemPrompt).toContain("利用可能ツール:")
    expect(systemPrompt).toContain("create_booking")
    expect(systemPrompt).toContain('{"tool":"create_booking","args":{...}}')
    expect(systemPrompt).not.toContain("show_booking_card")
    expect(systemPrompt).not.toContain("get_estimate")
  })

  it("uses dedicated Notion AI threads by default", async () => {
    const previous = process.env.CHATBOT_TIER1_DEDICATED_NOTION_AI_THREADS
    delete process.env.CHATBOT_TIER1_DEDICATED_NOTION_AI_THREADS
    const harness = setup({ existingConversation: null })

    try {
      await handleChatbotMessage(
        { sessionId: "session_1", userId: "user_a", message: "初回相談です" },
        harness.options,
      )
    } finally {
      if (previous === undefined) {
        delete process.env.CHATBOT_TIER1_DEDICATED_NOTION_AI_THREADS
      } else {
        process.env.CHATBOT_TIER1_DEDICATED_NOTION_AI_THREADS = previous
      }
    }

    expect(harness.generate.mock.calls[0]?.[0].notionAiThread).toEqual({})
  })

  it("stores the created Notion AI thread id after the first dedicated-thread Tier 1 turn", async () => {
    const harness = setup({ existingConversation: null })
    harness.generate.mockResolvedValueOnce({
      rawText: "返信です",
      tier: "tier-1-chrome-notion-ai",
      diagnostics: {
        notionAiThreadId: "thread-created-a",
        notionAiThreadCreated: true,
      },
      proposedRoutingDecision: { kind: "continue", nextQuestion: "次の質問" },
    })

    await handleChatbotMessage(
      { sessionId: "session_1", userId: "user_a", message: "初回相談です" },
      { ...harness.options, dedicatedNotionAiThreadsEnabled: true },
    )

    expect(harness.generate.mock.calls[0]?.[0].notionAiThread).toEqual({})
    expect(harness.repository.setConversationNotionAiThreadId).toHaveBeenCalledWith({
      conversationId: "created_session_1",
      threadId: "thread-created-a",
    })
  })

  it("keeps separate conversation ids bound to their own Notion AI thread ids", async () => {
    const harnessA = setup({
      existingConversation: conversation({
        id: "conv_a",
        context: { sessionId: "session_a", userId: "user_a", notionAiThreadId: "thread-a" },
        messages: [{ id: "a_old", role: "user", content: "Aだけの過去発言", createdAt: "2026-05-26T00:00:00.000Z" }],
      }),
    })
    harnessA.repository.loadConversationBySessionId.mockImplementation(async (sessionId: string) => {
      if (sessionId === "session_a") {
        return conversation({
          id: "conv_a",
          context: { sessionId: "session_a", userId: "user_a", notionAiThreadId: "thread-a" },
          messages: [{ id: "a_old", role: "user", content: "Aだけの過去発言", createdAt: "2026-05-26T00:00:00.000Z" }],
        })
      }
      return null
    })
    const harnessB = setup({
      existingConversation: conversation({
        id: "conv_b",
        context: { sessionId: "session_b", userId: "user_b", notionAiThreadId: "thread-b" },
        messages: [{ id: "b_old", role: "user", content: "Bだけの過去発言", createdAt: "2026-05-26T00:00:00.000Z" }],
      }),
    })
    harnessB.repository.loadConversationBySessionId.mockImplementation(async (sessionId: string) => {
      if (sessionId === "session_b") {
        return conversation({
          id: "conv_b",
          context: { sessionId: "session_b", userId: "user_b", notionAiThreadId: "thread-b" },
          messages: [{ id: "b_old", role: "user", content: "Bだけの過去発言", createdAt: "2026-05-26T00:00:00.000Z" }],
        })
      }
      return null
    })

    await handleChatbotMessage(
      { sessionId: "session_a", userId: "user_a", message: "Aの新規発言" },
      { ...harnessA.options, dedicatedNotionAiThreadsEnabled: true },
    )
    await handleChatbotMessage(
      { sessionId: "session_b", userId: "user_b", message: "Bの新規発言" },
      { ...harnessB.options, dedicatedNotionAiThreadsEnabled: true },
    )

    expect(harnessA.generate.mock.calls[0]?.[0]).toMatchObject({
      notionAiThread: { threadId: "thread-a" },
      messages: [
        { role: "user", content: "Aだけの過去発言" },
        { role: "user", content: "Aの新規発言" },
      ],
    })
    expect(JSON.stringify(harnessA.generate.mock.calls[0]?.[0])).not.toContain("Bだけの過去発言")
    expect(harnessB.generate.mock.calls[0]?.[0]).toMatchObject({
      notionAiThread: { threadId: "thread-b" },
      messages: [
        { role: "user", content: "Bだけの過去発言" },
        { role: "user", content: "Bの新規発言" },
      ],
    })
    expect(JSON.stringify(harnessB.generate.mock.calls[0]?.[0])).not.toContain("Aだけの過去発言")
  })

  it("loads authenticated user context and injects it into the system prompt", async () => {
    const harness = setup()

    await handleChatbotMessage(
      { sessionId: "session_1", userId: "user_a", message: "相談です" },
      harness.options,
    )

    expect(harness.userContextLoader).toHaveBeenCalledWith({
      userId: "user_a",
      currentConversationId: "conv_1",
    })
    expect(harness.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: expect.stringContaining("本人だけの過去要約"),
      }),
    )
    expect(harness.generate.mock.calls[0]?.[0].systemPrompt).toContain("必要時だけ参照")
    expect(harness.generate.mock.calls[0]?.[0].systemPrompt).toContain("知識索引")
    expect(harness.generate.mock.calls[0]?.[0].systemPrompt).toContain("/notes/correction")
    expect(harness.generate.mock.calls[0]?.[0].systemPrompt).not.toContain("その先にあるもの")
    expect(harness.generate.mock.calls[0]?.[0].systemPrompt).toContain("案件種類")
    expect(harness.generate.mock.calls[0]?.[0].systemPrompt).toContain("1返答で質問は最大3問")
    expect(harness.generate.mock.calls[0]?.[0].systemPrompt).toContain("呼称は中立に保ち")
    expect(harness.generate.mock.calls[0]?.[0].systemPrompt).toContain("メールアドレス（必須）")
  })

  it("attaches only selected on-demand knowledge references for schedule and color topics", async () => {
    const harness = setup()

    await handleChatbotMessage(
      {
        sessionId: "session_1",
        userId: "user_a",
        message: "ライブの工程日数とカラコレの考え方を知りたいです",
      },
      harness.options,
    )

    expect(harness.generate.mock.calls[0]?.[0].knowledgeContext).toMatchObject({
      selectedSourceIds: expect.arrayContaining([
        "notion:chatbot-consultation-design",
        "15103996-61d6-4891-aee9-12320df39b91",
      ]),
      notionReferencePrompt: expect.stringContaining("AIチャットボット 相談窓口の設計"),
      localMirrorPrompt: expect.stringContaining("ライブ 60分: 7〜8日"),
    })
  })

  it("does not load user context for unauthenticated requests", async () => {
    const harness = setup({ existingConversation: conversation({ context: { sessionId: "session_1" } }) })

    await handleChatbotMessage({ sessionId: "session_1", message: "未ログインです" }, harness.options)

    expect(harness.userContextLoader).not.toHaveBeenCalled()
    expect(harness.generate.mock.calls[0]?.[0].systemPrompt).not.toContain("本人だけの過去要約")
  })

  it("does not expose user context in the API result", async () => {
    const harness = setup()

    const result = await handleChatbotMessage(
      { sessionId: "session_1", userId: "user_a", message: "相談です" },
      harness.options,
    )

    expect(JSON.stringify(result)).not.toContain("本人だけの過去要約")
    expect(result).toEqual(
      expect.objectContaining({
        conversationId: "conv_1",
        assistantMessage: expect.objectContaining({ content: "返信です" }),
      }),
    )
  })

  it("stores and returns sanitized assistant text", async () => {
    const harness = setup()
    harness.generate.mockResolvedValueOnce({
      rawText: "<think>内部推論です。</think>\n\n最終媒体と尺を教えてください。",
      tier: "tier-3-ollama-deepseek",
      proposedRoutingDecision: { kind: "continue", nextQuestion: "次の質問" },
    })

    const result = await handleChatbotMessage(
      { sessionId: "session_1", userId: "user_a", message: "相談です" },
      harness.options,
    )

    expect(harness.repository.appendMessage).toHaveBeenCalledWith({
      conversationId: "conv_1",
      role: "assistant",
      content: "最終媒体と尺を教えてください。",
      llmModel: "tier-3-ollama-deepseek",
    })
    expect(result.assistantMessage.content).toBe("最終媒体と尺を教えてください。")
  })

  it("uses the supplied client user message id for the persisted user message", async () => {
    const harness = setup()

    const result = await handleChatbotMessage(
      {
        sessionId: "session_1",
        userId: "user_a",
        message: "キャンセルしても編集したいです",
        clientUserMessageId: "client_msg_00000000-0000-4000-8000-000000000001",
      },
      harness.options,
    )

    expect(harness.repository.appendMessage).toHaveBeenCalledWith({
      id: "client_msg_00000000-0000-4000-8000-000000000001",
      conversationId: "conv_1",
      role: "user",
      content: "キャンセルしても編集したいです",
    })
    expect(result.userMessage.id).toBe("client_msg_00000000-0000-4000-8000-000000000001")
  })

  it("truncates from the edited user message before regenerating from the edited text", async () => {
    const harness = setup({
      existingConversation: conversation({
        messages: [
          { id: "keep_user", role: "user", content: "最初の相談です", createdAt: "2026-05-26T00:00:00.000Z" },
          { id: "edit_user", role: "user", content: "古い条件です", createdAt: "2026-05-26T00:01:00.000Z" },
          { id: "old_assistant", role: "assistant", content: "古い応答です", createdAt: "2026-05-26T00:02:00.000Z" },
        ],
        context: {
          sessionId: "session_1",
          userId: "user_a",
          activeChoices: finalMediumChoices,
          currentQuestion: "最終媒体は何になりますか？",
          conversationState: { hasFinalMedium: true, turnCount: 2 },
          jobContext: { finalMedium: "cinema" },
        },
      }),
    })

    const result = await handleChatbotMessage(
      {
        sessionId: "session_1",
        userId: "user_a",
        message: "編集後の条件です",
        editTargetMessageId: "edit_user",
      },
      harness.options,
    )

    expect(harness.repository.truncateConversationFromMessage).toHaveBeenCalledWith({
      conversationId: "conv_1",
      messageId: "edit_user",
    })
    expect(harness.generate.mock.calls[0]?.[0].messages).toEqual([
      { role: "user", content: "最初の相談です" },
      { role: "user", content: "編集後の条件です" },
    ])
    expect(harness.generate.mock.calls[0]?.[0].jobContext).toMatchObject({
      finalMedium: "other",
      workSite: "remote-grading",
    })
    expect(result.userMessage).toMatchObject({
      id: "user_1",
      role: "user",
      content: "編集後の条件です",
    })
  })

  it("recovers an edit from a canceled client user message that was not persisted", async () => {
    const harness = setup({
      existingConversation: conversation({
        context: {
          sessionId: "session_1",
          userId: "user_a",
          notionAiThreadId: "thread-before-cancel",
        },
        messages: [
          { id: "keep_user", role: "user", content: "最初の相談です", createdAt: "2026-05-26T00:00:00.000Z" },
          { id: "keep_assistant", role: "assistant", content: "最初の応答です", createdAt: "2026-05-26T00:01:00.000Z" },
        ],
      }),
    })
    harness.generate.mockResolvedValueOnce({
      rawText: "返信です",
      tier: "tier-1-chrome-notion-ai",
      diagnostics: {
        notionAiThreadId: "thread-after-edit",
        notionAiThreadCreated: true,
      },
      proposedRoutingDecision: { kind: "continue", nextQuestion: "次の質問" },
    })

    const result = await handleChatbotMessage(
      {
        sessionId: "session_1",
        userId: "user_a",
        message: "停止後に編集した条件です",
        editTargetMessageId: "client_msg_00000000-0000-4000-8000-000000000001",
      },
      harness.options,
    )

    expect(harness.repository.truncateConversationFromMessage).toHaveBeenCalledWith({
      conversationId: "conv_1",
      messageId: "keep_user",
    })
    expect(harness.repository.appendMessage).toHaveBeenCalledWith({
      id: undefined,
      conversationId: "conv_1",
      role: "user",
      content: "停止後に編集した条件です",
    })
    expect(harness.generate.mock.calls[0]?.[0].messages).toEqual([
      { role: "user", content: "停止後に編集した条件です" },
    ])
    expect(harness.generate.mock.calls[0]?.[0].notionAiThread).toEqual({})
    expect(harness.repository.setConversationNotionAiThreadId).toHaveBeenCalledWith({
      conversationId: "conv_1",
      threadId: "thread-after-edit",
    })
    expect(result.userMessage).toMatchObject({
      role: "user",
      content: "停止後に編集した条件です",
    })
  })

  it("serializes same-session generation so cancel/edit retries do not overlap a Notion AI thread", async () => {
    const harness = setup()
    let releaseFirstGenerate: (() => void) | undefined
    harness.generate
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseFirstGenerate = () =>
              resolve({
                rawText: "最初の返信です",
                tier: "tier-1-chrome-notion-ai",
                proposedRoutingDecision: { kind: "continue", nextQuestion: "次の質問" },
              })
          }),
      )
      .mockResolvedValueOnce({
        rawText: "編集後の返信です",
        tier: "tier-1-chrome-notion-ai",
        proposedRoutingDecision: { kind: "continue", nextQuestion: "次の質問" },
      })

    const first = handleChatbotMessage(
      { sessionId: "session_1", userId: "user_a", message: "キャンセル前の条件です" },
      harness.options,
    )
    await waitForMockCalls(harness.generate, 1)
    expect(harness.generate).toHaveBeenCalledTimes(1)

    const second = handleChatbotMessage(
      {
        sessionId: "session_1",
        userId: "user_a",
        message: "編集後の条件です",
        editTargetMessageId: "client_msg_00000000-0000-4000-8000-000000000001",
      },
      harness.options,
    )
    await Promise.resolve()
    expect(harness.generate).toHaveBeenCalledTimes(1)

    releaseFirstGenerate?.()
    await first
    await second

    expect(harness.generate).toHaveBeenCalledTimes(2)
    expect(harness.generate.mock.calls[1]?.[0].latestUserMessage).toBe("編集後の条件です")
  })

  it("serializes different conversations through the single Tier 1 Chrome path", async () => {
    const harness = setup()
    harness.repository.loadConversationBySessionId.mockImplementation(async (sessionId: string) => {
      if (sessionId === "session_a") {
        return conversation({
          id: "conv_a",
          context: { sessionId: "session_a", userId: "user_a", notionAiThreadId: "thread-a" },
          messages: [],
        })
      }
      if (sessionId === "session_b") {
        return conversation({
          id: "conv_b",
          context: { sessionId: "session_b", userId: "user_b", notionAiThreadId: "thread-b" },
          messages: [],
        })
      }
      return null
    })
    let releaseFirstGenerate: (() => void) | undefined
    harness.generate
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseFirstGenerate = () =>
              resolve({
                rawText: "Aの返信です",
                tier: "tier-1-chrome-notion-ai",
                proposedRoutingDecision: { kind: "continue", nextQuestion: "次の質問" },
              })
          }),
      )
      .mockResolvedValueOnce({
        rawText: "Bの返信です",
        tier: "tier-1-chrome-notion-ai",
        proposedRoutingDecision: { kind: "continue", nextQuestion: "次の質問" },
      })

    const first = handleChatbotMessage(
      { sessionId: "session_a", userId: "user_a", message: "Aの新規発言" },
      { ...harness.options, dedicatedNotionAiThreadsEnabled: true },
    )
    await waitForMockCalls(harness.generate, 1)

    const second = handleChatbotMessage(
      { sessionId: "session_b", userId: "user_b", message: "Bの新規発言" },
      { ...harness.options, dedicatedNotionAiThreadsEnabled: true },
    )
    await Promise.resolve()
    expect(harness.generate).toHaveBeenCalledTimes(1)

    releaseFirstGenerate?.()
    await first
    await second

    expect(harness.generate).toHaveBeenCalledTimes(2)
    expect(harness.generate.mock.calls[0]?.[0].notionAiThread).toEqual({ threadId: "thread-a" })
    expect(harness.generate.mock.calls[1]?.[0].notionAiThread).toEqual({ threadId: "thread-b" })
  })

  it("overrides pricing output with direct contact policy", async () => {
    const harness = setup()
    harness.generate.mockResolvedValueOnce({
      rawText: "概算で10万円です。",
      tier: "tier-3-ollama-deepseek",
      proposedRoutingDecision: { kind: "continue", nextQuestion: "次の質問" },
    })

    const result = await handleChatbotMessage(
      { sessionId: "session_1", userId: "user_a", message: "料金はいくらですか" },
      harness.options,
    )

    expect(result.routingDecision).toMatchObject({
      kind: "to-direct-contact",
      reason: "pricing",
    })
    expect(result.assistantMessage.content).toContain("のりかね本人")
    expect(result.assistantMessage.content).not.toMatch(/\d+万円|¥|￥/u)
  })

  it("keeps first-turn inquiry intake when the LLM proposes early direct contact", async () => {
    const harness = setup({ existingConversation: null })
    harness.generate.mockResolvedValueOnce({
      rawText: "連絡先を教えてください。",
      tier: "tier-1-chrome-notion-ai",
      proposedRoutingDecision: {
        kind: "to-direct-contact",
        reason: "pricing",
        requireEmail: true,
        suggestedMessage: "メールアドレス、会社名、お名前を教えてください。",
      },
    })

    const result = await handleChatbotMessage(
      { sessionId: "session_1", message: "はじめまして。案件の依頼です。" },
      harness.options,
    )

    expect(result.routingDecision).toMatchObject({
      kind: "continue",
      nextQuestion: expect.stringContaining("案件種類"),
    })
    expect(result.ui).not.toMatchObject({ kind: "direct-contact-card" })
    expect(harness.repository.updateConversationRouting).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "created_session_1",
        routingDecision: "continue",
        currentQuestion: expect.stringContaining("案件種類"),
      }),
    )
  })

  it("infers acquired Web CM context and routes approximate schedules to one-hour candidates first", async () => {
    const harness = setup()

    const result = await handleChatbotMessage(
      {
        sessionId: "session_1",
        userId: "user_a",
        message:
          "Web CMです。尺4分、ABタイプ2本で、追加作業はなし、素材は共有リンクで受け渡し、6月中旬に作業、6月20日までに納品希望です。会社名と名前、納品形式、打ち合わせ希望、作業場所、連絡先 client@example.com も共有済みです。",
      },
      harness.options,
    )

    expect(harness.generate.mock.calls[0]?.[0]).toMatchObject({
      conversationState: expect.objectContaining({
        hasJobKind: true,
        hasDesiredSchedule: true,
        hasCustomerIdentity: true,
      }),
      jobContext: expect.objectContaining({
        finalMedium: "web",
        jobKind: "cm-30s",
        projectLengthMinutes: 4,
        preferredStartDate: "2026-06-15",
        publicReleaseDate: "2026-06-20",
      }),
    })
    expect(result.routingDecision).toMatchObject({
      kind: "to-booking-inline",
      suggestedSlots: expect.arrayContaining([
        expect.objectContaining({ label: "6月15日 10:00", note: "1時間候補" }),
      ]),
    })
    expect(result.assistantMessage.content).toContain("先に空き状況")
    const finderInput = harness.candidateWindowFinder.mock.calls[0]?.[0]
    expect(finderInput).toEqual(expect.objectContaining({ busyMode: "block" }))
    expect(finderInput).not.toHaveProperty("notBefore")
  })

  it("keeps deterministic booking-card ui when the LLM falls back to tier4", async () => {
    const harness = setup()
    harness.generate.mockResolvedValueOnce({
      rawText: "フォームに切り替えます",
      tier: "tier-4-form-fallback",
      proposedRoutingDecision: { kind: "continue", nextQuestion: "フォームに切り替えます" },
    })

    const result = await handleChatbotMessage(
      {
        sessionId: "session_1",
        userId: "user_a",
        message:
          "ライブ2時間半のカラグレです。素材は共有リンクで6月中旬に搬入、納期は7月中、追加作業は観客消しと肌修正、リモート作業でお願いします。会社名はテスト株式会社、担当者はテストユーザー、メールは client@example.com です。",
      },
      harness.options,
    )

    expect(result.tier).toBe("tier-4-form-fallback")
    expect(result.routingDecision).toMatchObject({ kind: "to-booking-inline" })
    expect(result.ui).toMatchObject({
      kind: "booking-card",
      suggestedSlots: expect.arrayContaining([
        expect.objectContaining({ label: "6月15日 10:00", note: "1時間候補" }),
      ]),
    })
  })

  it("prioritizes the booking card once schedule and work site are known even before email and extra work details", async () => {
    const harness = setup()
    harness.generate.mockResolvedValueOnce({
      rawText: "素材搬入方法を教えてください。",
      tier: "tier-1-chrome-notion-ai",
      proposedRoutingDecision: { kind: "continue", nextQuestion: "素材搬入方法を教えてください。" },
    })

    const result = await handleChatbotMessage(
      {
        sessionId: "session_1",
        userId: "user_a",
        message:
          "ライブ映像のカラーグレーディング相談です。尺は約2.5h、素材搬入は7/1以降、納品は7月中、作業形態はリモートグレーディングです。担当者はテストユーザー、会社名はテスト株式会社です。",
      },
      harness.options,
    )

    expect(result.routingDecision).toMatchObject({ kind: "to-booking-inline" })
    expect(result.assistantMessage.content).toContain("先に空き状況")
    expect(result.ui).toMatchObject({
      kind: "booking-card",
      suggestedSlots: expect.arrayContaining([
        expect.objectContaining({ label: "6月15日 10:00", available: true }),
      ]),
      conversationState: expect.objectContaining({
        hasContactEmail: false,
        hasCustomerIdentity: true,
        hasDesiredSchedule: true,
        hasWorkSite: true,
        customerName: "テストユーザー",
        companyName: "テスト株式会社",
      }),
    })
    expect(harness.candidateWindowFinder).toHaveBeenCalled()
  })

  it("uses a JSON LLM read for booking form defaults instead of conversation-state prefill", async () => {
    const harness = setup()
    harness.generate
      .mockResolvedValueOnce({
        rawText: "候補を出します。",
        tier: "tier-1-chrome-notion-ai",
        proposedRoutingDecision: { kind: "continue", nextQuestion: "候補を出します。" },
      })
      .mockResolvedValueOnce({
        rawText:
          '{"contactName":"テストユーザー","companyName":"テスト株式会社","contactEmail":"test@example.com","dueDate":"2026-07-31"}',
        tier: "tier-1-chrome-notion-ai",
      })

    const result = await handleChatbotMessage(
      {
        sessionId: "session_1",
        userId: "user_a",
        message:
          "ライブ映像のカラーグレーディング相談です。尺は約2.5h、素材搬入は7/1以降、納品は7月中、作業形態はリモートグレーディングです。担当者はテストユーザー、会社名はテスト株式会社、メールは test@example.com です。",
      },
      harness.options,
    )

    expect(harness.generate.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        systemPrompt: expect.stringContaining("予約フォーム初期値だけをJSON"),
        notionAiThread: {},
        forceFullPrompt: true,
        temperature: 0,
      }),
    )
    expect(result.ui).toMatchObject({
      kind: "booking-card",
      bookingPrefill: {
        contactName: "テストユーザー",
        companyName: "テスト株式会社",
        contactEmail: "test@example.com",
        dueDate: "2026-07-31",
      },
    })
  })

  it("logs the shadow comparison and executes create_booking only when the rule path matches", async () => {
    const harness = setup()
    const createBookingFromApiInput = vi.fn().mockResolvedValue({
      status: 200,
      body: { bookingGroupId: "booking_group_1" },
    })
    const toolShadowLogger = vi.fn()
    harness.generate.mockResolvedValueOnce({
      rawText: JSON.stringify({
        tool: "create_booking",
        args: { input: bookingInput() },
      }),
      tier: "tier-1-chrome-notion-ai",
      proposedRoutingDecision: { kind: "continue", nextQuestion: "候補を出します。" },
    })

    const result = await handleChatbotMessage(
      {
        sessionId: "session_1",
        userId: "user_a",
        userEmail: "customer@example.com",
        message:
          "ライブ映像のカラーグレーディング相談です。尺は約2.5h、素材搬入は7/1以降、納品は7月中、作業形態はリモートグレーディングです。担当者はテストユーザー、会社名はテスト株式会社、メールは customer@example.com です。",
      },
      {
        ...harness.options,
        createBookingFromApiInput,
        toolShadowLogger,
      },
    )

    expect(toolShadowLogger).toHaveBeenCalledWith("[shadow] llm=create_booking rule=to-booking-inline match=true")
    expect(createBookingFromApiInput).toHaveBeenCalledWith({
      input: bookingInput(),
      userId: "user_a",
      userEmail: "customer@example.com",
    })
    expect(result.assistantMessage.content).toBe("予約を受け付けました。予約番号: booking_group_1")
    expect(result.ui).toEqual({ kind: "none" })
    expect(harness.repository.updateConversationRouting).not.toHaveBeenCalled()
  })

  it("keeps rule fallback when create_booking args are invalid", async () => {
    const harness = setup()
    const createBookingFromApiInput = vi.fn()
    const toolShadowLogger = vi.fn()
    harness.generate.mockResolvedValueOnce({
      rawText: '{"tool":"create_booking","args":{}}',
      tier: "tier-1-chrome-notion-ai",
      proposedRoutingDecision: { kind: "continue", nextQuestion: "候補を出します。" },
    })

    const result = await handleChatbotMessage(
      {
        sessionId: "session_1",
        userId: "user_a",
        userEmail: "customer@example.com",
        message:
          "ライブ映像のカラーグレーディング相談です。尺は約2.5h、素材搬入は7/1以降、納品は7月中、作業形態はリモートグレーディングです。担当者はテストユーザー、会社名はテスト株式会社、メールは customer@example.com です。",
      },
      {
        ...harness.options,
        createBookingFromApiInput,
        toolShadowLogger,
      },
    )

    expect(toolShadowLogger).toHaveBeenCalledWith("[shadow] llm=create_booking rule=to-booking-inline match=true")
    expect(createBookingFromApiInput).not.toHaveBeenCalled()
    expect(result.routingDecision).toMatchObject({ kind: "to-booking-inline" })
    expect(result.ui).toMatchObject({ kind: "booking-card" })
    expect(harness.repository.updateConversationRouting).toHaveBeenCalled()
  })

  it("keeps rule fallback when the LLM output is not strict tool JSON", async () => {
    const harness = setup()
    const createBookingFromApiInput = vi.fn()
    const toolShadowLogger = vi.fn()
    harness.generate.mockResolvedValueOnce({
      rawText: "候補を出します。",
      tier: "tier-1-chrome-notion-ai",
      proposedRoutingDecision: { kind: "continue", nextQuestion: "候補を出します。" },
    })

    const result = await handleChatbotMessage(
      {
        sessionId: "session_1",
        userId: "user_a",
        userEmail: "customer@example.com",
        message:
          "ライブ映像のカラーグレーディング相談です。尺は約2.5h、素材搬入は7/1以降、納品は7月中、作業形態はリモートグレーディングです。担当者はテストユーザー、会社名はテスト株式会社、メールは customer@example.com です。",
      },
      {
        ...harness.options,
        createBookingFromApiInput,
        toolShadowLogger,
      },
    )

    expect(toolShadowLogger).not.toHaveBeenCalled()
    expect(createBookingFromApiInput).not.toHaveBeenCalled()
    expect(result.routingDecision).toMatchObject({ kind: "to-booking-inline" })
    expect(result.ui).toMatchObject({ kind: "booking-card" })
  })

  it("leaves get_estimate unexecuted in Phase 1 even when the LLM emits tool JSON", async () => {
    const harness = setup()
    const createBookingFromApiInput = vi.fn()
    const toolShadowLogger = vi.fn()
    harness.generate.mockResolvedValueOnce({
      rawText: '{"tool":"get_estimate","args":{"jobContext":{"jobKind":"cm-30s"}}}',
      tier: "tier-1-chrome-notion-ai",
      proposedRoutingDecision: { kind: "continue", nextQuestion: "候補を出します。" },
    })

    const result = await handleChatbotMessage(
      {
        sessionId: "session_1",
        userId: "user_a",
        userEmail: "customer@example.com",
        message:
          "ライブ映像のカラーグレーディング相談です。尺は約2.5h、素材搬入は7/1以降、納品は7月中、作業形態はリモートグレーディングです。担当者はテストユーザー、会社名はテスト株式会社、メールは customer@example.com です。",
      },
      {
        ...harness.options,
        createBookingFromApiInput,
        toolShadowLogger,
      },
    )

    expect(toolShadowLogger).toHaveBeenCalledWith("[shadow] llm=get_estimate rule=to-booking-inline match=false")
    expect(createBookingFromApiInput).not.toHaveBeenCalled()
    expect(result.routingDecision).toMatchObject({ kind: "to-booking-inline" })
    expect(result.ui).toMatchObject({ kind: "booking-card" })
  })

  it("falls back to empty booking form defaults when the JSON LLM read fails", async () => {
    const harness = setup()
    harness.generate
      .mockResolvedValueOnce({
        rawText: "候補を出します。",
        tier: "tier-1-chrome-notion-ai",
        proposedRoutingDecision: { kind: "continue", nextQuestion: "候補を出します。" },
      })
      .mockRejectedValueOnce(new Error("Notion AI response text could not be extracted. bytes=1 preview=["))

    const result = await handleChatbotMessage(
      {
        sessionId: "session_1",
        userId: "user_a",
        message:
          "ライブ映像のカラーグレーディング相談です。尺は約2.5h、素材搬入は7/1以降、納品は7月中、作業形態はリモートグレーディングです。担当者はテストユーザー、会社名はテスト株式会社、メールは test@example.com です。",
      },
      harness.options,
    )

    expect(harness.generate).toHaveBeenCalledTimes(2)
    expect(result.ui).toMatchObject({
      kind: "booking-card",
      bookingPrefill: {},
    })
  })

  it("keeps asking required slots instead of showing booking calendar before work site and material handoff are ready", async () => {
    const harness = setup()

    const result = await handleChatbotMessage(
      {
        sessionId: "session_1",
        userId: "user_a",
        message:
          "ライブ2.5hです。搬入は7/1ごろ、納品は8月中で、観客消しと肌修正もあります。会社名と氏名は共有済みです。",
        conversationState: {
          hasFinalMedium: true,
          hasJobKind: true,
          hasProjectLength: true,
          hasAdditionalWork: true,
          hasDesiredSchedule: true,
          hasCustomerIdentity: true,
          turnCount: 4,
        },
        jobContext: {
          finalMedium: "live",
          jobKind: "live-60m",
          projectLengthMinutes: 150,
          preferredStartDate: "2026-07-01",
          additionalWork: ["retouch", "skin-retouch"],
        },
      },
      harness.options,
    )

    expect(result.routingDecision).toMatchObject({
      kind: "continue",
    })
    expect(result.ui).not.toMatchObject({ kind: "booking-card" })
    expect(harness.candidateWindowFinder).not.toHaveBeenCalled()
  })

  it("keeps asking required slots instead of showing the email handoff form early", async () => {
    const harness = setup()
    harness.generate.mockResolvedValueOnce({
      rawText: "個別確認に進めます。",
      tier: "tier-1-chrome-notion-ai",
      proposedRoutingDecision: {
        kind: "to-direct-contact",
        reason: "pricing",
        requireEmail: true,
        suggestedMessage: "メールアドレス、会社名、お名前を教えてください。",
      },
    })

    const result = await handleChatbotMessage(
      {
        sessionId: "session_1",
        userId: "user_a",
        message: "メールで進めたいです。client@example.com です。",
        conversationState: {
          hasContactEmail: true,
          contactEmail: "client@example.com",
          turnCount: 8,
        },
      },
      harness.options,
    )

    expect(result.routingDecision).toMatchObject({
      kind: "continue",
    })
    expect(result.ui).toEqual({ kind: "none" })
  })

  it("keeps deterministic email handoff when all email handoff slots are ready", async () => {
    const harness = setup()
    harness.generate.mockResolvedValueOnce({
      rawText: "個別確認に進めます。",
      tier: "tier-1-chrome-notion-ai",
      proposedRoutingDecision: {
        kind: "to-direct-contact",
        reason: "pricing",
        requireEmail: true,
        suggestedMessage: "メールアドレス、会社名、お名前を教えてください。",
      },
    })

    const result = await handleChatbotMessage(
      {
        sessionId: "session_1",
        userId: "user_a",
        message: "メールで進めたいです。client@example.com です。",
        conversationState: {
          hasFinalMedium: true,
          hasJobKind: true,
          hasProjectLength: true,
          hasMaterialHandoff: true,
          hasWorkSite: true,
          hasContactEmail: true,
          contactEmail: "client@example.com",
          turnCount: 8,
        },
        jobContext: {
          finalMedium: "live",
          jobKind: "live-60m",
          workSite: "remote-grading",
        },
      },
      harness.options,
    )

    expect(result.routingDecision).toMatchObject({
      kind: "to-email",
      summary: expect.objectContaining({
        customerEmail: "client@example.com",
      }),
    })
    expect(result.ui).toMatchObject({
      kind: "consultation-summary-form",
      summary: expect.objectContaining({ customerEmail: "client@example.com" }),
    })
  })

  it("returns a consultation summary form for zero-candidate booking handoff", async () => {
    const harness = setup()

    const result = await handleChatbotMessage(
      {
        sessionId: "session_1",
        userId: "user_a",
        message: "劇場案件です。希望時期と client@example.com は共有済みです。",
        conversationState: {
          hasFinalMedium: true,
          hasJobKind: true,
          hasProjectLength: true,
          hasMaterialHandoff: true,
          hasAdditionalWork: true,
          hasDocumentaryAttachments: true,
          hasWorkSite: true,
          hasReferenceUrls: true,
          hasDesiredSchedule: true,
          hasContactEmail: true,
          contactEmail: "client@example.com",
          customerName: "田中",
          turnCount: 8,
        },
        jobContext: {
          finalMedium: "cinema",
          workSite: "remote-grading",
        },
      },
      harness.options,
    )

    expect(result.routingDecision).toMatchObject({
      kind: "to-booking-inline",
      suggestedSlots: [],
    })
    expect(result.ui).toMatchObject({
      kind: "consultation-summary-form",
      summary: expect.objectContaining({
        customerEmail: "client@example.com",
        summaryText: expect.stringContaining("cinema"),
      }),
    })
  })

  it("does not return a zero-candidate booking handoff form when required slots are missing", async () => {
    const harness = setup()

    const result = await handleChatbotMessage(
      {
        sessionId: "session_1",
        userId: "user_a",
        message: "劇場案件です。希望時期と client@example.com は共有済みです。",
        conversationState: {
          hasFinalMedium: true,
          hasJobKind: true,
          hasProjectLength: true,
          hasMaterialHandoff: true,
          hasDesiredSchedule: true,
          hasContactEmail: true,
          contactEmail: "client@example.com",
          turnCount: 8,
        },
        jobContext: {
          finalMedium: "cinema",
          workSite: "remote-grading",
        },
      },
      harness.options,
    )

    expect(result.routingDecision).toMatchObject({
      kind: "to-booking-inline",
      suggestedSlots: [],
    })
    expect(result.ui).toEqual({ kind: "none" })
  })

  it("isolates a previous user's conversation when the authenticated user changes", async () => {
    const harness = setup({
      existingConversation: conversation({
        id: "conv_old_user",
        context: { sessionId: "session_1", userId: "user_a" },
        messages: [{ id: "old", role: "user", content: "old user context", createdAt: "2026-05-26T00:00:00.000Z" }],
      }),
    })

    await handleChatbotMessage(
      { sessionId: "session_1", userId: "user_b", message: "別ユーザーです" },
      harness.options,
    )

    expect(harness.repository.loadConversationBySessionId).toHaveBeenCalledWith("session_1:user_b")
    expect(harness.repository.linkConversationToUser).not.toHaveBeenCalled()
    expect(harness.userContextLoader).toHaveBeenCalledWith({
      userId: "user_b",
      currentConversationId: "conv_isolated",
    })
    expect(harness.generate.mock.calls[0]?.[0].messages).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ content: "old user context" })]),
    )
  })

  it("persists the active choice panel returned by deterministic routing", async () => {
    const harness = setup({
      existingConversation: conversation({
        context: {
          sessionId: "session_1",
          userId: "user_a",
          conversationState: { hasCustomerIdentity: true, turnCount: 2 },
        },
        messages: [{ id: "old", role: "user", content: "会社名と名前は共有済みです", createdAt: "2026-05-26T00:00:00.000Z" }],
      }),
    })

    const result = await handleChatbotMessage(
      { sessionId: "session_1", userId: "user_a", message: "案件相談です" },
      harness.options,
    )

    expect(result.ui).toEqual({ kind: "choice-panel", choiceSet: finalMediumChoices })
    expect(harness.repository.updateConversationRouting).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "conv_1",
        currentQuestion: "最終媒体は何になりますか？",
        activeChoices: finalMediumChoices,
      }),
    )
  })

  it("infers concrete customer identity values without provided sentinels", async () => {
    const harness = setup()

    await handleChatbotMessage(
      {
        sessionId: "session_1",
        userId: "user_a",
        message:
          "会社名は株式会社サンプル、担当者氏名は田中太郎です。Web CMで尺4分、6月中旬に作業、6月20日までに納品希望です。client@example.com です。",
      },
      harness.options,
    )

    expect(harness.generate.mock.calls[0]?.[0].conversationState).toEqual(
      expect.objectContaining({
        hasCustomerIdentity: true,
        customerName: "田中太郎",
        companyName: "株式会社サンプル",
      }),
    )
    expect(harness.generate.mock.calls[0]?.[0].conversationState).not.toEqual(
      expect.objectContaining({
        customerName: "provided",
        companyName: "provided",
      }),
    )
  })

  it("prefers the latest concrete name and company when earlier label mentions are not values", async () => {
    const harness = setup({
      existingConversation: conversation({
        context: {
          sessionId: "session_1",
          userId: "user_a",
          conversationState: { turnCount: 2 },
        },
        messages: [
          {
            id: "old_user_1",
            role: "user",
            content:
              "1 は直りました。2は正しく入っていません。変な文字の巻き込みがあります。3のメールアドレスは、専用欄に入力済みで表示されました。担当者氏名と会社名も、今回のテストで打ち込んだので、すでに入力されたフォームとしてメールアドレスと同じような感じで表示してほしいです。",
            createdAt: "2026-05-26T00:00:00.000Z",
          },
        ],
      }),
    })

    await handleChatbotMessage(
      {
        sessionId: "session_1",
        userId: "user_a",
        message: "名前はテストユーザー、会社名はテスト株式会社です。",
      },
      harness.options,
    )

    expect(harness.generate.mock.calls[0]?.[0].conversationState).toEqual(
      expect.objectContaining({
        hasCustomerIdentity: true,
        customerName: "テストユーザー",
        companyName: "テスト株式会社",
      }),
    )
  })

  it.each([
    ["名前はテストユーザー、会社名はテスト株式会社です。"],
    ["名前はテストユーザー会社名はテスト株式会社です。"],
    ["名前はテストユーザー\n会社名はテスト株式会社です。"],
    ["名前はテストユーザーさん、会社名はテスト株式会社です。"],
    ["会社名は未定です。名前は未定です。\n名前はテストユーザー、会社名はテスト株式会社です。"],
    ["名前はテストユーザーです。\n会社名はテスト株式会社です。"],
    ["名前：テストユーザー（テスト株式会社）"],
  ])("extracts customer identity without adjacent label bleed: %s", async (messageText) => {
    const harness = setup()

    await handleChatbotMessage(
      {
        sessionId: "session_1",
        userId: "user_a",
        message: messageText,
      },
      harness.options,
    )

    expect(harness.generate.mock.calls[0]?.[0].conversationState.customerName).toBe("テストユーザー")
    expect(harness.generate.mock.calls[0]?.[0].conversationState.companyName).toBe("テスト株式会社")
  })

  it("does not treat online material handoff as a work site choice", async () => {
    const harness = setup()

    await handleChatbotMessage(
      {
        sessionId: "session_1",
        userId: "user_a",
        message: "素材はオンライン共有で受け渡し予定です。受け渡し以外はまだ未定です。",
      },
      harness.options,
    )

    expect(harness.generate.mock.calls[0]?.[0].conversationState).toEqual(
      expect.objectContaining({
        hasMaterialHandoff: true,
        hasWorkSite: false,
      }),
    )
  })

  it("infers July deadline text and keeps broad June handoff dates approximate", async () => {
    const harness = setup()

    await handleChatbotMessage(
      {
        sessionId: "session_1",
        userId: "user_a",
        message:
          "会社名はテスト株式会社、担当者氏名はテストユーザーです。ライブ2時間半のカラグレで、素材は6月中旬にオンライン共有、納期は7月中です。test@example.com です。",
      },
      harness.options,
    )

    expect(harness.generate.mock.calls[0]?.[0].conversationState).toEqual(
      expect.objectContaining({
        hasCustomerIdentity: true,
        customerName: "テストユーザー",
        companyName: "テスト株式会社",
        contactEmail: "test@example.com",
      }),
    )
    expect(harness.generate.mock.calls[0]?.[0].jobContext).toEqual(
      expect.objectContaining({
        finalMedium: "live",
        jobKind: "live-60m",
        projectLengthMinutes: 150,
        preferredStartDate: "2026-06-15",
        preferredStartDateApproximate: true,
        publicReleaseDate: "2026-07-31",
      }),
    )
  })

  it("keeps live workflow estimates consistent on non-booking turns", async () => {
    const harness = setup({
      existingConversation: conversation({
        context: {
          sessionId: "session_1",
          userId: "user_a",
          conversationState: {
            hasCustomerIdentity: true,
            hasFinalMedium: true,
            hasJobKind: true,
            hasProjectLength: true,
            turnCount: 3,
          },
          jobContext: {
            finalMedium: "live",
            jobKind: "live-60m",
            workSite: "remote-grading",
            documentaryAttachment: { kind: "none" },
            projectLengthMinutes: 150,
          },
        },
      }),
    })
    harness.generate.mockResolvedValueOnce({
      rawText: "ライブ2時間半規模の工程目安は17〜20日です。素材の受け渡し方法を教えてください。",
      tier: "tier-3-ollama-deepseek",
      proposedRoutingDecision: { kind: "continue", nextQuestion: "素材の受け渡し方法を教えてください。" },
    })

    await handleChatbotMessage(
      { sessionId: "session_1", userId: "user_a", message: "ライブ2時間半です" },
      harness.options,
    )

    expect(harness.repository.appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "assistant",
        content: expect.stringContaining("工程目安は7〜8日"),
      }),
    )
    expect(harness.repository.appendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({
        role: "assistant",
        content: expect.stringContaining("17〜20日"),
      }),
    )
  })

  it("keeps identity satisfied without storing provided as a display value", async () => {
    const harness = setup({
      existingConversation: conversation({
        context: {
          sessionId: "session_1",
          userId: "user_a",
          conversationState: { turnCount: 2 },
        },
        messages: [],
      }),
    })

    await handleChatbotMessage(
      {
        sessionId: "session_1",
        userId: "user_a",
        message: "会社名と名前は共有済みです。Web CMで尺4分です。",
      },
      harness.options,
    )

    expect(harness.generate.mock.calls[0]?.[0].conversationState).toEqual(
      expect.objectContaining({
        hasCustomerIdentity: true,
      }),
    )
    expect(harness.generate.mock.calls[0]?.[0].conversationState.customerName).toBeUndefined()
    expect(harness.generate.mock.calls[0]?.[0].conversationState.companyName).toBeUndefined()
  })

  it("does not infer job kind or final medium words as company names", async () => {
    const harness = setup({
      existingConversation: conversation({
        context: {
          sessionId: "session_1",
          userId: "user_a",
          conversationState: { turnCount: 2 },
        },
        messages: [],
      }),
    })

    await handleChatbotMessage(
      {
        sessionId: "session_1",
        userId: "user_a",
        message: "会社名はライブです。担当者氏名は未定です。尺は60分で、素材はオンライン共有です。",
      },
      harness.options,
    )

    expect(harness.generate.mock.calls[0]?.[0].conversationState).toEqual(
      expect.objectContaining({
        hasCustomerIdentity: true,
      }),
    )
    expect(harness.generate.mock.calls[0]?.[0].conversationState.companyName).toBeUndefined()
    expect(harness.generate.mock.calls[0]?.[0].conversationState.customerName).toBeUndefined()
  })

  it("does not infer company-like values as contact person names", async () => {
    const harness = setup({
      existingConversation: conversation({
        context: {
          sessionId: "session_1",
          userId: "user_a",
          conversationState: { turnCount: 2 },
        },
        messages: [],
      }),
    })

    await handleChatbotMessage(
      {
        sessionId: "session_1",
        userId: "user_a",
        message: "会社名は株式会社サンプルです。担当者氏名は株式会社サンプルです。Web CMで尺4分です。",
      },
      harness.options,
    )

    expect(harness.generate.mock.calls[0]?.[0].conversationState.companyName).toBe("株式会社サンプル")
    expect(harness.generate.mock.calls[0]?.[0].conversationState.customerName).toBeUndefined()
  })

  it("aligns assistant text with deterministic choice panel question", async () => {
    const harness = setup({
      existingConversation: conversation({
        context: {
          sessionId: "session_1",
          userId: "user_a",
          conversationState: {
            hasCustomerIdentity: true,
            hasFinalMedium: true,
            hasJobKind: true,
            hasMaterialHandoff: true,
            hasDesiredSchedule: false,
            turnCount: 3,
          },
          jobContext: {
            finalMedium: "live",
            jobKind: "live-60m",
          },
        },
        messages: [
          {
            id: "old",
            role: "user",
            content: "ライブ案件で尺は2時間前後、スケジュールは未確定です",
            createdAt: "2026-05-26T00:00:00.000Z",
          },
        ],
      }),
    })
    harness.generate.mockResolvedValueOnce({
      rawText: "打ち合わせや作業場所のご希望、連絡先を教えてください。",
      tier: "tier-3-ollama-deepseek",
      proposedRoutingDecision: { kind: "continue", nextQuestion: "作業場所のご希望はありますか？" },
    })

    const result = await handleChatbotMessage(
      {
        sessionId: "session_1",
        userId: "user_a",
        message: "スケジュールはまだ未確定です",
        conversationState: {
          hasCustomerIdentity: true,
          hasFinalMedium: true,
          hasJobKind: true,
          hasMaterialHandoff: true,
          hasDesiredSchedule: false,
          turnCount: 4,
        },
        jobContext: {
          finalMedium: "live",
          jobKind: "live-60m",
        },
      },
      harness.options,
    )

    expect(result.ui).toEqual({ kind: "choice-panel", choiceSet: additionalWorkChoices })
    expect(result.routingDecision).toMatchObject({
      kind: "continue",
      nextQuestion: "カラグレ以外の追加作業はありますか？",
      presentChoices: additionalWorkChoices,
    })
    expect(result.assistantMessage.content).toBe("カラグレ以外の追加作業はありますか？")
    expect(harness.repository.appendMessage).toHaveBeenCalledWith({
      conversationId: "conv_1",
      role: "assistant",
      content: "カラグレ以外の追加作業はありますか？",
      llmModel: "tier-3-ollama-deepseek",
    })
  })

  it("consumes stored final medium choice before text inference and advances to the next slot", async () => {
    const harness = setup({
      existingConversation: conversation({
        context: {
          sessionId: "session_1",
          userId: "user_a",
          activeChoices: finalMediumChoices,
          currentQuestion: "最終媒体は何になりますか？",
          conversationState: { hasCustomerIdentity: true, turnCount: 2 },
        },
        messages: [{ id: "old", role: "assistant", content: "最終媒体は何になりますか？", createdAt: "2026-05-26T00:00:00.000Z" }],
      }),
    })
    harness.generate.mockResolvedValueOnce({
      rawText: "最終媒体は何になりますか？",
      tier: "tier-3-ollama-deepseek",
      proposedRoutingDecision: {
        kind: "continue",
        nextQuestion: "最終媒体は何になりますか？",
        presentChoices: finalMediumChoices,
      },
    })

    const result = await handleChatbotMessage(
      { sessionId: "session_1", userId: "user_a", message: "選択: live" },
      harness.options,
    )

    expect(harness.generate.mock.calls[0]?.[0]).toMatchObject({
      conversationState: expect.objectContaining({ hasFinalMedium: true }),
      jobContext: expect.objectContaining({ finalMedium: "live" }),
    })
    expect(result.routingDecision).toMatchObject({
      kind: "continue",
      nextQuestion: "案件種別と尺を教えてください",
    })
    expect(result.routingDecision).not.toMatchObject({ presentChoices: finalMediumChoices })
    expect(harness.repository.updateConversationRouting).toHaveBeenCalledWith(
      expect.objectContaining({
        activeChoices: null,
        conversationState: expect.objectContaining({ hasFinalMedium: true }),
        jobContext: expect.objectContaining({ finalMedium: "live" }),
      }),
    )
  })

  it("asks for remote grading confirmation after the entrusted work site choice", async () => {
    const harness = setup({
      existingConversation: conversation({
        context: {
          sessionId: "session_1",
          userId: "user_a",
          activeChoices: workSiteChoices,
          currentQuestion: "作業場所のご希望はありますか？",
          conversationState: {
            hasCustomerIdentity: true,
            hasFinalMedium: true,
            hasJobKind: true,
            hasProjectLength: true,
            hasMaterialHandoff: true,
            hasAdditionalWork: true,
            hasDocumentaryAttachments: true,
            hasDesiredSchedule: true,
            turnCount: 7,
          },
          jobContext: {
            finalMedium: "live",
            jobKind: "live-60m",
            projectLengthMinutes: 150,
            preferredStartDate: "2026-07-01",
            publicReleaseDate: "2026-07-31",
          },
        },
        messages: [{ id: "old", role: "assistant", content: "作業場所のご希望はありますか？", createdAt: "2026-05-26T00:00:00.000Z" }],
      }),
    })

    const result = await handleChatbotMessage(
      { sessionId: "session_1", userId: "user_a", message: "選択: entrust" },
      harness.options,
    )

    expect(result.assistantMessage.content).toContain("リモートグレーディングのご提案")
    expect(result.routingDecision).toMatchObject({
      kind: "continue",
      presentChoices: remoteWorkSiteConfirmationChoices,
    })
    expect(result.ui).toEqual({ kind: "choice-panel", choiceSet: remoteWorkSiteConfirmationChoices })
    expect(harness.repository.updateConversationRouting).toHaveBeenCalledWith(
      expect.objectContaining({
        activeChoices: remoteWorkSiteConfirmationChoices,
        conversationState: expect.objectContaining({
          hasWorkSite: false,
          hasPendingRemoteWorkSiteRecommendation: true,
        }),
      }),
    )
  })

  it("confirms remote grading after a Yes answer to the entrusted work site recommendation", async () => {
    const harness = setup({
      existingConversation: conversation({
        context: {
          sessionId: "session_1",
          userId: "user_a",
          activeChoices: remoteWorkSiteConfirmationChoices,
          currentQuestion: "リモートグレーディングのご提案です。",
          conversationState: {
            hasCustomerIdentity: true,
            hasFinalMedium: true,
            hasJobKind: true,
            hasProjectLength: true,
            hasMaterialHandoff: true,
            hasAdditionalWork: true,
            hasDocumentaryAttachments: true,
            hasDesiredSchedule: true,
            hasPendingRemoteWorkSiteRecommendation: true,
            turnCount: 8,
          },
          jobContext: {
            finalMedium: "live",
            jobKind: "live-60m",
            projectLengthMinutes: 150,
            preferredStartDate: "2026-07-01",
            publicReleaseDate: "2026-07-31",
          },
        },
        messages: [{ id: "old", role: "assistant", content: "リモートグレーディングのご提案です。", createdAt: "2026-05-26T00:00:00.000Z" }],
      }),
    })

    const result = await handleChatbotMessage(
      { sessionId: "session_1", userId: "user_a", message: "Yes" },
      harness.options,
    )

    expect(result.routingDecision).toMatchObject({ kind: "to-booking-inline" })
    expect(harness.generate.mock.calls[0]?.[0].jobContext).toEqual(
      expect.objectContaining({ workSite: "remote-grading" }),
    )
    expect(harness.repository.updateConversationRouting).toHaveBeenCalledWith(
      expect.objectContaining({
        activeChoices: null,
        conversationState: expect.objectContaining({
          hasWorkSite: true,
          hasPendingRemoteWorkSiteRecommendation: false,
        }),
        jobContext: expect.objectContaining({ workSite: "remote-grading" }),
      }),
    )
  })

  it("keeps a stored final medium slot filled on later turns", async () => {
    const harness = setup({
      existingConversation: conversation({
        context: {
          sessionId: "session_1",
          userId: "user_a",
          conversationState: { hasCustomerIdentity: true, hasFinalMedium: true, turnCount: 3 },
          jobContext: { finalMedium: "live" },
        },
        messages: [{ id: "old", role: "user", content: "選択: live", createdAt: "2026-05-26T00:00:00.000Z" }],
      }),
    })
    harness.generate.mockResolvedValueOnce({
      rawText: "最終媒体は何になりますか？",
      tier: "tier-3-ollama-deepseek",
      proposedRoutingDecision: {
        kind: "continue",
        nextQuestion: "最終媒体は何になりますか？",
        presentChoices: finalMediumChoices,
      },
    })

    const result = await handleChatbotMessage(
      { sessionId: "session_1", userId: "user_a", message: "補足です" },
      harness.options,
    )

    expect(harness.generate.mock.calls[0]?.[0].conversationState).toEqual(
      expect.objectContaining({ hasFinalMedium: true }),
    )
    expect(result.routingDecision).not.toMatchObject({ presentChoices: finalMediumChoices })
  })

  it("does not send the operator notification when the booking form is only displayed", async () => {
    const harness = setup()

    const result = await handleChatbotMessage(
      {
        sessionId: "session_1",
        userId: "user_a",
        message:
          "Web CMです。尺4分、6月中旬に作業、6月20日までに納品希望です。作業場所はリモートで、client@example.com から連絡できます。",
        conversationState: {
          hasFinalMedium: true,
          hasJobKind: true,
          hasProjectLength: true,
          hasMaterialHandoff: true,
          hasWorkSite: true,
          hasDesiredSchedule: true,
          hasContactEmail: true,
          contactEmail: "client@example.com",
          customerName: "田中",
          turnCount: 6,
        },
      },
      { ...harness.options, operatorNotificationSender: harness.operatorNotificationSender },
    )

    expect(result.routingDecision).toMatchObject({ kind: "to-booking-inline" })
    expect(harness.operatorNotificationSender).not.toHaveBeenCalled()
    expect(harness.repository.appendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "conv_1",
        role: "system",
        content: expect.stringContaining("[chatbot-operator-notification:sent]"),
      }),
    )

    const alreadySent = setup({
      existingConversation: conversation({
        messages: [
          message("system", "[chatbot-operator-notification:sent] 2026-06-05T00:00:00.000Z"),
        ],
      }),
    })

    await handleChatbotMessage(
      {
        sessionId: "session_1",
        userId: "user_a",
        message:
          "Web CMです。尺4分、6月中旬に作業、6月20日までに納品希望です。作業場所はリモートで、client@example.com から連絡できます。",
        conversationState: {
          hasFinalMedium: true,
          hasJobKind: true,
          hasProjectLength: true,
          hasMaterialHandoff: true,
          hasWorkSite: true,
          hasDesiredSchedule: true,
          hasContactEmail: true,
          contactEmail: "client@example.com",
          turnCount: 6,
        },
      },
      { ...alreadySent.options, operatorNotificationSender: alreadySent.operatorNotificationSender },
    )

    expect(alreadySent.operatorNotificationSender).not.toHaveBeenCalled()
  })

  it("sends the operator notification once for email handoff", async () => {
    const harness = setup()

    await handleChatbotMessage(
      {
        sessionId: "session_1",
        userId: "user_a",
        message: "メールで進めたいです。client@example.com です。",
        conversationState: {
          hasFinalMedium: true,
          hasJobKind: true,
          hasProjectLength: true,
          hasMaterialHandoff: true,
          hasWorkSite: true,
          hasContactEmail: true,
          contactEmail: "client@example.com",
          customerName: "田中",
          hasDesiredSchedule: false,
          turnCount: 8,
        },
        jobContext: {
          finalMedium: "live",
          jobKind: "live-60m",
          workSite: "remote-grading",
        },
      },
      { ...harness.options, operatorNotificationSender: harness.operatorNotificationSender },
    )

    expect(harness.operatorNotificationSender).toHaveBeenCalledTimes(1)
    expect(harness.operatorNotificationSender).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger: "chat-completed",
        conversationState: expect.objectContaining({ contactEmail: "client@example.com" }),
      }),
    )

    const alreadySent = setup({
      existingConversation: conversation({
        messages: [
          message("system", "[chatbot-operator-notification:sent] 2026-06-05T00:00:00.000Z"),
        ],
      }),
    })

    await handleChatbotMessage(
      {
        sessionId: "session_1",
        userId: "user_a",
        message: "メールで進めたいです。client@example.com です。",
        conversationState: {
          hasFinalMedium: true,
          hasJobKind: true,
          hasProjectLength: true,
          hasMaterialHandoff: true,
          hasWorkSite: true,
          hasContactEmail: true,
          contactEmail: "client@example.com",
          hasDesiredSchedule: false,
          turnCount: 8,
        },
        jobContext: {
          finalMedium: "live",
          jobKind: "live-60m",
          workSite: "remote-grading",
        },
      },
      { ...alreadySent.options, operatorNotificationSender: alreadySent.operatorNotificationSender },
    )

    expect(alreadySent.operatorNotificationSender).not.toHaveBeenCalled()
  })
})
