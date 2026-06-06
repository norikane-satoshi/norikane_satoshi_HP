import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({ prisma: {} }))

import type { ChatbotConversation, ChatbotMessage } from "@/lib/chatbot/domain"
import { additionalWorkChoices, finalMediumChoices } from "@/lib/chatbot/domain"
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
      .mockImplementation((input: { role: ChatbotMessage["role"]; content: string }) =>
        Promise.resolve(message(input.role, input.content)),
      ),
    truncateConversationFromMessage: vi.fn().mockResolvedValue({ deletedCount: 0 }),
    updateConversationRouting: vi.fn(),
    linkConversationToUser: vi.fn(),
  }
  const generate = vi.fn().mockResolvedValue({
    rawText: "返信です",
    tier: "tier-2-ollama-deepseek",
    proposedRoutingDecision: { kind: "continue", nextQuestion: "次の質問" },
  })
  const userContextLoader = vi.fn().mockResolvedValue(userContext())
  const userContextFormatter = vi.fn().mockReturnValue("本人文脈:\n- 本人だけの過去要約")

  return {
    repository,
    generate,
    userContextLoader,
    userContextFormatter,
    operatorNotificationSender: vi.fn().mockResolvedValue({ status: "sent", id: "email_1" }),
    options: {
      repository,
      orchestratorFactory: () => ({ generate, isHealthy: vi.fn() }),
      userContextLoader,
      userContextFormatter,
    },
  }
}

describe("handleChatbotMessage user context", () => {
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
    expect(harness.generate.mock.calls[0]?.[0].systemPrompt).toContain("Notionページを実行時に追加参照せず")
    expect(harness.generate.mock.calls[0]?.[0].systemPrompt).toContain("1510399661d64891aee912320df39b91")
    expect(harness.generate.mock.calls[0]?.[0].systemPrompt).toContain("案件種類")
    expect(harness.generate.mock.calls[0]?.[0].systemPrompt).toContain("1返答で質問は最大3問")
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
      tier: "tier-2-ollama-deepseek",
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
    })
    expect(result.assistantMessage.content).toBe("最終媒体と尺を教えてください。")
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

  it("overrides pricing output with direct contact policy", async () => {
    const harness = setup()
    harness.generate.mockResolvedValueOnce({
      rawText: "概算で10万円です。",
      tier: "tier-2-ollama-deepseek",
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
          "Web CMです。尺4分、ABタイプ2本で、6月中旬に作業、6月20日までに納品希望です。会社名と名前、納品形式、打ち合わせ希望、作業場所、連絡先も共有済みです。",
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
          hasDesiredSchedule: true,
          hasContactEmail: true,
          contactEmail: "client@example.com",
          turnCount: 8,
        },
        jobContext: {
          finalMedium: "cinema",
          jobKind: "feature-90m",
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
      tier: "tier-2-ollama-deepseek",
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
      tier: "tier-2-ollama-deepseek",
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
      tier: "tier-2-ollama-deepseek",
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

  it("sends the operator notification once when handoff slots are complete", async () => {
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
    expect(harness.operatorNotificationSender).toHaveBeenCalledTimes(1)
    expect(harness.operatorNotificationSender).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger: "chat-completed",
        conversationState: expect.objectContaining({ contactEmail: "client@example.com" }),
        jobContext: expect.objectContaining({ finalMedium: "web" }),
      }),
    )
    expect(harness.repository.appendMessage).toHaveBeenCalledWith(
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
