import type { ChatbotResponseTier } from "./api"

const tierLabels: Record<ChatbotResponseTier, string> = {
  "local-deterministic": "Local deterministic",
  "tier-1-chrome-notion-ai": "Tier 1 Notion AI",
  "tier-2-hosted-chrome-notion-ai": "Tier 2 Hosted Notion AI",
  "tier-3-ollama-deepseek": "Tier 3 Ollama DeepSeek",
  "tier-4-form-fallback": "Tier 4 form fallback",
}

export function isLocalChatbotTierDebugHostname(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1"
}

export function formatChatbotTierDebugLabel(tier: ChatbotResponseTier) {
  return `${tierLabels[tier]} (${tier})`
}
