import type { BookingFormData, BookingSlot, BookingStep } from "@/lib/booking/form-schema"

const SESSION_DRAFT_KEY = "booking-draft-session"
const LOCAL_DRAFT_KEY_PREFIX = "booking-draft-"
const DRAFT_TTL_MS = 24 * 60 * 60 * 1000

export type BookingDraft = {
  formData: BookingFormData
  selectedSlot: BookingSlot | null
  selectedSlots?: BookingSlot[]
  step: BookingStep
  savedAt: number
}

type LoadSource = "session" | "local" | "any"

function canUseStorage(): boolean {
  return typeof window !== "undefined"
}

function localDraftKey(userId: string): string {
  return `${LOCAL_DRAFT_KEY_PREFIX}${userId}`
}

function parseDraft(value: string | null): BookingDraft | null {
  if (!value) return null

  try {
    const draft = JSON.parse(value) as Partial<BookingDraft>
    if (!draft.formData || typeof draft.savedAt !== "number") return null
    return draft as BookingDraft
  } catch {
    return null
  }
}

function isExpired(draft: BookingDraft): boolean {
  return Date.now() - draft.savedAt > DRAFT_TTL_MS
}

export function saveDraft(userId: string, draft: Omit<BookingDraft, "savedAt">): void {
  if (!canUseStorage()) return

  const payload: BookingDraft = {
    ...draft,
    savedAt: Date.now(),
  }
  const serialized = JSON.stringify(payload)
  window.sessionStorage.setItem(SESSION_DRAFT_KEY, serialized)
  window.localStorage.setItem(localDraftKey(userId), serialized)
}

export function loadDraft(userId: string, source: LoadSource = "any"): BookingDraft | null {
  if (!canUseStorage()) return null

  if (source === "session" || source === "any") {
    const sessionDraft = parseDraft(window.sessionStorage.getItem(SESSION_DRAFT_KEY))
    if (sessionDraft) return sessionDraft
  }

  if (source === "local" || source === "any") {
    const key = localDraftKey(userId)
    const localDraft = parseDraft(window.localStorage.getItem(key))
    if (!localDraft) return null
    if (isExpired(localDraft)) {
      window.localStorage.removeItem(key)
      return null
    }
    return localDraft
  }

  return null
}

export function clearDraft(userId: string): void {
  if (!canUseStorage()) return

  window.sessionStorage.removeItem(SESSION_DRAFT_KEY)
  window.localStorage.removeItem(localDraftKey(userId))
}

export function hasDraft(userId: string): boolean {
  return loadDraft(userId, "local") !== null
}
