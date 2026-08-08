import { fileURLToPath } from "node:url"

import { config as loadDotenv } from "dotenv"

import type {
  ChatbotLlmClient,
  ChatbotLlmRequest,
  ChatbotLlmTier,
} from "@/lib/chatbot/server/llm-client"
import { createTier2GeminiFlashClient } from "@/lib/chatbot/server/llm-clients/tier2-gemini-flash"
import {
  createTier3FormFallbackClient,
  tier3FormFallbackCustomerText,
} from "@/lib/chatbot/server/llm-clients/tier3-form-fallback"
import { createChatbotLlmTierOrchestrator } from "@/lib/chatbot/server/llm-orchestrator"
import { CHATBOT_OPERATOR_NOTIFICATION_EMAIL } from "@/lib/chatbot/server/operator-notification"

loadDotenv({ path: ".env.local", override: false, quiet: true })
loadDotenv({ path: ".env", override: false, quiet: true })

export const fallbackLiveCanary = "HP-FALLBACK-CUSTOMER-EXPERIENCE-CANARY"

type InquiryResult = {
  ok?: unknown
  delivered?: unknown
}

type SafeFallbackReport = {
  ok: true
  results: {
    tier2: {
      status: "pass"
      tier: "tier-2-gemini-flash"
      canaryMatched: true
      customerDisplayContract: true
      uiKind: "choice-panel"
    }
    tier3: {
      status: "pass"
      tier: "tier-3-form-fallback"
      customerTextMatched: true
      expectedUiKind: "tier3-inquiry-form"
    }
    inquiry: {
      status: "pass"
      accepted: true
      delivered: true
    }
  }
}

type VerificationOptions = {
  tier2Client: ChatbotLlmClient
  tier3Client: ChatbotLlmClient
  submitInquiry: () => Promise<InquiryResult>
}

export async function verifyFallbackCustomerExperience(
  options: VerificationOptions,
): Promise<SafeFallbackReport> {
  const tier2Result = await createChatbotLlmTierOrchestrator({
    clients: [unavailableClient("tier-1-hosted-chrome-notion-ai"), options.tier2Client, options.tier3Client],
  }).generate(fallbackRequest())

  if (tier2Result.tier !== "tier-2-gemini-flash") throw new Error("tier2_fallback_not_selected")
  if (!tier2Result.displayEnvelope.displayText.includes(fallbackLiveCanary)) {
    throw new Error("tier2_canary_missing")
  }
  if (tier2Result.displayEnvelope.uiPayload.kind !== "choice-panel") {
    throw new Error("tier2_customer_display_contract_failed")
  }

  const tier3Result = await createChatbotLlmTierOrchestrator({
    clients: [
      unavailableClient("tier-1-hosted-chrome-notion-ai"),
      unavailableClient("tier-2-gemini-flash"),
      options.tier3Client,
    ],
  }).generate(fallbackRequest())

  if (tier3Result.tier !== "tier-3-form-fallback") throw new Error("tier3_fallback_not_selected")
  if (tier3Result.displayEnvelope.displayText !== tier3FormFallbackCustomerText) {
    throw new Error("tier3_customer_text_contract_failed")
  }

  const inquiry = await options.submitInquiry()
  if (inquiry.ok !== true || inquiry.delivered !== true) {
    throw new Error("inquiry_delivery_not_confirmed")
  }

  return {
    ok: true,
    results: {
      tier2: {
        status: "pass",
        tier: "tier-2-gemini-flash",
        canaryMatched: true,
        customerDisplayContract: true,
        uiKind: "choice-panel",
      },
      tier3: {
        status: "pass",
        tier: "tier-3-form-fallback",
        customerTextMatched: true,
        expectedUiKind: "tier3-inquiry-form",
      },
      inquiry: {
        status: "pass",
        accepted: true,
        delivered: true,
      },
    },
  }
}

function fallbackRequest(): ChatbotLlmRequest {
  const structuredReply = `<customer_reply>${fallbackLiveCanary}\n{"tool":"show_choice_panel","args":{"id":"job-kind","question":"案件の種類を教えてください","choices":[{"id":"cm","label":"CM"},{"id":"other","label":"その他"}]}}</customer_reply>`

  return {
    requestId: "fallback-customer-experience-live",
    systemPrompt: [
      "This is a controlled customer-display contract canary.",
      "Return exactly the following payload with no Markdown fence, prefix, or suffix:",
      structuredReply,
    ].join("\n"),
    messages: [{ role: "user", content: "フォールバック表示契約を確認してください。" }],
    latestUserMessage: "フォールバック表示契約を確認してください。",
    conversationState: {
      hasFinalMedium: false,
      hasJobKind: false,
      hasAdditionalWork: false,
      hasDocumentaryAttachments: false,
      hasWorkSite: false,
      hasReferenceUrls: false,
      hasContactEmail: false,
      hasDesiredSchedule: false,
      turnCount: 1,
    },
    jobContext: {
      finalMedium: "other",
      workSite: "remote-grading",
      documentaryAttachment: { kind: "none" },
    },
    temperature: 0,
    maxOutputTokens: 300,
  }
}

function unavailableClient(tier: ChatbotLlmTier): ChatbotLlmClient {
  const error = new Error("controlled_fallback_injection")
  return {
    tier,
    isHealthy: async () => false,
    generate: async () => {
      throw error
    },
    getLastHealthError: () => error,
  }
}

async function submitInquiry(baseUrl: string): Promise<InquiryResult> {
  const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/api/chatbot/submit-inquiry`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Fallback E2E Canary",
      email: CHATBOT_OPERATOR_NOTIFICATION_EMAIL,
      jobType: "運用テスト",
      duration: "対象外",
      desiredDeadline: "対象外",
      freeText: fallbackLiveCanary,
    }),
  })

  if (!response.ok) throw new Error(`inquiry_http_${response.status}`)
  return await response.json() as InquiryResult
}

function readBaseUrl(argv: string[]): string {
  const index = argv.indexOf("--base-url")
  const value = index >= 0 ? argv[index + 1]?.trim() : undefined
  return value || "http://localhost:41238"
}

async function main(): Promise<void> {
  const baseUrl = readBaseUrl(process.argv.slice(2))
  const report = await verifyFallbackCustomerExperience({
    tier2Client: createTier2GeminiFlashClient(),
    tier3Client: createTier3FormFallbackClient(),
    submitInquiry: () => submitInquiry(baseUrl),
  })
  console.log(JSON.stringify(report, null, 2))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "fallback_live_verification_failed")
    process.exit(1)
  })
}
