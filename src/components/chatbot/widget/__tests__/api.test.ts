import { afterEach, describe, expect, it, vi } from "vitest"

import {
  ChatbotRequestCancelledError,
  isChatbotOperationError,
  isChatbotRequestCancelledError,
  scheduleChatbotReloadForStaleClient,
  submitChatbotMessage,
} from "@/components/chatbot/widget/api"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("submitChatbotMessage", () => {
  it("passes AbortSignal to fetch and converts AbortError into cancellation", async () => {
    const controller = new AbortController()
    const abortError = new DOMException("Aborted", "AbortError")
    const fetchMock = vi.fn().mockRejectedValue(abortError)
    vi.stubGlobal("fetch", fetchMock)

    await expect(
      submitChatbotMessage({ message: "止めます" }, { signal: controller.signal }),
    ).rejects.toBeInstanceOf(ChatbotRequestCancelledError)

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/chatbot/message",
      expect.objectContaining({ signal: controller.signal }),
    )
  })

  it("identifies chatbot cancellation errors", () => {
    expect(isChatbotRequestCancelledError(new ChatbotRequestCancelledError())).toBe(true)
    expect(isChatbotRequestCancelledError(new Error("AbortError"))).toBe(false)
  })

  it("preserves request-scoped failure metadata from the message route", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: vi.fn().mockResolvedValue({
        error: "chatbot_operation_failed",
        requestId: "req_1",
        failure: {
          stage: "conversation-save",
          retryable: true,
          fallback: "tier4-inquiry-form",
        },
      }),
    })
    vi.stubGlobal("fetch", fetchMock)

    try {
      await submitChatbotMessage({ message: "相談したいです" })
      throw new Error("expected submitChatbotMessage to reject")
    } catch (error) {
      expect(isChatbotOperationError(error)).toBe(true)
      if (!isChatbotOperationError(error)) return
      expect(error.requestId).toBe("req_1")
      expect(error.stage).toBe("conversation-save")
      expect(error.retryable).toBe(true)
      expect(error.fallback).toBe("tier4-inquiry-form")
    }
  })

  it("schedules a reload when the server response was produced by a newer client build", () => {
    const reload = vi.fn()
    const setTimeoutFn = vi.fn()

    expect(
      scheduleChatbotReloadForStaleClient(
        { clientBuildId: "new-build" },
        { currentBuildId: "old-build", reload, setTimeoutFn: setTimeoutFn as unknown as typeof window.setTimeout },
      ),
    ).toBe(true)

    expect(setTimeoutFn).toHaveBeenCalledWith(reload, 250)
  })

  it("does not reload for local or matching chatbot builds", () => {
    expect(scheduleChatbotReloadForStaleClient({ clientBuildId: "same" }, { currentBuildId: "same" })).toBe(false)
    expect(scheduleChatbotReloadForStaleClient({ clientBuildId: "new" }, { currentBuildId: "local" })).toBe(false)
    expect(scheduleChatbotReloadForStaleClient({ clientBuildId: "local" }, { currentBuildId: "old" })).toBe(false)
  })
})
