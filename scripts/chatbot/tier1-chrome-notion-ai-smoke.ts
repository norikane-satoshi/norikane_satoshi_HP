import { createTier1ChromeNotionAiClient } from "@/lib/chatbot/server/llm-clients/tier1-chrome-notion-ai"
import { ChatbotLlmError, type ChatbotLlmRequest } from "@/lib/chatbot/server/llm-client"

type JsonListTarget = {
  id?: string
  type?: string
  url?: string
  title?: string
}

const cdpBaseUrl = process.env.CHATBOT_TIER1_CDP_BASE_URL ?? "http://127.0.0.1:9223"
const targetUrlIncludes = "notion.so"

async function main(): Promise<void> {
  const target = await findTarget()
  const client = createTier1ChromeNotionAiClient({
    cdpBaseUrl,
    targetUrlIncludes,
  })
  const startedAt = Date.now()
  const response = await client.generate(buildRequest())
  const latencyMs = response.latencyMs ?? Date.now() - startedAt

  console.log(
    JSON.stringify(
      {
        status: "✅",
        endpoint: "/api/v3/runInferenceTranscript",
        contentType: "application/x-ndjson",
        targetId: target.id,
        targetTitle: target.title,
        targetUrl: target.url,
        latencyMs,
        rawTextPreview: response.rawText.replace(/\s+/g, " ").slice(0, 160),
      },
      null,
      2,
    ),
  )
}

async function findTarget(): Promise<JsonListTarget> {
  const response = await fetch(`${cdpBaseUrl}/json/list`)
  if (!response.ok) {
    throw new Error(`Chrome CDP target list failed: ${response.status}`)
  }

  const targets = (await response.json()) as JsonListTarget[]
  const target = targets.find((candidate) => {
    const url = candidate.url ?? ""
    return (
      candidate.type === "page" &&
      url.includes(targetUrlIncludes) &&
      (url.includes("/ai") || url.includes("/chat"))
    )
  })
  if (!target) {
    throw new ChatbotLlmError({
      message: "No Notion AI page target was found on the configured Chrome CDP port.",
      code: "connection",
      tier: "tier-1-chrome-notion-ai",
      isRetryable: true,
    })
  }

  return target
}

function buildRequest(): ChatbotLlmRequest {
  return {
    systemPrompt:
      "あなたはのりかね映像設計室の新規案件相談窓口です。金額は提示せず、所要日数だけを簡潔に返してください。",
    messages: [],
    conversationState: {
      hasFinalMedium: true,
      hasJobKind: true,
      hasAdditionalWork: true,
      hasDocumentaryAttachments: true,
      hasWorkSite: true,
      hasReferenceUrls: false,
      hasContactEmail: true,
      hasDesiredSchedule: false,
      turnCount: 1,
      contactEmail: "fake.customer@example.test",
      customerName: "Fake Customer",
      companyName: "Fake Company",
    },
    jobContext: {
      jobKind: "cm",
      lengthMinutes: 0.5,
      additionalWork: [],
      workSite: "satoshi-studio",
    } as unknown as ChatbotLlmRequest["jobContext"],
    latestUserMessage: "CM 30 秒で追加作業なしの相談です。所要日数だけ教えてください",
    temperature: 0,
    maxOutputTokens: 512,
  }
}

main().catch((error: unknown) => {
  if (error instanceof ChatbotLlmError) {
    console.error(`${error.name}: ${error.code}: ${error.message}`)
    process.exit(1)
  }
  if (error instanceof Error) {
    console.error(`${error.name}: ${error.message}`)
    process.exit(1)
  }
  console.error(String(error))
  process.exit(1)
})
