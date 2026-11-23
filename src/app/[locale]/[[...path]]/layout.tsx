import { notFound } from 'next/navigation'
import SiteLayout, { metadata } from '@/lib/i18n/site-layout'
import { getLocalizedDocument, getLocalizedShell } from '@/lib/i18n/documents'
import { isLocale, isPublicPath, localizedPath } from '@/lib/i18n/locales'
export { metadata }
export default async function LocalizedLayout({ children, params }: {
  children: React.ReactNode; params: Promise<{ locale: string; path?: string[] }>
}) {
  const { locale, path: parts = [] } = await params
  const path = '/' + parts.join('/')
  if (!isLocale(locale) || !isPublicPath(path)) notFound()
  const document = await getLocalizedDocument(locale, path)
  const shell = await getLocalizedShell(locale)
  return <SiteLayout locale={document.ready ? locale : 'ja'} dictionary={shell.dictionary} languagePath={localizedPath(path, locale)}>{children}</SiteLayout>
}
