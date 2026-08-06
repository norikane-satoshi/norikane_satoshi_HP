import type { ChatbotLlmClient, ChatbotLlmRequest, ChatbotLlmResponse } from "@/lib/chatbot/server/llm-client"
import { chatbotLlmTierIds, createChatbotLlmResponse } from "@/lib/chatbot/server/llm-client"

type Tier3FormFallbackClientOptions = {
  responseText?: string
}

// Tier 3 always renders the inquiry form, so its customer-facing text must describe that form.
// Carrying a routing question here told customers to pick from options that were never shown.
export const tier3FormFallbackCustomerText =
  "確認項目をフォームに切り替えます。案件内容とご連絡先を整理して送信してください。"

export const tier3FormFallbackDefaults = {
  responseText: `<customer_reply>${tier3FormFallbackCustomerText}</customer_reply>`,
} as const

const tier = chatbotLlmTierIds.tier3FormFallback

export class Tier3FormFallbackClient implements ChatbotLlmClient {
  readonly tier = tier
  private readonly responseText: string

  constructor(options: Tier3FormFallbackClientOptions = {}) {
    this.responseText = options.responseText ?? tier3FormFallbackDefaults.responseText
  }

  async generate(request: ChatbotLlmRequest): Promise<ChatbotLlmResponse> {
    const startedAt = Date.now()
    void request

    return createChatbotLlmResponse({
      rawText: this.responseText,
      tier: this.tier,
      latencyMs: Date.now() - startedAt,
    })
  }

  async isHealthy(): Promise<boolean> {
    return true
  }
}

export function createTier3FormFallbackClient(
  overrides: Tier3FormFallbackClientOptions = {},
): Tier3FormFallbackClient {
  return new Tier3FormFallbackClient(overrides)
}
