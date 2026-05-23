import { describe, expect, it, vi } from "vitest"

import type { ConversationState, JobContext } from "@/lib/chatbot/domain"
import type { ChatbotLlmRequest } from "@/lib/chatbot/server/llm-client"
import { ChatbotLlmError } from "@/lib/chatbot/server/llm-client"
import {
  createTier1ChromeClaudeClient,
  Tier1ChromeClaudeClient,
} from "@/lib/chatbot/server/llm-clients/tier1-chrome-claude"

const baseConfig = {
  remoteDebuggingPort: 9223,
  modelSelector: "apricot-sorbet-high",
  requestTimeoutMs: 20,
  healthCheckTimeoutMs: 20,
} as const

function conversationState(): ConversationState {
  return {
    hasFinalMedium: true,
    hasJobKind: true,
    hasAdditionalWork: true,
    hasDocumentaryAttachments: true,
    hasWorkSite: true,
    hasReferenceUrls: true,
    hasContactEmail: true,
    hasDesiredSchedule: true,
    turnCount: 1,
  }
}

function jobContext(): JobContext {
  return {
    jobKind: "cm-30s",
    finalMedium: "web",
    workSite: "remote-grading",
    documentaryAttachment: { kind: "none" },
  }
}

function llmRequest(): ChatbotLlmRequest {
  return {
    systemPrompt: "Collect only new project intake details.",
    messages: [{ role: "user", content: "来月のWeb CM案件です" }],
    latestUserMessage: "立ち会い候補を相談したいです",
    conversationState: conversationState(),
    jobContext: jobContext(),
  }
}

function cdpClient(overrides: {
  rawText?: string
  authRequired?: boolean
  hasClaudeTarget?: boolean
  generate?: () => Promise<{ rawText: string; authRequired?: boolean }>
} = {}) {
  return {
    hasClaudeTarget: vi.fn(async () => overrides.hasClaudeTarget ?? true),
    generate: vi.fn(
      overrides.generate ??
        (async () => ({
          rawText: overrides.rawText ?? "候補日を 2 つ確認しました。",
          authRequired: overrides.authRequired,
        })),
    ),
    close: vi.fn(async () => undefined),
  }
}

async function expectLlmError(
  promise: Promise<unknown>,
  expected: { code: ChatbotLlmError["code"]; isRetryable: boolean },
) {
  await expect(promise).rejects.toBeInstanceOf(ChatbotLlmError)
  await expect(promise).rejects.toMatchObject({
    code: expected.code,
    isRetryable: expected.isRetryable,
    tier: "tier-1-chrome-claude",
  })
}

describe("Tier1ChromeClaudeClient", () => {
  it("keeps the tier property fixed to tier 1 Chrome Claude", () => {
    const client = createTier1ChromeClaudeClient()

    expect(client.tier).toBe("tier-1-chrome-claude")
  })

  it("returns raw text and tier when the CDP client returns a valid response", async () => {
    const client = new Tier1ChromeClaudeClient({
      ...baseConfig,
      cdpClientFactory: async () => cdpClient({ rawText: "整理した相談内容です。" }),
    })

    await expect(client.generate(llmRequest())).resolves.toMatchObject({
      rawText: "整理した相談内容です。",
      tier: "tier-1-chrome-claude",
    })
  })

  it("throws a retryable connection error when the CDP connection fails", async () => {
    const client = new Tier1ChromeClaudeClient({
      ...baseConfig,
      cdpClientFactory: async () => {
        throw new Error("ECONNREFUSED")
      },
    })

    await expectLlmError(client.generate(llmRequest()), {
      code: "connection",
      isRetryable: true,
    })
  })

  it("throws a retryable timeout error when the CDP response exceeds requestTimeoutMs", async () => {
    const client = new Tier1ChromeClaudeClient({
      ...baseConfig,
      requestTimeoutMs: 1,
      cdpClientFactory: async () =>
        cdpClient({
          generate: () => new Promise(() => undefined),
        }),
    })

    await expectLlmError(client.generate(llmRequest()), {
      code: "timeout",
      isRetryable: true,
    })
  })

  it("throws a non-retryable invalid-output error when Claude returns empty text", async () => {
    const client = new Tier1ChromeClaudeClient({
      ...baseConfig,
      cdpClientFactory: async () => cdpClient({ rawText: "   " }),
    })

    await expectLlmError(client.generate(llmRequest()), {
      code: "invalid-output",
      isRetryable: false,
    })
  })

  it("returns healthy only when CDP connects and a Claude target is visible", async () => {
    const healthyClient = new Tier1ChromeClaudeClient({
      ...baseConfig,
      cdpClientFactory: async () => cdpClient({ hasClaudeTarget: true }),
    })
    const missingTargetClient = new Tier1ChromeClaudeClient({
      ...baseConfig,
      cdpClientFactory: async () => cdpClient({ hasClaudeTarget: false }),
    })
    const disconnectedClient = new Tier1ChromeClaudeClient({
      ...baseConfig,
      cdpClientFactory: async () => {
        throw new Error("CDP unavailable")
      },
    })

    await expect(healthyClient.isHealthy()).resolves.toBe(true)
    await expect(missingTargetClient.isHealthy()).resolves.toBe(false)
    await expect(disconnectedClient.isHealthy()).resolves.toBe(false)
  })

  it("throws a non-retryable auth error when the Claude tab requires login or challenge handling", async () => {
    const client = new Tier1ChromeClaudeClient({
      ...baseConfig,
      cdpClientFactory: async () => cdpClient({ rawText: "", authRequired: true }),
    })

    await expectLlmError(client.generate(llmRequest()), {
      code: "auth",
      isRetryable: false,
    })
  })
})
