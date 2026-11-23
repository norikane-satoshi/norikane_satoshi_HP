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
export class DailyQuotaError extends Error {
  constructor() { super('Translation daily quota exhausted'); this.name = 'DailyQuotaError' }
}
export const modelCooldownKey = `public-i18n:model:${TRANSLATION_MODEL}:cooldown`

export function validateTranslation(source: string[], output: unknown): asserts output is string[] {
  if (!Array.isArray(output) || output.length !== source.length) throw new Error(`Translation segment count mismatch: expected ${source.length}, received ${Array.isArray(output) ? output.length : 'non-array'}`)
  for (let i = 0; i < source.length; i++) {
    if (typeof output[i] !== 'string' || !output[i].trim() || !validMarkers(source[i], output[i])) throw new Error(`Invalid translation segment at index ${i}`)
    const markers = (text: string) => text.match(/\[\[(?:diagram|visual):[^\]]+\]\]/g) ?? []
    if (JSON.stringify(markers(source[i])) !== JSON.stringify(markers(output[i]))) throw new Error('Invalid diagram marker')
  }
}

export async function generateTranslation(source: SourceDocument, locale: Locale, store: TranslationStore, translate: Translator, version = TRANSLATION_VERSION) {
  const key = documentKey(source, locale)
  const fingerprint = createHash('sha256').update(JSON.stringify([version, source.segments])).digest('hex')
  const retryKey = `${key}:${fingerprint}:cooldown`
  if (await store.get(modelCooldownKey) || await store.get(retryKey)) return
  const token = randomUUID()
  const capacityKey = `public-i18n:model:${TRANSLATION_MODEL}:lock`
  if (!await store.lock(capacityKey, token, 360)) return
  try {
    if (await store.get(modelCooldownKey)) return
    const shared = await store.get<Dictionary>(segmentKey(locale, version)) ?? {}
    const missing = [...new Set(source.segments)].filter(text => !shared[text])
    const previous = await store.get<TranslationRecord>(key)
    if (!missing.length && previous?.version === version && source.segments.every(text => previous.dictionary[text])) return
    if (missing.length) {
      const draft = await translate(missing, locale, undefined, source.segments)
      validateTranslation(missing, draft)
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
    await store.set(error instanceof DailyQuotaError ? modelCooldownKey : retryKey, true, error instanceof DailyQuotaError ? 86400 : 300)
    console.error('[PUBLIC_I18N_GENERATION_FAILED]', { path: source.path, locale, reason: error instanceof Error && /^(Translation |Invalid |Incomplete )/.test(error.message) ? error.message : error instanceof Error ? error.name : 'Error' })
  } finally {
    await store.unlock(capacityKey, token)
  }
}

export const geminiTranslate: Translator = async (segments, locale, draft, context) => {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new Error('Missing Gemini configuration')
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${TRANSLATION_MODEL}:generateContent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    signal: AbortSignal.timeout(145000),
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: TRANSLATION_INSTRUCTIONS }] },
      contents: [{ role: 'user', parts: [{ text: JSON.stringify({ language: locale, documentContext: context ?? segments, source: segments,
        ...(draft ? { draft, task: 'Review the requested segments against the entire Japanese documentContext. Correct mistranslations, omissions, unnatural phrasing, terminology and marker placement. Return the complete corrected translation array.' } : { task: 'Translate only the source segments, using the complete documentContext for context. Do not return unchanged context segments.' }),
      }) }] }],
      generationConfig: { responseMimeType: 'application/json', responseJsonSchema: { type: 'array', items: { type: 'string' }, minItems: segments.length, maxItems: segments.length }, maxOutputTokens: 65536, thinkingConfig: { thinkingLevel: 'high' } },
    }),
  })
  if (!response.ok) {
    const failure = await response.json().catch(() => ({}))
    console.error('[PUBLIC_I18N_PROVIDER_ERROR]', { status: response.status, model: TRANSLATION_MODEL,
      quota: failure.error?.details?.flatMap((detail: { violations?: { quotaMetric?: string; quotaId?: string; quotaValue?: string }[] }) =>
        detail.violations?.map(({ quotaMetric, quotaId, quotaValue }) => ({ quotaMetric, quotaId, quotaValue })) ?? []),
    })
    if (response.status === 429 && failure.error?.details?.some((detail: { violations?: { quotaId?: string }[] }) => detail.violations?.some(v => v.quotaId?.includes('PerDay')))) throw new DailyQuotaError()
    throw new Error('Translation provider failed')
  }
  const body = await response.json()
  const candidate = body.candidates?.[0]
  if (candidate?.finishReason !== 'STOP') throw new Error('Incomplete translation')
  const text = candidate.content?.parts?.filter((part: { thought?: boolean }) => !part.thought).map((part: { text?: string }) => part.text ?? '').join('')
  const output: unknown = JSON.parse(text)
  validateTranslation(segments, output)
  return output
}
