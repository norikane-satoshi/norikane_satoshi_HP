import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getLocalizedDocument } from '@/lib/i18n/documents'
import { isLocale, isPublicPath, languageAlternates, localizedPath } from '@/lib/i18n/locales'
import { AUTO_TRANSLATION_NOTICE, LEGAL_NOTICE, ORIGINAL_LINK_LABEL } from '@/lib/i18n/instructions'
import { OriginalLink, TranslationProvider } from '@/lib/i18n/client'
import { SITE_URL } from '@/lib/site-brand'

export const revalidate = 60
// Redis uses no-store fetches; they must not opt this ISR route into dynamic rendering.
export const dynamic = 'force-static'
export function generateStaticParams() { return [] }
export const maxDuration = 300
type Props = { params: Promise<{ locale: string; path?: string[] }> }

async function documentFor({ params }: Props) {
  const { locale, path: parts = [] } = await params
  const path = '/' + parts.join('/')
  if (!isLocale(locale) || !isPublicPath(path)) notFound()
  const document = await getLocalizedDocument(locale, path)
  if (!document) notFound()
  return { locale, path, document }
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { locale, path, document } = await documentFor(props)
  const url = new URL(localizedPath(path, locale), SITE_URL).href
  return {
    title: { absolute: document.title }, description: document.description,
    alternates: { canonical: url, languages: languageAlternates(path) },
    robots: document.ready ? { index: true, follow: true } : { index: false, follow: true },
    openGraph: { title: document.title, description: document.description, url, locale: locale.replace('-', '_') },
    twitter: { title: document.title, description: document.description },
  }
}

export default async function LocalizedPage(props: Props) {
  const { locale, path, document } = await documentFor(props)
  const notice = path === '/privacy' || path === '/terms' ? LEGAL_NOTICE : AUTO_TRANSLATION_NOTICE
  return <TranslationProvider value={{ locale: document.ready ? locale : 'ja', dictionary: document.dictionary }}>
    {path !== '/' && <p className="hp-section-shell pt-6 text-xs text-hp-muted">
      {document.dictionary[notice] ?? notice}{' '}
      <OriginalLink path={path}>{document.dictionary[ORIGINAL_LINK_LABEL] ?? ORIGINAL_LINK_LABEL}</OriginalLink>
    </p>}
    {document.tree}
  </TranslationProvider>
}
