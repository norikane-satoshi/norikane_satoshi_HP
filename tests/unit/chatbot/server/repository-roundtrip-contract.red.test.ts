import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  conversationUpsert: vi.fn(),
  conversationUpdate: vi.fn(),
  messageFindUnique: vi.fn(),
  messageDeleteMany: vi.fn(),
  transaction: vi.fn(),
  executeRaw: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    chatbotConversation: {
      upsert: mocks.conversationUpsert,
      update: mocks.conversationUpdate,
    },
    chatbotMessage: {
      findUnique: mocks.messageFindUnique,
      deleteMany: mocks.messageDeleteMany,
    },
    $transaction: mocks.transaction,
    $executeRaw: mocks.executeRaw,
  },
}))

import {
  appendMessage,
  loadOrCreateConversationBySessionId,
  truncateConversationFromMessage,
  updateConversationRouting,
} from "@/lib/chatbot/server/repository"

function conversationRow() {
  return {
    id: "conversation_1",
    sessionId: "session_1",
    userId: null,
    startedAt: new Date("2026-08-23T00:00:00.000Z"),
    lastMessageAt: new Date("2026-08-23T00:00:00.000Z"),
    routingDecision: "continue",
    inquirySentAt: null,
    bookingId: null,
    customerName: null,
    customerCompany: null,
    customerEmail: null,
    customerPhone: null,
    slackThreadTs: null,
    currentQuestion: null,
    activeChoices: null,
    conversationState: null,
    finalMedium: null,
    jobType: null,
    mainDuration: null,
    workSite: null,
    workSiteDetails: null,
    attachments: null,
    additionalWork: null,
    referenceUrls: null,
    ndaFlag: false,
    messages: [],
  }
}

describe("chatbot repository round-trip contract", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("loads or creates a session conversation with one database mutation", async () => {
    mocks.conversationUpsert.mockResolvedValue(conversationRow())

    const conversation = await loadOrCreateConversationBySessionId({
      sessionId: "session_1",
      userId: null,
    })

    expect(conversation.id).toBe("conversation_1")
    expect(mocks.conversationUpsert).toHaveBeenCalledTimes(1)
    expect(mocks.conversationUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { sessionId: "session_1" },
      create: expect.objectContaining({ sessionId: "session_1", userId: null }),
      update: {},
      include: expect.objectContaining({ messages: expect.any(Object) }),
    }))
  })

  it("appends a message and advances lastMessageAt in one nested mutation", async () => {
    const createdAt = new Date("2026-08-23T00:01:00.000Z")
    mocks.conversationUpdate.mockResolvedValue({
      messages: [{
        id: "message_1",
        conversationId: "conversation_1",
        role: "user",
        content: "test",
        confidence: null,
        llmModel: null,
        llmThinking: false,
        createdAt,
      }],
    })

    const message = await appendMessage({
      id: "message_1",
      conversationId: "conversation_1",
      role: "user",
      content: "test",
    })

    expect(message.id).toBe("message_1")
    expect(mocks.conversationUpdate).toHaveBeenCalledTimes(1)
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.conversationUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "conversation_1" },
      data: expect.objectContaining({
        lastMessageAt: expect.any(Date),
        messages: { create: expect.objectContaining({ id: "message_1", role: "user", content: "test" }) },
      }),
      select: expect.objectContaining({ messages: expect.any(Object) }),
    }))
  })

  it("persists routing and canonical conversation state with one update", async () => {
    mocks.conversationUpdate.mockResolvedValue({ id: "conversation_1" })

    await updateConversationRouting({
      conversationId: "conversation_1",
      routingDecision: "continue",
      currentQuestion: "question",
      activeChoices: {
        id: "choice_1",
        question: "question",
        choices: [{ id: "one", label: "One" }],
      },
      conversationState: {
        hasFinalMedium: true,
        hasJobKind: false,
        hasAdditionalWork: false,
        hasDocumentaryAttachments: false,
        hasWorkSite: true,
        hasReferenceUrls: false,
        hasContactEmail: false,
        hasDesiredSchedule: false,
        turnCount: 1,
      },
      jobContext: {
        finalMedium: "youtube",
        workSite: "remote-grading",
        documentaryAttachment: { kind: "none" },
      },
    })

    expect(mocks.conversationUpdate).toHaveBeenCalledTimes(1)
    expect(mocks.executeRaw).not.toHaveBeenCalled()
    expect(mocks.conversationUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "conversation_1" },
      data: expect.objectContaining({
        routingDecision: "continue",
        currentQuestion: "question",
        activeChoices: expect.stringContaining("choice_1"),
        conversationState: expect.stringContaining("turnCount"),
        finalMedium: "youtube",
      }),
    }))
  })

  it("truncates an edited turn with a non-interactive atomic batch", async () => {
    const createdAt = new Date("2026-08-24T13:55:16.761Z")
    const deleted = { count: 2 }
    const updated = { id: "conversation_1" }
    mocks.messageFindUnique.mockResolvedValue({
      id: "client_msg_11111111-1111-4111-8111-111111111111",
      conversationId: "conversation_1",
      createdAt,
    })
    mocks.messageDeleteMany.mockReturnValue(Promise.resolve(deleted))
    mocks.conversationUpdate.mockReturnValue(Promise.resolve(updated))
    mocks.transaction.mockResolvedValue([deleted, updated])

    await expect(truncateConversationFromMessage({
      conversationId: "conversation_1",
      messageId: "client_msg_11111111-1111-4111-8111-111111111111",
    })).resolves.toEqual({ deletedCount: 2 })

    expect(mocks.transaction).toHaveBeenCalledWith([
      expect.any(Promise),
      expect.any(Promise),
    ])
    expect(mocks.messageDeleteMany).toHaveBeenCalledWith({
      where: {
        conversationId: "conversation_1",
        OR: [
          { createdAt: { gt: createdAt } },
          {
            createdAt,
            id: { gte: "client_msg_11111111-1111-4111-8111-111111111111" },
          },
        ],
      },
    })
    expect(mocks.conversationUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "conversation_1" },
      data: expect.objectContaining({
        routingDecision: "continue",
        currentQuestion: null,
        activeChoices: null,
        conversationState: null,
      }),
    }))
    expect(mocks.executeRaw).not.toHaveBeenCalled()
  })
})
