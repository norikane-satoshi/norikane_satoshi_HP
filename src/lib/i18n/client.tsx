'use client'

import { createContext, useContext, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { LANGUAGE_COOKIE, LANGUAGE_LABELS, LOCALES, isLanguage, isLocale, isPublicPath, localizedPath, type Language } from './locales'
import { translateTree, type Dictionary } from './tree'

const TranslationContext = createContext<{ locale: Language; dictionary: Dictionary }>({ locale: 'ja', dictionary: {} })
export const TranslationProvider = TranslationContext.Provider

export function TranslationBoundary({ children }: { children: ReactNode; i18nBoundary?: boolean }) {
  const { locale, dictionary } = useContext(TranslationContext)
  return translateTree(children, dictionary, locale)
}

export function LanguageLinks() {
  const pathname = usePathname() || '/'
  const parts = pathname.split('/')
  const current: Language = isLocale(parts[1]) ? parts[1] : 'ja'
  const path = current === 'ja' ? pathname : '/' + parts.slice(2).join('/')
  if (!isPublicPath(path)) return null
  return <nav aria-label="Language" className="mb-12 mt-4 flex flex-wrap justify-center gap-x-4 gap-y-2 text-xs text-hp-muted md:mb-0">
    {(['ja', ...LOCALES] as Language[]).map((locale) => <a key={locale} href={localizedPath(path, locale)} onClick={() => rememberLanguage(locale)} lang={locale} hrefLang={locale} aria-current={locale === current ? 'page' : undefined} className="hover:underline">{LANGUAGE_LABELS[locale]}</a>)}
  </nav>
}

export function rememberLanguage(language: Language) {
  if (isLanguage(language)) document.cookie = `${LANGUAGE_COOKIE}=${language}; Path=/; Max-Age=31536000; Secure; SameSite=Lax`
}
export function OriginalLink({ path, children }: { path: string; children: ReactNode }) {
  return <a href={path} onClick={() => rememberLanguage('ja')} hrefLang="ja" lang="ja" className="underline underline-offset-4">{children}</a>
}
