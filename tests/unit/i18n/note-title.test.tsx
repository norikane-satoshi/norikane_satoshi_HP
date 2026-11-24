import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import { generateMetadata } from '@/app/i18n/[locale]/[[...path]]/page'
import { getLocalizedDocument } from '@/lib/i18n/documents'
import { readTranslation } from '@/lib/i18n/service'
import { SITE_BRAND_NAME_EN } from '@/lib/site-brand'

vi.mock('server-only', () => ({}))
vi.mock('@/app/(ja)/page', () => ({ default: () => null }))
vi.mock('@/app/(ja)/privacy/page', () => ({ default: () => null }))
vi.mock('@/app/(ja)/terms/page', () => ({ default: () => null }))
vi.mock('@/app/(ja)/notes/[slug]/page', () => ({ default: () => <h1>ノートの見出し</h1> }))
vi.mock('@/lib/notion/server/fetch-note', () => ({
  getPublishedNoteBySlug: async () => ({ title: 'ノートの見出し', blocks: [] }),
}))
vi.mock('@/lib/i18n/redis', () => ({ translationStore: () => ({}) }))
vi.mock('@/lib/i18n/service', () => ({ readTranslation: vi.fn() }))

it('uses the existing heading translation for all localized note titles', async () => {
  vi.mocked(readTranslation).mockResolvedValue({
    ready: true,
    missing: [],
    dictionary: {
      'ノートの見出し': 'Translated heading',
      'ノートの見出し | のりかね映像設計室': 'Old separately translated title',
    },
  })

  const document = await getLocalizedDocument('en', '/notes/correction')
  const metadata = await generateMetadata({ params: Promise.resolve({ locale: 'en', path: ['notes', 'correction'] }) })
  const title = `Translated heading | ${SITE_BRAND_NAME_EN}`

  expect(renderToStaticMarkup(document?.tree)).toBe('<h1>Translated heading</h1>')
  expect(metadata).toMatchObject({ title: { absolute: title }, openGraph: { title }, twitter: { title } })
  expect(vi.mocked(readTranslation).mock.calls[0][0].segments).not.toContain('ノートの見出し | のりかね映像設計室')
})

it('uses the displayed Japanese heading while an unpublished translation is incomplete', async () => {
  vi.mocked(readTranslation).mockResolvedValue({
    ready: false,
    missing: [],
    dictionary: { 'ノートの見出し': 'Translated heading' },
  })

  const document = await getLocalizedDocument('en', '/notes/correction')

  expect(renderToStaticMarkup(document?.tree)).toBe('<h1>ノートの見出し</h1>')
  expect(document?.title).toBe(`ノートの見出し | ${SITE_BRAND_NAME_EN}`)
})
