import { describe, expect, it, vi } from 'vitest'
import Link from 'next/link'
import { renderToStaticMarkup } from 'react-dom/server'
import { collectTree, translateTree } from '@/lib/i18n/tree'
import { isPublicPath, languageAlternates, localizeHref, preferredLanguage } from '@/lib/i18n/locales'
import { geminiTranslate, DailyQuotaError, modelCooldownKey, readTranslation, segmentKey, documentKey, generateTranslation, validateTranslation, type TranslationStore } from '@/lib/i18n/service'

class MemoryStore implements TranslationStore {
  values = new Map<string, unknown>()
  expiries = new Map<string, number | undefined>()
  async get<T>(key: string) { return (this.values.get(key) ?? null) as T | null }
  async set(key: string, value: unknown, seconds?: number) { this.values.set(key, value); this.expiries.set(key, seconds) }
  async lock(key: string, value: string) { if (this.values.has(key)) return false; this.values.set(key, value); return true }
  async unlock(key: string, value: string) { if (this.values.get(key) === value) this.values.delete(key) }
}

describe('public translation boundaries', () => {
  it('moves source links and emphasis with their phrase and escapes hostile model text', () => {
    const source = <p>私は<Link href="/notes/correction"><strong>色を整える</strong></Link>仕事をしています。</p>
    const key = [...collectTree(source)][0]
    expect(key).toBe('私は⟦0⟧⟦1⟧色を整える⟦/1⟧⟦/0⟧仕事をしています。')
    const html = renderToStaticMarkup(translateTree(source, { [key]: 'My work is ⟦0⟧⟦1⟧color correction⟦/1⟧⟦/0⟧. <script>alert(1)</script>' }, 'en'))
    expect(html).toContain('<a href="/en/notes/correction"><strong>color correction</strong></a>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>')
  })
  it('translates dynamically prefixed labels without splitting prose into partial matches', () => {
    const dictionary = { 'NHK100周年記念ドラマ': 'NHK 100th Anniversary Drama' }
    expect(renderToStaticMarkup(translateTree(<p>{' / NHK100周年記念ドラマ'}</p>, dictionary, 'en'))).toBe('<p> / NHK 100th Anniversary Drama</p>')
    expect(renderToStaticMarkup(translateTree(<p>このNHK100周年記念ドラマを紹介</p>, dictionary, 'en'))).toBe('<p>このNHK100周年記念ドラマを紹介</p>')
  })
  it('preserves Japanese markup exactly and never changes unsafe or out-of-scope links', () => {
    const node = <p>本文<Link href="/booking">予約</Link></p>
    expect(renderToStaticMarkup(translateTree(node, {}, 'ja'))).toBe(renderToStaticMarkup(node))
    for (const href of ['/booking', '/en/booking', '//evil.test', 'https://evil.test/', '/api/chatbot']) expect(localizeHref(href, 'en')).toBe(href)
    expect(localizeHref('/#works', 'fr')).toBe('/fr#works')
    expect(isPublicPath('/booking')).toBe(false)
    expect(isPublicPath('/notes/a?new=1')).toBe(false)
  })
  it('rejects damaged marker trees and preserved diagram tokens', () => {
    expect(() => validateTranslation(['⟦0⟧文⟦/0⟧'], ['⟦0⟧text'])).toThrow()
    expect(() => validateTranslation(['[[diagram:gain]]'], ['[[diagram:other]]'])).toThrow()
  })
  it('negotiates only known languages and keeps Japanese for mixed preferences', () => {
    expect(preferredLanguage('fr-FR,fr;q=0.9')).toBe('fr')
    expect(preferredLanguage('ar-SA')).toBe('en')
    expect(preferredLanguage(null)).toBe(null)
    expect(preferredLanguage('en-US,ja;q=0.1')).toBe('ja')
    expect(preferredLanguage('zh-TW')).toBe('zh-Hant')
    expect(preferredLanguage('zh-CN')).toBe('zh-Hans')
    expect(preferredLanguage('ja;q=0,fr')).toBe('fr')
    expect(languageAlternates('/privacy').fr).toBe('https://norikane.studio/fr/privacy')
  })
  it('limits simultaneous documents across languages to one provider job', async () => {
    const store = new MemoryStore()
    const translate = vi.fn(async () => { await new Promise(resolve => setTimeout(resolve, 5)); return ['Translated'] })
    await Promise.all(['en', 'fr', 'ko'].map(locale => generateTranslation({ path: '/', segments: ['本文'] }, locale as 'en' | 'fr' | 'ko', store, translate)))
    expect(translate).toHaveBeenCalledTimes(2)
    await generateTranslation({ path: '/', segments: ['本文'] }, 'fr', store, translate)
    expect(translate).toHaveBeenCalledTimes(4)
  })
  it('deduplicates concurrent generation and reviews before publishing', async () => {
    const store = new MemoryStore()
    const source = { path: '/', segments: ['本文'] }
    const translate = vi.fn(async (_text, _locale, draft) => { await Promise.resolve(); return draft ? ['Reviewed'] : ['Draft'] })
    await Promise.all(Array.from({ length: 8 }, () => generateTranslation(source, 'en', store, translate)))
    expect(translate).toHaveBeenCalledTimes(2)
    expect(await store.get(documentKey(source, 'en'))).toMatchObject({ dictionary: { 本文: 'Reviewed' }, calls: 2 })
    expect(documentKey(source, 'en')).toBe(documentKey({ ...source, segments: ['変更'] }, 'en'))
    await generateTranslation(source, 'en', store, translate)
    expect(translate).toHaveBeenCalledTimes(2)
    expect(() => documentKey({ path: '/booking', segments: ['任意'] }, 'en')).toThrow()
  })
})

describe('persistent segment translations', () => {
  it('reuses unchanged sentences across pages and supplies full context only for missing sentences', async () => {
    const store = new MemoryStore()
    const translate = vi.fn(async (texts: string[]) => texts.map(t => `EN:${t}`))
    await generateTranslation({ path: '/', segments: ['共通', '元の文'] }, 'en', store, translate)
    await generateTranslation({ path: '/privacy', segments: ['共通', '新しい文'] }, 'en', store, translate)
    expect(translate.mock.calls.map(c => c[0])).toEqual([['共通','元の文'],['共通','元の文'],['新しい文'],['新しい文']])
    expect(translate).toHaveBeenLastCalledWith(['新しい文'], 'en', ['EN:新しい文'], ['共通','新しい文'])
    expect((await readTranslation({ path: '/privacy', segments: ['共通'] }, 'en', store)).dictionary['共通']).toBe('EN:共通')
  })
  it('keeps a published document indexed during edits, showing Japanese only for new text', async () => {
    const store = new MemoryStore()
    const source = { path: '/', segments: ['既存', '直す文'] }
    await generateTranslation(source, 'en', store, async texts => texts.map(t => `EN:${t}`))
    const changed = { ...source, segments: ['既存', '修正後'] }
    const pending = await readTranslation(changed, 'en', store)
    expect(pending.ready).toBe(true)
    expect(pending.dictionary['既存']).toBe('EN:既存')
    expect(pending.dictionary['修正後'] ?? '修正後').toBe('修正後')
    expect(pending.missing).toEqual(['修正後'])
    await generateTranslation(changed, 'en', store, async texts => texts.map(t => `NEW:${t}`))
    const updated = await readTranslation(changed, 'en', store)
    expect(updated.dictionary['既存']).toBe('EN:既存')
    expect(updated.dictionary['修正後']).toBe('NEW:修正後')
  })
  it('stores active translations and document snapshots without an expiry', async () => {
    const store = new MemoryStore()
    const source = { path: '/', segments: ['本文'] }
    await generateTranslation(source, 'en', store, async () => ['Text'])
    for (const key of [documentKey(source, 'en'), segmentKey('en')]) {
      expect(store.values.has(key)).toBe(true)
      expect(store.expiries.has(key)).toBe(true)
      expect(store.expiries.get(key)).toBeUndefined()
    }
  })
  it('serves the previous version until the explicitly requested version completes, including failures', async () => {
    const store = new MemoryStore()
    const source = { path: '/', segments: ['本文'] }
    await generateTranslation(source, 'en', store, async () => ['Old'], 1)
    expect(await readTranslation(source, 'en', store, 2)).toMatchObject({ ready: true, dictionary: { 本文: 'Old' }, missing: ['本文'] })
    const failed = new MemoryStore()
    failed.values = new Map(store.values)
    await generateTranslation(source, 'en', failed, async () => { throw new Error('Unavailable') }, 2)
    expect(await readTranslation(source, 'en', failed, 2)).toMatchObject({ ready: true, dictionary: { 本文: 'Old' } })
    await generateTranslation(source, 'en', store, async () => ['New'], 2)
    expect(await readTranslation(source, 'en', store, 2)).toMatchObject({ ready: true, dictionary: { 本文: 'New' }, missing: [] })
  })
  it('backs off all documents and languages for one day on a daily model quota failure', async () => {
    const store = new MemoryStore()
    const translate = vi.fn(async () => { throw new DailyQuotaError() })
    await generateTranslation({ path: '/', segments: ['本文'] }, 'en', store, translate)
    await generateTranslation({ path: '/terms', segments: ['別文'] }, 'fr', store, translate)
    expect(translate).toHaveBeenCalledTimes(1)
    expect(store.expiries.get(modelCooldownKey)).toBe(86400)
  })
})

it('recognizes provider PerDay quotas without treating per-minute throttling as daily exhaustion', async () => {
  const original = process.env.GEMINI_API_KEY
  process.env.GEMINI_API_KEY = 'unit-test-only'
  try {
    for (const [quotaId, daily] of [['GenerateRequestsPerDayPerProjectPerModel-FreeTier', true], ['GenerateRequestsPerMinute', false]] as const) {
      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 429, json: async () => ({ error: { details: [{ violations: [{ quotaId }] }] } }) })))
      const error = await geminiTranslate(['本文'], 'en').catch(error => error)
      expect(error instanceof DailyQuotaError).toBe(daily)
    }
  } finally {
    vi.unstubAllGlobals()
    if (original === undefined) delete process.env.GEMINI_API_KEY
    else process.env.GEMINI_API_KEY = original
  }
})

it('stops translation after HTTP 402 across pages and locales without reading the error body', async () => {
  const store = new MemoryStore()
  const source = { path: '/', segments: ['本文'] }
  const response = new Response('private provider details', { status: 402 })
  const fetch = vi.fn(async () => response)
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.stubEnv('GEMINI_API_KEY', 'unit-test-only')
  vi.stubGlobal('fetch', fetch)
  try {
    await generateTranslation(source, 'en', store, geminiTranslate)
    await generateTranslation(source, 'en', store, geminiTranslate)
    await generateTranslation({ path: '/terms', segments: ['別文'] }, 'fr', store, geminiTranslate)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(response.bodyUsed).toBe(false)
    expect(store.expiries.get(modelCooldownKey)).toBe(86400)
    expect(await store.get(documentKey(source, 'en'))).toBeNull()
    expect(log.mock.calls).toEqual([['[PUBLIC_I18N_GENERATION_FAILED]', { path: '/', locale: 'en', reason: 'PrepaidCreditsError' }]])
  } finally {
    log.mockRestore()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  }
})

it('keeps provider timeouts local to the failed document and logs only the reason', async () => {
  const store = new MemoryStore()
  const source = { path: '/notes/correction', segments: ['本文'] }
  const timeout = vi.fn(async () => { throw new DOMException('private network details', 'TimeoutError') })
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    await generateTranslation(source, 'en', store, timeout)
    await generateTranslation(source, 'en', store, timeout)
    await generateTranslation({ path: '/terms', segments: ['別文'] }, 'fr', store, async () => ['Texte'])

    expect(timeout).toHaveBeenCalledTimes(1)
    expect(await store.get(modelCooldownKey)).toBeNull()
    expect(await store.get(documentKey({ path: '/terms', segments: ['別文'] }, 'fr'))).toMatchObject({ dictionary: { 別文: 'Texte' } })
    expect(log.mock.calls).toEqual([['[PUBLIC_I18N_GENERATION_FAILED]', { path: source.path, locale: 'en', reason: 'TimeoutError' }]])
  } finally {
    log.mockRestore()
  }
})

it('retains publication after a page initially uses only shared translations', async () => {
  const store = new MemoryStore()
  await generateTranslation({ path: '/', segments: ['共通'] }, 'en', store, async () => ['Shared'])
  expect((await readTranslation({ path: '/terms', segments: ['共通'] }, 'en', store)).ready).toBe(true)
  expect(await readTranslation({ path: '/terms', segments: ['共通', '追加'] }, 'en', store)).toMatchObject({ ready: true, dictionary: { 共通: 'Shared' }, missing: ['追加'] })
})
