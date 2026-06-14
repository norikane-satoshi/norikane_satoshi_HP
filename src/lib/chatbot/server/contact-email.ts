const maxEmailLength = 254
const emailCandidatePattern = /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)+/gi

export function normalizeChatbotContactEmail(
  email: string | undefined,
): string | undefined {
  if (!email) return undefined

  const normalized = email.trim().toLowerCase()
  return isValidChatbotContactEmail(normalized) ? normalized : undefined
}

export function isValidChatbotContactEmail(email: string | undefined): boolean {
  if (!email) return false

  const normalized = email.trim()
  if (normalized.length === 0 || normalized.length > maxEmailLength) return false

  const atIndex = normalized.indexOf("@")
  if (atIndex <= 0 || atIndex !== normalized.lastIndexOf("@")) return false

  const localPart = normalized.slice(0, atIndex)
  const domain = normalized.slice(atIndex + 1).toLowerCase()
  if (!localPart || !domain || localPart.startsWith(".") || localPart.endsWith(".")) return false
  if (localPart.includes("..")) return false

  const labels = domain.split(".")
  if (labels.length < 2) return false
  if (labels.some((label) => !isValidDomainLabel(label))) return false

  const tld = labels.at(-1)
  return Boolean(tld && /^[a-z]{2,}$/.test(tld))
}

export function contactEmailConflictsWithLatestUserMessage(input: {
  contactEmail: string | undefined
  latestUserMessage: string | undefined
}): boolean {
  const normalized = normalizeChatbotContactEmail(input.contactEmail)
  if (!normalized || !input.latestUserMessage) return false

  return extractEmailCandidates(input.latestUserMessage).some((candidate) => {
    const candidateNormalized = candidate.toLowerCase()
    return (
      candidateNormalized.startsWith(`${normalized}.`) &&
      candidateNormalized !== normalized &&
      !isValidChatbotContactEmail(candidateNormalized)
    )
  })
}

function isValidDomainLabel(label: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)
}

function extractEmailCandidates(text: string): string[] {
  return text.match(emailCandidatePattern) ?? []
}
