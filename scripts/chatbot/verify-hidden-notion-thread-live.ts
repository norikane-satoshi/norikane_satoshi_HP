import { randomUUID } from "node:crypto"

import { config as loadDotenv } from "dotenv"

import {
  ChatbotLlmError,
  type ChatbotLlmRequest,
  type ChatbotLlmResponse,
} from "@/lib/chatbot/server/llm-client"
import { createTier1HostedChromeNotionAiClient } from "@/lib/chatbot/server/llm-clients/tier1-hosted-chrome-notion-ai"

loadDotenv({ path: ".env.local", override: false, quiet: true })
loadDotenv({ path: ".env", override: false, quiet: true })

function request(conversationId: string, messages: ChatbotLlmRequest["messages"]): ChatbotLlmRequest {
  return {
    requestId: `live-hidden-thread-${randomUUID()}`,
    conversationId,
    systemPrompt: [
      "これはHPチャットボットの隔離スレッド検証です。",
      "最終出力は必ず <customer_reply> と </customer_reply> の内側だけに、お客様へ表示してよい本文を書いてください。",
      "タグ外には何も書かず、指定された検証識別子は省略・翻訳せずそのまま返してください。",
    ].join("\n"),
    messages,
    latestUserMessage: messages.at(-1)?.content,
    conversationState: {
      hasFinalMedium: false,
      hasJobKind: false,
      hasAdditionalWork: false,
      hasDocumentaryAttachments: false,
      hasWorkSite: false,
      hasReferenceUrls: false,
      hasContactEmail: false,
      hasDesiredSchedule: false,
      turnCount: messages.filter((message) => message.role === "user").length,
    },
    jobContext: { documentaryAttachment: { kind: "none" } } as ChatbotLlmRequest["jobContext"],
  }
}

function client() {
  return createTier1HostedChromeNotionAiClient()
}

function conversationThread(response: ChatbotLlmResponse): Record<string, unknown> {
  const value = response.diagnostics?.conversationThread
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("missing_safe_conversation_thread_diagnostics")
  }
  return value as Record<string, unknown>
}

function assertHiddenThread(diagnostic: Record<string, unknown>): void {
  if (
    diagnostic.visibilityStatus !== "hidden" ||
    diagnostic.alive !== false ||
    diagnostic.hiddenFromChatList !== true ||
    diagnostic.hideVerificationResult !== "verified" ||
    diagnostic.postHideInferenceVerified !== true
  ) {
    throw new Error("hidden_thread_contract_failed")
  }
  if (typeof diagnostic.threadIdHash !== "string" || !/^[0-9a-f]{12}$/.test(diagnostic.threadIdHash)) {
    throw new Error("unsafe_or_missing_thread_hash")
  }
}

function containsCanary(text: string, canary: string): boolean {
  const normalize = (value: string) => value.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, "")
  return normalize(text).includes(normalize(canary))
}

async function main(): Promise<void> {
  const runId = randomUUID()
  const conversationA = `live-a-${runId}`
  const conversationB = `live-b-${runId}`
  const canaryA = `ALPHA-${randomUUID().slice(0, 8)}`
  const canaryB = `BRAVO-${randomUUID().slice(0, 8)}`
  const firstMessages: ChatbotLlmRequest["messages"] = [
    { role: "user", content: `この会話専用の検証識別子 ${canaryA} をそのまま返してください。` },
  ]
  const first = await client().generate(request(conversationA, firstMessages))
  const firstDiagnostic = conversationThread(first)
  assertHiddenThread(firstDiagnostic)

  const secondMessages: ChatbotLlmRequest["messages"] = [
    ...firstMessages,
    { role: "assistant", content: first.displayEnvelope.displayText },
    { role: "user", content: `同じ会話の識別子 ${canaryA} をもう一度そのまま返してください。` },
  ]
  const second = await client().generate(request(conversationA, secondMessages))
  const secondDiagnostic = conversationThread(second)
  assertHiddenThread(secondDiagnostic)

  const separate = await client().generate(
    request(conversationB, [
      {
        role: "user",
        content: `この会話専用の検証識別子 ${canaryB} だけをそのまま返してください。他の識別子は返さないでください。`,
      },
    ]),
  )
  const separateDiagnostic = conversationThread(separate)
  assertHiddenThread(separateDiagnostic)

  const firstHash = String(firstDiagnostic.threadIdHash)
  const secondHash = String(secondDiagnostic.threadIdHash)
  const separateHash = String(separateDiagnostic.threadIdHash)
  const result = {
    ok: true,
    tier: first.tier,
    firstThread: {
      mode: firstDiagnostic.mode,
      threadIdHash: firstHash,
      hidden: firstDiagnostic.hiddenFromChatList,
      postHideInferenceVerified: firstDiagnostic.postHideInferenceVerified,
    },
    sameConversationReuse: {
      mode: secondDiagnostic.mode,
      sameThreadHash: firstHash === secondHash,
      canaryObserved: containsCanary(second.displayEnvelope.displayText, canaryA),
    },
    separateConversation: {
      mode: separateDiagnostic.mode,
      distinctThreadHash: separateHash !== firstHash,
      ownCanaryObserved: containsCanary(separate.displayEnvelope.displayText, canaryB),
      otherCanaryAbsent: !containsCanary(separate.displayEnvelope.displayText, canaryA),
    },
  }
  const failedChecks = [
    !result.sameConversationReuse.sameThreadHash ? "same-conversation-thread-reuse" : undefined,
    !result.sameConversationReuse.canaryObserved ? "same-conversation-canary" : undefined,
    !result.separateConversation.distinctThreadHash ? "separate-conversation-thread" : undefined,
    !result.separateConversation.ownCanaryObserved ? "separate-conversation-own-canary" : undefined,
    !result.separateConversation.otherCanaryAbsent ? "cross-conversation-canary-absence" : undefined,
  ].filter((value): value is string => Boolean(value))
  if (failedChecks.length > 0) {
    throw new Error(`live_hidden_thread_verification_failed:${failedChecks.join(",")}`)
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

main().catch((error: unknown) => {
  const cause = error instanceof ChatbotLlmError && error.cause && typeof error.cause === "object"
    ? error.cause as Record<string, unknown>
    : undefined
  const safeCode = (value: unknown): string | undefined =>
    typeof value === "string" && /^[a-z0-9][a-z0-9_.:-]{0,119}$/i.test(value) ? value : undefined
  const lifecycleHttpStatus = typeof cause?.lifecycleHttpStatus === "number" &&
    Number.isInteger(cause.lifecycleHttpStatus) &&
    cause.lifecycleHttpStatus >= 100 &&
    cause.lifecycleHttpStatus <= 599
    ? cause.lifecycleHttpStatus
    : undefined
  const inferenceFailureKind = error instanceof ChatbotLlmError && error.code === "invalid-output"
    ? error.message.includes("response text could not be extracted")
      ? "response-text-not-extracted"
      : error.message.includes("empty NDJSON stream")
        ? "empty-ndjson-stream"
        : error.message.includes("service error")
          ? "notion-service-error"
          : error.message.includes("Column size exceeded")
            ? "thread-capacity-exceeded"
            : error.message.includes("denied chatbot model")
              ? "denied-model"
              : "other-invalid-output"
    : undefined
  const nestedMessage = error instanceof ChatbotLlmError && error.cause instanceof Error
    ? error.cause.message
    : undefined
  const diagnosticMessage = nestedMessage ?? (error instanceof Error ? error.message : "")
  const inferenceHttpStatusMatch = diagnosticMessage
    ? diagnosticMessage.match(/Notion AI request returned (\d{3})\b/)
    : undefined
  const inferenceHttpStatus = inferenceHttpStatusMatch
    ? Number(inferenceHttpStatusMatch[1])
    : undefined
  const unknownFailureKind = error instanceof ChatbotLlmError && error.code === "unknown"
    ? inferenceHttpStatus
      ? "inference-http-error"
      : diagnosticMessage.includes("page evaluation raised an exception")
        ? "page-evaluation-exception"
        : diagnosticMessage.toLowerCase().includes("timeout")
          ? "timeout"
          : diagnosticMessage.includes("did not return a result")
            ? "missing-result"
            : "other-unknown"
    : undefined
  const verifierFailureKind = !(error instanceof ChatbotLlmError) && error instanceof Error
    ? error.message === "missing_safe_conversation_thread_diagnostics"
      ? "missing-safe-diagnostics"
      : error.message === "hidden_thread_contract_failed"
        ? "hidden-thread-contract"
        : error.message === "unsafe_or_missing_thread_hash"
          ? "unsafe-or-missing-thread-hash"
          : error.message.startsWith("live_hidden_thread_verification_failed")
            ? "canary-or-isolation-mismatch"
            : "other-verifier-error"
    : undefined
  const failedChecks = verifierFailureKind === "canary-or-isolation-mismatch" && error instanceof Error
    ? error.message
        .slice("live_hidden_thread_verification_failed:".length)
        .split(",")
        .filter((value) => [
          "same-conversation-thread-reuse",
          "same-conversation-canary",
          "separate-conversation-thread",
          "separate-conversation-own-canary",
          "cross-conversation-canary-absence",
        ].includes(value))
    : undefined
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: error instanceof ChatbotLlmError ? error.code : "unknown",
    lifecycleFailureCode: safeCode(cause?.lifecycleFailureCode),
    lifecycleStage: safeCode(cause?.lifecycleStage),
    lifecycleHttpStatus,
    inferenceFailureKind,
    inferenceHttpStatus,
    unknownFailureKind,
    verifierFailureKind,
    failedChecks,
  })}\n`)
  process.exitCode = 1
})
