import { SITE_URL } from '@/lib/site-brand'

export const LOCALES = ['en', 'ko', 'zh-Hans', 'zh-Hant', 'es', 'fr', 'de', 'pt'] as const
export type Locale = (typeof LOCALES)[number]
export type Language = Locale | 'ja'
export const LANGUAGE_LABELS: Record<Language, string> = {
  ja: '日本語', en: 'English', ko: '한국어', 'zh-Hans': '简体中文', 'zh-Hant': '繁體中文',
  es: 'Español', fr: 'Français', de: 'Deutsch', pt: 'Português',
}
export const LANGUAGE_COOKIE = 'site_language'
export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value)
}
export function isLanguage(value: unknown): value is Language { return value === 'ja' || isLocale(value) }
export function isPublicPath(path: string) {
  return path === '/' || path === '/privacy' || path === '/terms' || /^\/notes\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(path)
}
export function localizedPath(path: string, locale: Language) {
  return locale === 'ja' ? path : `/${locale}${path === '/' ? '' : path}`
}
export function languageAlternates(path: string) {
  return Object.fromEntries([...(['ja', ...LOCALES] as Language[]).map((locale) =>
    [locale, new URL(localizedPath(path, locale), SITE_URL).href]),
  ['x-default', new URL(localizedPath(path, 'en'), SITE_URL).href]])
}
export function localizeHref(href: string, locale: Language) {
  if (locale === 'ja' || (!href.startsWith('/') && !href.startsWith(`${SITE_URL}/`)) || href.startsWith('//')) return href
  const url = new URL(href, SITE_URL)
  if (url.origin !== SITE_URL || !isPublicPath(url.pathname)) return href
  return localizedPath(url.pathname, locale) + url.search + url.hash
}
export function preferredLanguage(header: string | null): Language | null {
  if (!header) return null
  const parts = header.split(',').map((part, order) => {
    const [tag, ...params] = part.trim().split(';')
    const raw = params.find((p) => p.trim().startsWith('q='))?.trim().slice(2)
    return { tag: tag.toLowerCase(), q: raw === undefined ? 1 : Number(raw), order }
  }).filter(({ q }) => Number.isFinite(q) && q > 0 && q <= 1)
  if (parts.some(({ tag }) => /^ja(?:-|$)/.test(tag))) return 'ja'
  parts.sort((a, b) => b.q - a.q || a.order - b.order)
  const tag = parts[0]?.tag
  if (!tag) return null
  if (/^zh(?:-|$)/.test(tag)) return /(?:hant|tw|hk|mo)/.test(tag) ? 'zh-Hant' : 'zh-Hans'
  const base = tag.split('-')[0]
  return isLocale(base) ? base : 'en'
}
