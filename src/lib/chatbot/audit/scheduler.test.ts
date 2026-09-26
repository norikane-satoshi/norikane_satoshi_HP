import { afterEach, describe, expect, it, vi } from "vitest"

const { afterCallbacks, recordChatbotAuditEvent } = vi.hoisted(() => ({
  afterCallbacks: [] as Array<() => Promise<void> | void>,
  recordChatbotAuditEvent: vi.fn<(event: { eventId: string }) => Promise<void>>(async () => undefined),
}))

vi.mock("next/server", () => ({ after: (callback: () => Promise<void> | void) => { afterCallbacks.push(callback) } }))
vi.mock("@/lib/chatbot/audit/store", () => ({ recordChatbotAuditEvent }))

import type { ChatbotStoredAuditEvent } from "@/lib/chatbot/audit/contract"
import { scheduleDeferredChatbotAuditPersistence } from "@/lib/chatbot/audit/scheduler"

const event = (eventId: string) => ({ eventId, schemaVersion: "1" }) as unknown as ChatbotStoredAuditEvent

afterEach(() => {
  afterCallbacks.length = 0
  vi.clearAllMocks()
})

describe("scheduleDeferredChatbotAuditPersistence", () => {
  it("builds the events after the response and records each one", async () => {
    const build = vi.fn(async () => [event("e1"), event("e2")])
    scheduleDeferredChatbotAuditPersistence(build)

    expect(build).not.toHaveBeenCalled()
    await afterCallbacks[0]()
    expect(recordChatbotAuditEvent.mock.calls.map(([recorded]) => recorded.eventId)).toEqual(["e1", "e2"])
  })

  it("logs instead of throwing when the events cannot be built", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)
    scheduleDeferredChatbotAuditPersistence(async () => { throw new Error("slack evidence lost") })

    await expect(afterCallbacks[0]()).resolves.toBeUndefined()
    expect(recordChatbotAuditEvent).not.toHaveBeenCalled()
    expect(consoleError).toHaveBeenCalledWith("[chatbot audit persistence failed]", { stage: "build", errorName: "Error" })
    consoleError.mockRestore()
  })
})
