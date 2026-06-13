import { describe, expect, it, vi } from "vitest"

import {
  chatbotToolRegistry,
  dispatchChatbotToolCall,
  formatChatbotToolRegistryForPrompt,
} from "@/lib/chatbot/server/tool-dispatcher"

const jobContext = {
  jobKind: "cm-30s",
  finalMedium: "web",
  workSite: "remote-grading",
  documentaryAttachment: { kind: "none" },
} as const

describe("chatbot tool dispatcher", () => {
  it("registers the Phase 0 tools", () => {
    expect(Object.keys(chatbotToolRegistry).sort()).toEqual([
      "create_booking",
      "get_estimate",
      "show_booking_card",
    ])
    expect(formatChatbotToolRegistryForPrompt()).toContain("create_booking")
    expect(formatChatbotToolRegistryForPrompt()).toContain("show_booking_card")
    expect(formatChatbotToolRegistryForPrompt()).toContain("get_estimate")
  })

  it("can format only Phase 1 executable tools for the prompt", () => {
    const prompt = formatChatbotToolRegistryForPrompt(undefined, { enabledToolNames: ["create_booking"] })

    expect(prompt).toContain("create_booking")
    expect(prompt).toContain("condition:")
    expect(prompt).not.toContain("show_booking_card")
    expect(prompt).not.toContain("get_estimate")
  })

  it("dispatches get_estimate through the existing estimator", async () => {
    const result = await dispatchChatbotToolCall({
      tool: "get_estimate",
      args: { jobContext },
    })

    expect(result.status).toBe("executed")
    expect(result).toMatchObject({
      result: {
        workflowEstimate: {
          totalMinDays: expect.any(Number),
          totalMaxDays: expect.any(Number),
        },
      },
    })
  })

  it("returns the existing booking-card routing shape", async () => {
    const result = await dispatchChatbotToolCall({
      tool: "show_booking_card",
      args: {
        suggestedSlots: [
          {
            start: "2026-06-15T01:00:00.000Z",
            end: "2026-06-15T02:00:00.000Z",
            label: "6月15日 10:00",
            available: true,
          },
        ],
        busyDateKeys: ["2026-06-16"],
        jobContext,
      },
    })

    expect(result).toMatchObject({
      status: "executed",
      tool: "show_booking_card",
      result: {
        routingDecision: {
          kind: "to-booking-inline",
          busyDateKeys: ["2026-06-16"],
          jobContext,
        },
      },
    })
  })

  it("requires authenticated context before create_booking can execute", async () => {
    await expect(
      dispatchChatbotToolCall({
        tool: "create_booking",
        args: { input: bookingInput() },
      }),
    ).resolves.toMatchObject({
      status: "fallback",
      reason: "safety-denied",
    })
  })

  it("wraps the existing createBookingFromApiInput handler", async () => {
    const createBookingFromApiInput = vi.fn().mockResolvedValue({
      status: 200,
      body: { bookingGroupId: "booking_group_1" },
    })

    const result = await dispatchChatbotToolCall({
      tool: "create_booking",
      args: { input: bookingInput() },
      context: {
        userId: "user_1",
        userEmail: "customer@example.com",
        createBookingFromApiInput,
      },
    })

    expect(createBookingFromApiInput).toHaveBeenCalledWith({
      input: bookingInput(),
      userId: "user_1",
      userEmail: "customer@example.com",
    })
    expect(result).toMatchObject({
      status: "executed",
      tool: "create_booking",
      result: {
        status: 200,
        body: { bookingGroupId: "booking_group_1" },
      },
    })
  })

  it("falls back on unknown tools and schema mismatch", async () => {
    await expect(dispatchChatbotToolCall({ tool: "unknown", args: {} })).resolves.toMatchObject({
      status: "fallback",
      reason: "unknown-tool",
    })
    await expect(dispatchChatbotToolCall({ tool: "show_booking_card", args: {} })).resolves.toMatchObject({
      status: "fallback",
      reason: "invalid-args",
    })
  })
})

function bookingInput() {
  return {
    projectTitle: "テスト案件",
    dueDate: "2026-07-31",
    companyName: "テスト株式会社",
    contactName: "テスト太郎",
    sessionEmail: "customer@example.com",
    phone: "",
    memo: "",
    agreed: true,
    selectedSlots: [
      {
        start: "2026-06-15T01:00:00.000Z",
        end: "2026-06-15T02:00:00.000Z",
      },
    ],
  }
}
