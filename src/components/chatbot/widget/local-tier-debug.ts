import type { ChatbotResponseTier, ChatbotTierAttemptDebug } from "./api"

const tierLabels: Record<ChatbotResponseTier, string> = {
  "tier-1-chrome-notion-ai": "Actual: Tier 1 local Notion AI / Chrome CDP",
  "tier-2-ollama-deepseek": "Actual: staging Tier 2 local Ollama DeepSeek; planned Tier 3; VPS Tier 2 not installed",
  "tier-4-form-fallback": "Actual: Tier 4 form fallback",
}

export function isLocalChatbotTierDebugHostname(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1"
}

export function formatChatbotTierDebugLabel(tier: ChatbotResponseTier) {
  return `${tierLabels[tier]} (${tier})`
}

export function formatChatbotTierDebugDetails(
  attempts?: ReadonlyArray<ChatbotTierAttemptDebug>,
): string | undefined {
  if (!attempts || attempts.length === 0) return undefined

  const tier1Attempts = attempts.filter((attempt) => attempt.tier === "tier-1-chrome-notion-ai")
  const tier1Health = tier1Attempts.find((attempt) => attempt.phase === "health-check")
  const tier1GenerateErrors = tier1Attempts.filter(
    (attempt) => attempt.phase === "generate" && attempt.outcome === "error",
  )
  const retryCount = Math.max(tier1GenerateErrors.length - 1, 0)
  const parts: string[] = []

  if (tier1Health) {
    parts.push(`Tier1 health ${tier1Health.outcome}`)
  }
  if (tier1GenerateErrors.length > 0) {
    const errorCode = tier1GenerateErrors.at(-1)?.errorCode ?? "error"
    parts.push(`Tier1 generate ${errorCode} x${tier1GenerateErrors.length}`)
  }
  if (retryCount > 0) {
    parts.push(`retry ${retryCount}`)
  }

  return parts.length > 0 ? parts.join("; ") : undefined
}
