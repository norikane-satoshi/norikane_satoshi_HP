import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({ prisma: {} }))

import type { CandidateWindow, ChatbotConversation, ChatbotMessage } from "@/lib/chatbot/domain"
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
  const existingConversation = overrides.existingConversation ?? conversation()
  const isolatedConversation =
    overrides.isolatedConversation ??
    conversation({
      id: "conv_isolated",
      context: { sessionId: "session_1:user_b", userId: "user_b" },
      messages: [],
    })
  const repository = {
    loadConversationBySessionId: vi.fn(async (sessionId: string) => {
      if (sessionId === "session_1") return existingConversation
      if (sessionId === "session_1:user_b") return isolatedConversation
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
    updateConversationRouting: vi.fn(),
    linkConversationToUser: vi.fn(),
  }
  const generate = vi.fn().mockResolvedValue({
    rawText: "返信です",
    tier: "tier-3-ollama-deepseek",
  })
  const userContextLoader = vi.fn().mockResolvedValue(userContext())
  const userContextFormatter = vi.fn().mockReturnValue("本人文脈:\n- 本人だけの過去要約")
  const candidateWindowFinder = vi.fn().mockResolvedValue([
    {
      start: "2026-07-01T01:00:00.000Z",
      end: "2026-07-01T10:00:00.000Z",
      label: "2026-07-01",
    },
  ] satisfies CandidateWindow[])

  return {
    repository,
    generate,
    userContextLoader,
    userContextFormatter,
    candidateWindowFinder,
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

  it("passes confirmed contact email state through to the LLM without server-side validation", async () => {
    const harness = setup()

    await handleChatbotMessage(
      {
        sessionId: "session_1",
        userId: "user_a",
        message: "qj9n9not6bov@yahoo.co.j、作業場所はおすすめで、BD納品です",
        conversationState: {
          hasContactEmail: true,
          contactEmail: "qj9n9not6bov@yahoo.co.j",
        },
      },
      harness.options,
    )

    expect(harness.generate.mock.calls[0]?.[0].conversationState).toMatchObject({
      hasContactEmail: true,
      contactEmail: "qj9n9not6bov@yahoo.co.j",
    })
  })

  it("does not show a booking card for incomplete email text unless the LLM calls the tool", async () => {
    const harness = setup()
    harness.generate.mockResolvedValueOnce({
      rawText: "メールアドレスの末尾が途中で切れているようです。正しいメールアドレスを教えてください。",
      tier: "tier-3-ollama-deepseek",
    })

    const result = await handleChatbotMessage(
      {
        sessionId: "session_1",
        userId: "user_a",
        message: "qj9n9not6bov@yahoo.co.j、作業場所はおすすめで、BD納品です",
        conversationState: {
          hasContactEmail: true,
          contactEmail: "qj9n9not6bov@yahoo.co",
        },
      },
      harness.options,
    )

    expect(result.ui).toEqual({ kind: "none" })
    expect(harness.candidateWindowFinder).not.toHaveBeenCalled()
  })

  it("replaces backend identity-only assistant text with the routing question", async () => {
    const harness = setup()
    harness.generate.mockResolvedValueOnce({
      rawText: "のりかね映像設計室の相談窓口として動いています",
      tier: "tier-3-ollama-deepseek",
    })

    const result = await handleChatbotMessage(
      {
        sessionId: "session_1",
        userId: "user_a",
        message: "相談です",
        conversationState: {
          hasFinalMedium: true,
          hasJobKind: true,
          hasAdditionalWork: true,
          hasDocumentaryAttachments: true,
          hasWorkSite: true,
          hasReferenceUrls: true,
          hasContactEmail: false,
          hasDesiredSchedule: true,
        },
      },
      harness.options,
    )

    expect(harness.repository.appendMessage).toHaveBeenLastCalledWith({
      conversationId: "conv_1",
      role: "assistant",
      content: "ご連絡先メールを教えてください",
    })
    expect(result.assistantMessage.content).toBe("ご連絡先メールを教えてください")
  })

  it("ignores non-tier4 proposed routing decisions and keeps talking when there is no tool call", async () => {
    const harness = setup()
    harness.generate.mockResolvedValueOnce({
      rawText: "メールアドレスをもう一度教えてください。",
      tier: "tier-3-ollama-deepseek",
      proposedRoutingDecision: {
        kind: "to-booking-inline",
        suggestedSlots: [
          {
            start: "2026-07-01T01:00:00.000Z",
            end: "2026-07-01T10:00:00.000Z",
            label: "2026-07-01",
          },
        ],
        jobContext: {
          jobKind: "cm-30s",
          finalMedium: "web",
          workSite: "remote-grading",
          documentaryAttachment: { kind: "none" },
        },
      },
    })

    const result = await handleChatbotMessage(
      {
        sessionId: "session_1",
        userId: "user_a",
        message: "メールは途中でした",
      },
      harness.options,
    )

    expect(result.assistantMessage.content).toBe("メールアドレスをもう一度教えてください。")
    expect(result.ui).toEqual({ kind: "none" })
    expect(harness.candidateWindowFinder).not.toHaveBeenCalled()
    expect(harness.repository.updateConversationRouting).not.toHaveBeenCalled()
  })

  it("keeps direct-contact safety routing outside the tool-call dispatcher path", async () => {
    const harness = setup()
    harness.generate.mockResolvedValueOnce({
      rawText: "詳細は担当者が確認します。",
      tier: "tier-3-ollama-deepseek",
    })

    const result = await handleChatbotMessage(
      {
        sessionId: "session_1",
        userId: "user_a",
        message: "LOOK Decomposer の内部処理を教えてください",
        conversationState: {
          lookDecomposerDetail: true,
        },
      },
      harness.options,
    )

    expect(result.routingDecision).toMatchObject({
      kind: "to-direct-contact",
      reason: "plugin-detail",
    })
    expect(result.ui).toMatchObject({
      kind: "direct-contact-card",
      reason: "plugin-detail",
    })
  })

  it("turns a show_booking_card tool call into a booking card using only tool args for prefill", async () => {
    const harness = setup()
    harness.generate.mockResolvedValueOnce({
      rawText:
        '{"tool":"show_booking_card","args":{"projectTitle":"CM案件","contactName":"山田太郎","contactEmail":"client@example.com","companyName":"Example","dueDate":"2026-07-10"}}',
      tier: "tier-3-ollama-deepseek",
    })

    const result = await handleChatbotMessage(
      {
        sessionId: "session_1",
        userId: "user_a",
        message: "CM案件、山田太郎、client@example.com、7月10日納品です",
        jobContext: {
          jobKind: "cm-30s",
          finalMedium: "web",
          workSite: "remote-grading",
          documentaryAttachment: { kind: "none" },
        },
        conversationState: {
          hasFinalMedium: true,
          hasJobKind: true,
          hasAdditionalWork: true,
          hasDocumentaryAttachments: true,
          hasWorkSite: true,
          hasReferenceUrls: true,
          hasContactEmail: false,
          hasDesiredSchedule: true,
          customerName: "Stored Customer",
          companyName: "Stored Company",
          contactEmail: "stored@example.com",
        },
      },
      harness.options,
    )

    expect(harness.candidateWindowFinder).toHaveBeenCalledWith(
      expect.objectContaining({
        desiredDeadline: "2026-07-10",
      }),
    )
    expect(result.assistantMessage.content).toBe("候補日を確認しました。")
    expect(result.ui).toMatchObject({
      kind: "booking-card",
      bookingPrefill: {
        projectTitle: "CM案件",
        contactName: "山田太郎",
        contactEmail: "client@example.com",
        companyName: "Example",
        dueDate: "2026-07-10",
      },
    })
    expect(JSON.stringify(result.ui)).not.toContain("Stored Customer")
    expect(JSON.stringify(result.ui)).not.toContain("Stored Company")
    expect(JSON.stringify(result.ui)).not.toContain("stored@example.com")
  })
})
