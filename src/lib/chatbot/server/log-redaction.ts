const secretAssignmentPattern = /\b(api[_-]?key|token|secret)\s*[:=]\s*([^\s,;]+)/giu
const knownSecretPattern = /\b(?:sk-[A-Za-z0-9_-]{8,}|xox[baprs]-[A-Za-z0-9-]{8,})\b/g
const phonePattern = /(?:\+?\d[\d\s().-]{8,}\d)/g

export function redactForChatbotLog(value: string): string {
  return value
    .replace(secretAssignmentPattern, "$1=[secret]")
    .replace(knownSecretPattern, "[secret]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+/giu, "[email]")
    .replace(phonePattern, "[phone]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240)
}
