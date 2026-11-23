import { describe, expect, it, vi } from 'vitest'
import Link from 'next/link'
import { renderToStaticMarkup } from 'react-dom/server'
import { collectTree, translateTree } from '@/lib/i18n/tree'
import { isPublicPath, languageAlternates, localizeHref, preferredLanguage } from '@/lib/i18n/locales'
import { documentKey, generateTranslation, validateTranslation, type TranslationStore } from '@/lib/i18n/service'

class MemoryStore implements TranslationStore {
  values = new Map<string, unknown>()
  async get<T>(key: string) { return (this.values.get(key) ?? null) as T | null }
  async set(key: string, value: unknown) { this.values.set(key, value) }
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
  it('deduplicates concurrent generation, reviews before publishing, and invalidates changed Japanese', async () => {
    const store = new MemoryStore()
    const source = { path: '/', segments: ['本文'] }
    const translate = vi.fn(async (_text, _locale, draft) => { await Promise.resolve(); return draft ? ['Reviewed'] : ['Draft'] })
    await Promise.all(Array.from({ length: 8 }, () => generateTranslation(source, 'en', store, translate)))
    expect(translate).toHaveBeenCalledTimes(2)
    expect(await store.get(documentKey(source, 'en'))).toMatchObject({ dictionary: { 本文: 'Reviewed' }, calls: 2 })
    expect(documentKey(source, 'en')).not.toBe(documentKey({ ...source, segments: ['変更'] }, 'en'))
    await generateTranslation(source, 'en', store, translate)
    expect(translate).toHaveBeenCalledTimes(2)
    expect(() => documentKey({ path: '/booking', segments: ['任意'] }, 'en')).toThrow()
  })
})
