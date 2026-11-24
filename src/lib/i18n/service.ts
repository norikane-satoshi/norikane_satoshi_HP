import { createHash, randomUUID } from 'node:crypto'
import { TRANSLATION_INSTRUCTIONS, TRANSLATION_MODEL, TRANSLATION_VERSION } from './instructions'
import { isLocale, isPublicPath, type Locale } from './locales'
import { validMarkers, type Dictionary } from './tree'

export type SourceDocument = { path: string; segments: string[] }
export type TranslationRecord = { dictionary: Dictionary; model: string; calls: number; completedAt: string; version?: number }
export interface TranslationStore {
  get<T>(key: string): Promise<T | null>
  set(key: string, value: unknown, seconds?: number): Promise<void>
  lock(key: string, token: string, seconds: number): Promise<boolean>
  unlock(key: string, token: string): Promise<void>
}
export type Translator = (segments: string[], locale: Locale, draft?: string[], context?: string[]) => Promise<string[]>

export function documentKey(source: SourceDocument, locale: Locale) {
  if (!isLocale(locale) || !(isPublicPath(source.path) || source.path === '@shell')) throw new Error('Invalid public translation document')
  return `public-i18n:v2:document:${locale}:${source.path}`
}
export function segmentKey(locale: Locale, version = TRANSLATION_VERSION) {
  return `public-i18n:v2:segments:${locale}:${version}`
}
export async function readTranslation(source: SourceDocument, locale: Locale, store: TranslationStore, version = TRANSLATION_VERSION) {
  const key = documentKey(source, locale)
  const [previous, shared] = await Promise.all([
    store.get<TranslationRecord>(key), store.get<Dictionary>(segmentKey(locale, version)),
  ])
  const missing = source.segments.filter(text => !shared?.[text])
  const available = missing.length && previous?.version !== version
    ? { ...shared, ...previous?.dictionary } : { ...previous?.dictionary, ...shared }
  const dictionary = Object.fromEntries(source.segments.filter(text => available[text]).map(text => [text, available[text]]))
  if (!missing.length && (!previous || previous.version !== version || source.segments.some(text => previous.dictionary[text] !== dictionary[text]))) {
    await store.set(key, { dictionary, version, model: TRANSLATION_MODEL, calls: 0, completedAt: new Date().toISOString() } satisfies TranslationRecord)
  }
  return { dictionary, ready: Boolean(previous) || missing.length === 0, missing }
}
class TranslationError extends Error {
  constructor(readonly reason: 'DailyQuotaError' | 'PrepaidCreditsError' | 'ProviderError' | 'InvalidTranslationError' | 'InvalidDiagramMarkerError' | 'IncompleteTranslationError') {
    super(reason)
  }
}
export class DailyQuotaError extends TranslationError {
  constructor() { super('DailyQuotaError') }
}
export class PrepaidCreditsError extends TranslationError {
  constructor() { super('PrepaidCreditsError') }
}
export const modelCooldownKey = `public-i18n:model:${TRANSLATION_MODEL}:cooldown`
const geminiRequestTimeoutMs = 260_000
const modelLockSeconds = 600

export function validateTranslation(source: string[], output: unknown): asserts output is string[] {
  if (!Array.isArray(output) || output.length !== source.length) throw new TranslationError('InvalidTranslationError')
  for (let i = 0; i < source.length; i++) {
    if (typeof output[i] !== 'string' || !output[i].trim() || !validMarkers(source[i], output[i])) throw new TranslationError('InvalidTranslationError')
    const markers = (text: string) => text.match(/\[\[(?:diagram|visual):[^\]]+\]\]/g) ?? []
    if (JSON.stringify(markers(source[i])) !== JSON.stringify(markers(output[i]))) throw new TranslationError('InvalidDiagramMarkerError')
  }
}

export async function generateTranslation(source: SourceDocument, locale: Locale, store: TranslationStore, translate: Translator, version = TRANSLATION_VERSION) {
  const key = documentKey(source, locale)
  const fingerprint = createHash('sha256').update(JSON.stringify([version, source.segments])).digest('hex')
  const retryKey = `${key}:${fingerprint}:cooldown`
  const retry = await store.get<{ failures: number; until: number }>(retryKey)
  if (await store.get(modelCooldownKey) || (retry && Date.now() < retry.until)) return
  const token = randomUUID()
  const capacityKey = `public-i18n:model:${TRANSLATION_MODEL}:lock`
  if (!await store.lock(capacityKey, token, modelLockSeconds)) return
  try {
    if (await store.get(modelCooldownKey)) return
    const shared = await store.get<Dictionary>(segmentKey(locale, version)) ?? {}
    const missing = [...new Set(source.segments)].filter(text => !shared[text])
    const previous = await store.get<TranslationRecord>(key)
    if (!missing.length && previous?.version === version && source.segments.every(text => previous.dictionary[text])) return
    if (missing.length) {
      console.info('[PUBLIC_I18N_REQUEST]', { path: source.path, locale, step: 'draft' })
      const draft = await translate(missing, locale, undefined, source.segments)
      validateTranslation(missing, draft)
      console.info('[PUBLIC_I18N_REQUEST]', { path: source.path, locale, step: 'review' })
      const reviewed = await translate(missing, locale, draft, source.segments)
      validateTranslation(missing, reviewed)
      missing.forEach((text, index) => { shared[text] = reviewed[index] })
      await store.set(segmentKey(locale, version), shared)
    }
    const record: TranslationRecord = {
      dictionary: Object.fromEntries(source.segments.map(text => [text, shared[text]])),
      model: TRANSLATION_MODEL, version, calls: missing.length ? 2 : 0, completedAt: new Date().toISOString(),
    }
    await store.set(key, record)
    console.info('[PUBLIC_I18N_COMPLETE]', { path: source.path, locale, model: TRANSLATION_MODEL, calls: record.calls })
  } catch (error) {
    const cooldown = error instanceof DailyQuotaError || error instanceof PrepaidCreditsError
    const reason = error instanceof TranslationError ? error.reason
      : error instanceof SyntaxError ? 'InvalidJson'
        : error instanceof DOMException && error.name === 'TimeoutError' ? 'TimeoutError' : 'Error'
    // The same source is retried after 5 min, 1 h, 12 h and 6 days, so a persistent failure costs at most five attempts a month.
    const failures = (retry?.failures ?? 0) + 1
    if (cooldown) await store.set(modelCooldownKey, true, 86400)
    else await store.set(retryKey, { failures, until: Date.now() + 300_000 * 12 ** (failures - 1) }, 30 * 86400)
    console.error('[PUBLIC_I18N_GENERATION_FAILED]', { path: source.path, locale, reason })
  } finally {
    await store.unlock(capacityKey, token)
  }
}

export const geminiTranslate: Translator = async (segments, locale, draft, context) => {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new Error('Missing Gemini configuration')
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${TRANSLATION_MODEL}:generateContent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    signal: AbortSignal.timeout(geminiRequestTimeoutMs),
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: TRANSLATION_INSTRUCTIONS }] },
      contents: [{ role: 'user', parts: [{ text: JSON.stringify({ language: locale, documentContext: context ?? segments, source: segments,
        ...(draft ? { draft, task: 'Review the requested segments against the entire Japanese documentContext. Correct mistranslations, omissions, unnatural phrasing, terminology and marker placement. Return the complete corrected translation array.' } : { task: 'Translate only the source segments, using the complete documentContext for context. Do not return unchanged context segments.' }),
      }) }] }],
      generationConfig: { responseMimeType: 'application/json', responseJsonSchema: { type: 'array', items: { type: 'string' }, minItems: segments.length, maxItems: segments.length }, maxOutputTokens: 65536, thinkingConfig: { thinkingLevel: 'high' } },
    }),
  })
  if (!response.ok) {
    if (response.status === 402) throw new PrepaidCreditsError()
    if (response.status === 429) {
      const failure = await response.json().catch(() => ({}))
      if (failure.error?.details?.some((detail: { violations?: { quotaId?: string }[] }) => detail.violations?.some(v => v.quotaId?.includes('PerDay')))) throw new DailyQuotaError()
    }
    throw new TranslationError('ProviderError')
  }
  const body = await response.json()
  const candidate = body.candidates?.[0]
  if (candidate?.finishReason !== 'STOP') throw new TranslationError('IncompleteTranslationError')
  const text = candidate.content?.parts?.filter((part: { thought?: boolean }) => !part.thought).map((part: { text?: string }) => part.text ?? '').join('')
  const output: unknown = JSON.parse(text)
  validateTranslation(segments, output)
  return output
}
