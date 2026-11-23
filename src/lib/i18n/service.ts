import { createHash, randomUUID } from 'node:crypto'
import { TRANSLATION_INSTRUCTIONS, TRANSLATION_MODEL } from './instructions'
import { isLocale, isPublicPath, type Locale } from './locales'
import { validMarkers, type Dictionary } from './tree'

export type SourceDocument = { path: string; segments: string[] }
export type TranslationRecord = { dictionary: Dictionary; model: string; calls: number; completedAt: string }
export interface TranslationStore {
  get<T>(key: string): Promise<T | null>
  set(key: string, value: unknown, seconds: number): Promise<void>
  lock(key: string, token: string, seconds: number): Promise<boolean>
  unlock(key: string, token: string): Promise<void>
}
export type Translator = (segments: string[], locale: Locale, draft?: string[]) => Promise<string[]>

export function documentKey(source: SourceDocument, locale: Locale) {
  if (!isLocale(locale) || !isPublicPath(source.path)) throw new Error('Invalid public translation document')
  const hash = createHash('sha256').update(JSON.stringify([TRANSLATION_MODEL, TRANSLATION_INSTRUCTIONS, source.segments])).digest('hex')
  return `public-i18n:v1:${locale}:${source.path}:${hash}`
}

export function validateTranslation(source: string[], output: unknown): asserts output is string[] {
  if (!Array.isArray(output) || output.length !== source.length) throw new Error('Translation segment count mismatch')
  for (let i = 0; i < source.length; i++) {
    if (typeof output[i] !== 'string' || !output[i].trim() || !validMarkers(source[i], output[i])) throw new Error('Invalid translation segment')
    const markers = (text: string) => text.match(/\[\[(?:diagram|visual):[^\]]+\]\]/g) ?? []
    if (JSON.stringify(markers(source[i])) !== JSON.stringify(markers(output[i]))) throw new Error('Invalid diagram marker')
  }
}

export async function generateTranslation(source: SourceDocument, locale: Locale, store: TranslationStore, translate: Translator) {
  const key = documentKey(source, locale)
  if (await store.get(key) || await store.get(`${key}:cooldown`)) return
  const token = randomUUID()
  if (!await store.lock(`${key}:lock`, token, 360)) return
  try {
    if (await store.get(key)) return
    const draft = await translate(source.segments, locale)
    validateTranslation(source.segments, draft)
    const reviewed = await translate(source.segments, locale, draft)
    validateTranslation(source.segments, reviewed)
    const record: TranslationRecord = {
      dictionary: Object.fromEntries(source.segments.map((text, index) => [text, reviewed[index]])),
      model: TRANSLATION_MODEL, calls: 2, completedAt: new Date().toISOString(),
    }
    await store.set(key, record, 90 * 86400)
    console.info('[PUBLIC_I18N_COMPLETE]', { path: source.path, locale, model: TRANSLATION_MODEL, calls: 2 })
  } catch (error) {
    await store.set(`${key}:cooldown`, true, 300)
    console.error('[PUBLIC_I18N_GENERATION_FAILED]', { path: source.path, locale, errorName: error instanceof Error ? error.name : 'Error' })
  } finally {
    await store.unlock(`${key}:lock`, token)
  }
}

export const geminiTranslate: Translator = async (segments, locale, draft) => {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new Error('Missing Gemini configuration')
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${TRANSLATION_MODEL}:generateContent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    signal: AbortSignal.timeout(145000),
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: TRANSLATION_INSTRUCTIONS }] },
      contents: [{ role: 'user', parts: [{ text: JSON.stringify({ language: locale, source: segments,
        ...(draft ? { draft, task: 'Review the entire draft against the entire Japanese original. Correct mistranslations, omissions, unnatural phrasing, terminology and marker placement. Return the complete corrected translation array.' } : { task: 'Translate the complete document.' }),
      }) }] }],
      generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 65536, thinkingConfig: { thinkingLevel: 'high' } },
    }),
  })
  if (!response.ok) {
    console.error('[PUBLIC_I18N_PROVIDER_ERROR]', { status: response.status, model: TRANSLATION_MODEL })
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
