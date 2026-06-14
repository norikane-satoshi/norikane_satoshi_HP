import type { ChatbotLlmClient, ChatbotLlmRequest, ChatbotLlmResponse } from "@/lib/chatbot/server/llm-client"

type Tier4FormFallbackClientOptions = {
  responseText?: string
}

export const tier4FormFallbackDefaults = {
  responseText:
    "確認項目をフォームに切り替えます。案件内容とご連絡先を整理して送信してください。",
} as const

const tier = "tier-4-form-fallback" as const

export class Tier4FormFallbackClient implements ChatbotLlmClient {
  readonly tier = tier
  private readonly responseText: string

  constructor(options: Tier4FormFallbackClientOptions = {}) {
    this.responseText = options.responseText ?? tier4FormFallbackDefaults.responseText
  }

  async generate(request: ChatbotLlmRequest): Promise<ChatbotLlmResponse> {
    const startedAt = Date.now()
    void request

    return {
      rawText: this.responseText,
      tier: this.tier,
      latencyMs: Date.now() - startedAt,
    }
  }

  async isHealthy(): Promise<boolean> {
    return true
  }
}

export function createTier4FormFallbackClient(
  overrides: Tier4FormFallbackClientOptions = {},
): Tier4FormFallbackClient {
  return new Tier4FormFallbackClient(overrides)
}
