import type { ChatbotResponseTier, ChatbotTierAttemptDebug } from "./api"

const tierLabels: Record<ChatbotResponseTier, string> = {
  "tier-1-chrome-notion-ai": "Actual: Tier 1 local Notion AI / Chrome CDP",
  "tier-2-hosted-chrome-notion-ai": "Actual: Tier 2 VPS Notion AI hosted worker",
  "tier-3-ollama-deepseek": "Actual: Tier 3 local Ollama DeepSeek",
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

  const parts: string[] = []

  for (const tier of Object.keys(tierLabels) as ChatbotResponseTier[]) {
    const tierAttempts = attempts.filter((attempt) => attempt.tier === tier)
    if (tierAttempts.length === 0) continue

    const label = tierAttemptShortLabels[tier]
    const health = tierAttempts.find((attempt) => attempt.phase === "health-check")
    const generateErrors = tierAttempts.filter(
      (attempt) => attempt.phase === "generate" && attempt.outcome === "error",
    )
    const generateSuccess = tierAttempts.find(
      (attempt) => attempt.phase === "generate" && attempt.outcome === "success",
    )
    const retryCount = Math.max(
      Math.max(...tierAttempts.map((attempt) => attempt.attempt ?? 1)) - 1,
      0,
    )

    if (health) parts.push(`${label} health ${health.outcome}`)
    if (generateErrors.length > 0) {
      const errorCode = generateErrors.at(-1)?.errorCode ?? "error"
      parts.push(`${label} generate ${errorCode} x${generateErrors.length}`)
    } else if (generateSuccess) {
      parts.push(`${label} generate success`)
    }
    if (retryCount > 0) parts.push(`${label} retry ${retryCount}`)
  }

  return parts.length > 0 ? parts.join("; ") : undefined
}

const tierAttemptShortLabels: Record<ChatbotResponseTier, string> = {
  "tier-1-chrome-notion-ai": "Tier1",
  "tier-2-hosted-chrome-notion-ai": "Tier2 VPS",
  "tier-3-ollama-deepseek": "Tier3 Ollama",
  "tier-4-form-fallback": "Tier4 form",
}
