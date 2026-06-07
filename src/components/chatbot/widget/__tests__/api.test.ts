import { afterEach, describe, expect, it, vi } from "vitest"

import {
  isChatbotRequestCancelledError,
  submitChatbotMessage,
} from "@/components/chatbot/widget/api"

describe("chatbot widget API client", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("passes AbortSignal to the chatbot message request", async () => {
    const controller = new AbortController()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        conversationId: "conv_1",
        userMessage: {
          id: "user_msg_1",
          role: "user",
          content: "相談です",
          createdAt: "2026-05-26T00:00:00.000Z",
        },
        assistantMessage: {
          id: "assistant_msg_1",
          role: "assistant",
          content: "整理します",
          createdAt: "2026-05-26T00:00:01.000Z",
        },
        tier: "tier-3-ollama-deepseek",
        ui: { kind: "none" },
      }),
    })
    vi.stubGlobal("fetch", fetchMock)

    await submitChatbotMessage(
      {
        message: "相談です",
        clientUserMessageId: "client_msg_00000000-0000-4000-8000-000000000001",
        clientSessionId: "00000000-0000-4000-8000-000000000002",
      },
      { signal: controller.signal },
    )

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/chatbot/message",
      expect.objectContaining({ signal: controller.signal }),
    )
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toMatchObject({
      clientUserMessageId: "client_msg_00000000-0000-4000-8000-000000000001",
      clientSessionId: "00000000-0000-4000-8000-000000000002",
    })
  })

  it("turns AbortError into a quiet cancellation error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("Aborted", "AbortError")))

    await expect(submitChatbotMessage({ message: "相談です" })).rejects.toSatisfy(
      isChatbotRequestCancelledError,
    )
  })
})
