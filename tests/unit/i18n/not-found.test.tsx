import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import LocalizedLayout from '@/app/i18n/[locale]/[[...path]]/layout'
import LocalizedNotFound from '@/app/i18n/[locale]/[[...path]]/not-found'
import LocalizedPage, { generateMetadata } from '@/app/i18n/[locale]/[[...path]]/page'
import GlobalNotFound from '@/app/global-not-found'
import { getLocalizedDocument, getLocalizedShell } from '@/lib/i18n/documents'

vi.mock('@/lib/i18n/documents', () => ({
  getLocalizedDocument: vi.fn(async () => null),
  getLocalizedShell: vi.fn(),
}))
vi.mock('@/lib/i18n/site-layout', () => ({
  default: ({ children, locale = 'ja' }: { children: React.ReactNode; locale?: string }) => (
    <html lang={locale}><body><header>NCS Grading</header><main>{children}</main><footer /></body></html>
  ),
}))

it('renders the global 404 branding for a missing localized note and raises the HTTP 404 fallback', async () => {
  const props = { params: Promise.resolve({ locale: 'en', path: ['notes', 'does-not-exist'] }) }
  await expect(LocalizedPage(props)).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' })
  await expect(generateMetadata(props)).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' })
  const html = renderToStaticMarkup(await LocalizedLayout({ ...props, children: <LocalizedNotFound /> }))
  expect(html).toBe(renderToStaticMarkup(<GlobalNotFound />))
  expect(getLocalizedDocument).toHaveBeenCalledWith('en', '/notes/does-not-exist')
  expect(getLocalizedShell).not.toHaveBeenCalled()
})
