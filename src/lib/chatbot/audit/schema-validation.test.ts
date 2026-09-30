import { afterEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"
import { chatbotAuditStageTimingsSchema, chatbotServerAuditEventSchema } from "./contract"
import { parseChatbotAuditSchema } from "./schema-validation"
import { describeFailureForAudit, summarizeTierAttemptForAudit } from "./server-evidence"

afterEach(() => vi.restoreAllMocks())

describe("audit schema diagnostics", () => {
  it("distinguishes process uptime from bounded request durations", () => {
    expect(chatbotAuditStageTimingsSchema.parse({ instanceWarmup: 86_400_000 })).toEqual({ instanceWarmup: 86_400_000 })
    for (const value of [-1, 1.5, NaN, Infinity]) {
      expect(chatbotAuditStageTimingsSchema.safeParse({ instanceWarmup: value }).success).toBe(false)
    }
    expect(chatbotAuditStageTimingsSchema.safeParse({ totalServer: 180_001 }).success).toBe(false)
  })

  it("logs schema paths and codes without rejected values, unknown keys, or issue messages", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const parsed = chatbotServerAuditEventSchema.safeParse({})
    expect(parsed.success).toBe(false)
    let error: unknown
    try {
      parseChatbotAuditSchema("chatbotServerAuditEventSchema", chatbotServerAuditEventSchema, {
        schemaVersion: "1",
        eventId: "11111111-1111-4111-8111-111111111111",
        correlationId: "11111111-1111-4111-8111-111111111111",
        conversationId: "private-conversation",
        eventName: "request_received",
        result: "success",
        stageTimings: { contextPreparation: "private-client@example.com" },
        "private-unknown-key@example.com": "private body",
      })
    } catch (caught) { error = caught }
    expect(error).toBeInstanceOf(z.ZodError)
    expect(describeFailureForAudit(error)).toContain("ZodError:chatbotServerAuditEventSchema:stageTimings.contextPreparation:invalid_type")
    const serialized = JSON.stringify(log.mock.calls)
    expect(serialized).toContain("unrecognized_keys")
    expect(serialized).not.toContain("private")
    expect(describeFailureForAudit(error)).toMatch(/^[a-z0-9][a-z0-9_.:-]{0,119}$/i)
  })

  it("redacts dynamic paths of unannotated Zod errors in failure and tier audit reasons", () => {
    const result = z.record(z.string(), z.number()).safeParse({ "private@example.com": "private body" })
    if (result.success) throw new Error("expected rejection")
    expect(describeFailureForAudit(result.error)).toBe("ZodError:unknown:redacted:invalid_type")
    expect(summarizeTierAttemptForAudit({
      tier: "tier-1-hosted-chrome-notion-ai", phase: "generate", outcome: "error",
      error: result.error, latencyMs: 1,
    }).errorReason).toBe("ZodError:unknown:redacted:invalid_type")
  })
})
