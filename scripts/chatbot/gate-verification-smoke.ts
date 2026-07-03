import type { ChatbotLlmClient, ChatbotLlmRequest } from "@/lib/chatbot/server/llm-client"
import { createTier1ChromeNotionAiClient } from "@/lib/chatbot/server/llm-clients/tier1-chrome-notion-ai"
import { runTier1HealthCheck } from "@/lib/chatbot/server/llm-clients/tier1-health-check"
import { createTier3OllamaDeepSeekClient } from "@/lib/chatbot/server/llm-clients/tier3-ollama-deepseek"
import { createChatbotLlmTierOrchestrator } from "@/lib/chatbot/server/llm-orchestrator"
import { normalizeChatbotLlmResponse } from "@/lib/chatbot/server/llm-response-normalizer"
import { recordChatbotGateVerification } from "@/lib/chatbot/server/chatbot-ops-log"
import { createLocalPrismaClient } from "./local-prisma"

type CdpTarget = {
  type?: string
  title?: string
  url?: string
  webSocketDebuggerUrl?: string
}

type CdpResponse<T> = {
  id: number
  result?: T
  error?: { message?: string }
}

type MainChromeSnapshot = {
  href?: string
  title?: string
  text?: string
  targetCount: number
}

const gateIterations = 5
const mainChromeCdpBaseUrl = process.env.CHATBOT_MAIN_CHROME_CDP_BASE_URL ?? "http://127.0.0.1:9222"

async function main(): Promise<void> {
  const prisma = createLocalPrismaClient()
  const summaries: Array<{ gate: number; passed: number; failed: number; details: unknown[] }> = []
  const startGate = Number(process.env.CHATBOT_GATE_START ?? "1")
  const endGate = Number(process.env.CHATBOT_GATE_END ?? "4")

  try {
    if (startGate <= 1 && endGate >= 1) summaries.push(await runGate1(prisma))
    if (startGate <= 2 && endGate >= 2) summaries.push(await runGate2(prisma))
    if (startGate <= 3 && endGate >= 3) summaries.push(await runGate3(prisma))
    if (startGate <= 4 && endGate >= 4) summaries.push(await runGate4(prisma))
    console.log(JSON.stringify({ status: "done", summaries }, null, 2))

    if (summaries.some((summary) => summary.failed > 0)) process.exitCode = 1
  } finally {
    await prisma.$disconnect()
  }
}

async function runGate1(logClient: ReturnType<typeof createLocalPrismaClient>) {
  const client = createTier1ChromeNotionAiClient()
  const details: unknown[] = []
  let passed = 0
  let failed = 0

  for (let iteration = 1; iteration <= gateIterations; iteration += 1) {
    const tokens = [`HP_GATE1_${Date.now()}_${iteration}_A`, `HP_GATE1_${Date.now()}_${iteration}_B`]
    const before = await readMainChromeSnapshot()
    const responses = []

    for (const token of tokens) {
      responses.push(await client.generate(buildRequest(`Gate1 side-effect isolation token ${token}`)))
    }

    const after = await readMainChromeSnapshot()
    const leakedTokens = tokens.filter((token) => `${after.title}\n${after.href}\n${after.text}`.includes(token))
    const iterationPassed = leakedTokens.length === 0 && before.targetCount === after.targetCount
    const detail = {
      iteration,
      payloadCount: tokens.length,
      mainTargetCountBefore: before.targetCount,
      mainTargetCountAfter: after.targetCount,
      leakedTokens,
      responseTiers: responses.map((response) => response.tier),
      attachTargetUrlMatches: responses.every(
        (response) => response.diagnostics?.attachTargetUrlMatches === true,
      ),
    }

    if (iterationPassed) passed += 1
    else failed += 1
    details.push(detail)
    await recordChatbotGateVerification({
      client: logClient,
      gateNumber: 1,
      iteration,
      passed: iterationPassed,
      details: detail,
    })
  }

  return { gate: 1, passed, failed, details }
}

async function runGate2(logClient: ReturnType<typeof createLocalPrismaClient>) {
  const client = createTier1ChromeNotionAiClient()
  const details: unknown[] = []
  let passed = 0
  let failed = 0

  for (let iteration = 1; iteration <= gateIterations; iteration += 1) {
    const inspection = await client.inspectRuntimeContext()
    const response = await client.generate(buildRequest(`Gate2 runtime context probe ${iteration}`))
    const iterationPassed = Boolean(inspection.targetUrl) && response.tier === "tier-1-chrome-notion-ai"
    const detail = {
      iteration,
      selectedModel: inspection.selectedModel,
      finalModelName: inspection.finalModelName,
      responseTier: response.tier,
      responseBytes: response.diagnostics?.responseBytes,
    }

    if (iterationPassed) passed += 1
    else failed += 1
    details.push(detail)
    await recordChatbotGateVerification({
      client: logClient,
      gateNumber: 2,
      iteration,
      passed: iterationPassed,
      details: detail,
    })
  }

  return { gate: 2, passed, failed, details }
}

async function runGate3(logClient: ReturnType<typeof createLocalPrismaClient>) {
  const tier1 = createTier1ChromeNotionAiClient()
  const tier3 = createTier3OllamaDeepSeekClient()
  const cases = [
    {
      name: "topic-gating",
      request: buildRequest("Gate3 topic gating: VFX合成主体の相談は直接確認へ誘導してください"),
    },
    {
      name: "conversation",
      request: buildRequest("Gate3 conversation: 30秒Web CMのカラーグレーディング相談です"),
    },
    {
      name: "reasoning",
      request: buildRequest("Gate3 reasoning: 2分のWeb動画で追加作業なし、工程感だけ一文で返してください"),
    },
    {
      name: "json",
      request: buildRequest("Gate3 JSON: content role model finish_reason を含むJSON互換で返してください"),
    },
  ]
  const clients = [tier1, tier3]
  const details: unknown[] = []
  let passed = 0
  let failed = 0
  let invocationCount = 0

  for (let gateIteration = 1; gateIteration <= gateIterations; gateIteration += 1) {
    for (let caseIndex = 0; caseIndex < cases.length; caseIndex += 1) {
      const currentCase = cases[caseIndex]
      const results = await Promise.all(
        clients.map(async (client) => {
          invocationCount += 1
          let lastError: unknown
          try {
            const orchestrator = createChatbotLlmTierOrchestrator({
              clients: clients.map(withLiveGenerateOnlyHealth),
              tierOrder: [client.tier],
              onTierAttempt: (event) => {
                if (event.outcome === "error") lastError = event.error
              },
            })
            const response = await orchestrator.generate(currentCase.request)
            return {
              ok: true as const,
              tier: client.tier,
              response: normalizeChatbotLlmResponse(response),
              attachTargetUrlMatches: response.diagnostics?.attachTargetUrlMatches,
            }
          } catch (error) {
            return {
              ok: false as const,
              tier: client.tier,
              error: formatGateError(lastError ?? error),
            }
          }
        }),
      )
      const normalized = results.flatMap((result) => (result.ok ? [result.response] : []))
      const iterationPassed =
        results.every((result) => result.ok) &&
        normalized.every((response) => {
          return Boolean(response.content && response.role && response.model && response.finish_reason)
        })
      const detail = {
        iteration: (gateIteration - 1) * cases.length + caseIndex + 1,
        gateIteration,
        caseIndex,
        caseName: currentCase.name,
        models: normalized.map((response) => response.model),
        contentLengths: normalized.map((response) => response.content.length),
        finishReasons: normalized.map((response) => response.finish_reason),
        attachTargetUrlMatches: results
          .filter((result) => result.ok && result.tier === "tier-1-chrome-notion-ai")
          .every((result) => result.attachTargetUrlMatches === true),
        tierOrderSmoke: results.map((result) => result.tier),
        errors: results.flatMap((result) => (result.ok ? [] : [{ tier: result.tier, error: result.error }])),
      }

      if (iterationPassed) passed += 1
      else failed += 1
      details.push(detail)
      await recordChatbotGateVerification({
        client: logClient,
        gateNumber: 3,
        iteration: detail.iteration,
        passed: iterationPassed,
        details: detail,
      })
    }
  }

  return { gate: 3, passed, failed, invocationCount, details }
}

function withLiveGenerateOnlyHealth(client: ChatbotLlmClient): ChatbotLlmClient {
  return {
    tier: client.tier,
    generate: (request) => client.generate(request),
    isHealthy: async () => true,
  }
}

function formatGateError(error: unknown): string {
  if (error instanceof Error) {
    const code = "code" in error ? String(error.code) : undefined
    return code ? `${code}: ${error.message}` : error.message
  }

  return String(error)
}

async function runGate4(logClient: ReturnType<typeof createLocalPrismaClient>) {
  const details: unknown[] = []
  let passed = 0
  let failed = 0

  for (let iteration = 1; iteration <= gateIterations; iteration += 1) {
    const result = await runTier1HealthCheck({ logClient })
    const detail = {
      iteration,
      ok: result.ok,
      rateLimitRemaining: result.rateLimitRemaining,
      rateLimitRemainingRatio: result.rateLimitRemainingRatio,
      runtimeContextPresent: result.runtimeContextPresent,
      responseSuccess: result.responseSuccess,
      consecutiveFailures: result.consecutiveFailures,
      alertSent: result.alertSent,
    }

    if (result.ok) passed += 1
    else failed += 1
    details.push(detail)
    await recordChatbotGateVerification({
      client: logClient,
      gateNumber: 4,
      iteration,
      passed: result.ok,
      details: detail,
    })
  }

  return { gate: 4, passed, failed, details }
}

function buildRequest(latestUserMessage: string): ChatbotLlmRequest {
  return {
    systemPrompt:
      "あなたはのりかね映像設計室の新規案件相談窓口です。金額は提示せず、新規案件調整に必要な範囲だけ簡潔に返してください。",
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
      contactEmail: "gate-smoke@example.test",
    },
    jobContext: {
      jobKind: "cm-30s",
      finalMedium: "web",
      workSite: "remote-grading",
      documentaryAttachment: { kind: "none" },
    },
    latestUserMessage,
    temperature: 0,
    maxOutputTokens: 256,
  }
}

async function readMainChromeSnapshot(): Promise<MainChromeSnapshot> {
  const response = await fetch(`${mainChromeCdpBaseUrl}/json/list`)
  if (!response.ok) throw new Error(`main Chrome target list failed: ${response.status}`)
  const targets = ((await response.json()) as CdpTarget[]).filter((target) => {
    return target.type === "page" && target.url?.includes("notion.so")
  })
  const target = targets[0]
  if (!target?.webSocketDebuggerUrl) return { targetCount: targets.length }
  const result = await evaluateInTarget<{
    href?: string
    title?: string
    text?: string
  }>(
    target.webSocketDebuggerUrl,
    `(() => ({
      href: location.href,
      title: document.title,
      text: (document.body && document.body.innerText || "").slice(0, 40000),
    }))()`,
  )

  return {
    ...result,
    targetCount: targets.length,
  }
}

function evaluateInTarget<T>(webSocketDebuggerUrl: string, expression: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketDebuggerUrl)
    const timer = setTimeout(() => {
      socket.close()
      reject(new Error("CDP read-only evaluation timed out."))
    }, 5000)

    socket.addEventListener("open", () => {
      socket.send(
        JSON.stringify({
          id: 1,
          method: "Runtime.evaluate",
          params: { expression, returnByValue: true },
        }),
      )
    })
    socket.addEventListener("message", (event) => {
      clearTimeout(timer)
      socket.close()
      const message = JSON.parse(String(event.data)) as CdpResponse<{
        result?: { value?: T }
      }>
      if (message.error) {
        reject(new Error(message.error.message ?? "CDP evaluation failed."))
        return
      }
      resolve(message.result?.result?.value as T)
    })
    socket.addEventListener("error", () => {
      clearTimeout(timer)
      reject(new Error("CDP socket error."))
    })
  })
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exit(1)
})
