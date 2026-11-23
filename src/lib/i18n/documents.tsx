import 'server-only'
import { cache, cloneElement, isValidElement, type ReactNode } from 'react'
import { after } from 'next/server'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import HomePage from '@/app/page'
import NotePage from '@/app/notes/[slug]/page'
import PrivacyPage, { metadata as privacyMetadata } from '@/app/privacy/page'
import TermsPage, { metadata as termsMetadata } from '@/app/terms/page'
import { getPublishedNoteBySlug } from '@/lib/notion/server/fetch-note'
import { extractNoteExcerpt } from '@/lib/notes/domain/excerpt'
import { BIOGRAPHY_CHAPTERS } from '@/components/hp/biography-data'
import { SITE_BRAND_NAME, SITE_COMPANY_NAME, SITE_TAGLINE, SITE_TITLE } from '@/lib/site-brand'
import { AUTO_TRANSLATION_NOTICE, LEGAL_NOTICE, ORIGINAL_LINK_LABEL } from './instructions'
import sourceFiles from './source.generated.json'
import { collectTree, translateTree, type Dictionary } from './tree'
import { documentKey, generateTranslation, geminiTranslate, type TranslationRecord } from './service'
import { translationStore } from './redis'
import { isLocale, isPublicPath, localizeHref, type Locale } from './locales'

type TreeProps = { children?: ReactNode; [key: string]: unknown }
async function resolveServerTree(node: ReactNode): Promise<ReactNode> {
  if (Array.isArray(node)) return Promise.all(node.map(resolveServerTree))
  if (!isValidElement<TreeProps>(node)) return node
  if (typeof node.type === 'function' && !('$$typeof' in node.type)) {
    const component = node.type as (props: TreeProps) => ReactNode | Promise<ReactNode>
    return resolveServerTree(await component(node.props))
  }
  if (!('children' in node.props)) return node
  return cloneElement(node, { children: await resolveServerTree(node.props.children) })
}

const jsonTextKeys = new Set(['name', 'legalName', 'description', 'headline', 'jobTitle', 'addressRegion', 'addressLocality'])
function jsonText(data: unknown, output: Set<string>, dictionary?: Dictionary, locale?: Locale, key = ''): unknown {
  if (typeof data === 'string') {
    if (jsonTextKeys.has(key)) { output.add(data); return dictionary?.[data] ?? data }
    if (key === 'inLanguage' && locale) return locale
    if (['url', 'mainEntityOfPage'].includes(key) && locale) return localizeHref(data, locale)
    return data
  }
  if (Array.isArray(data)) return data.map((value) => jsonText(value, output, dictionary, locale, key))
  if (data && typeof data === 'object') return Object.fromEntries([
    ...Object.entries(data).map(([key, value]) => [key, jsonText(value, output, dictionary, locale, key)]),
    ...(locale && '@type' in data ? [['inLanguage', locale]] : []),
  ])
  return data
}
function structuredTree(node: ReactNode, output: Set<string>, dictionary?: Dictionary, locale?: Locale): ReactNode {
  if (Array.isArray(node)) return node.map((child) => structuredTree(child, output, dictionary, locale))
  if (!isValidElement<TreeProps>(node)) return node
  if (node.type === 'script' && node.props.type === 'application/ld+json') {
    const raw = node.props.dangerouslySetInnerHTML as { __html: string }
    const data = jsonText(JSON.parse(raw.__html), output, dictionary, locale)
    return cloneElement(node, { dangerouslySetInnerHTML: { __html: JSON.stringify(data).replace(/</g, '\\u003c') } })
  }
  return 'children' in node.props ? cloneElement(node, { children: structuredTree(node.props.children, output, dictionary, locale) }) : node
}

export const getSourceDocument = cache(async (path: string) => {
  if (!isPublicPath(path)) notFound()
  let tree: ReactNode
  let title = SITE_TITLE
  let description = SITE_TAGLINE
  let noteText = ''
  if (path === '/') tree = await HomePage()
  else if (path === '/privacy' || path === '/terms') {
    const metadata = path === '/privacy' ? privacyMetadata : termsMetadata
    title = String(metadata.title)
    description = String(metadata.description)
    tree = path === '/privacy' ? PrivacyPage() : TermsPage()
  } else {
    const slug = path.slice('/notes/'.length)
    const note = await getPublishedNoteBySlug(slug)
    if (!note) notFound()
    title = `${note.title} | ${SITE_BRAND_NAME}`
    description = extractNoteExcerpt(note.blocks) || note.title
    noteText = JSON.stringify(note.blocks)
    tree = await NotePage({ params: Promise.resolve({ slug }) })
  }
  tree = await resolveServerTree(tree)
  const segments = collectTree(tree)
  structuredTree(tree, segments)
  for (const text of [title, description, SITE_COMPANY_NAME, `© 2026 ${SITE_COMPANY_NAME}. All rights reserved.`, 'プライバシーポリシー', '利用規約', AUTO_TRANSLATION_NOTICE, LEGAL_NOTICE, ORIGINAL_LINK_LABEL]) segments.add(text)
  for (const [file, strings] of Object.entries(sourceFiles)) {
    const relevant = file.endsWith('/nav-header.tsx') || (path === '/' && (file.startsWith('src/components/hp/') || file.startsWith('src/lib/hp/')) && !file.endsWith('/legal-content.tsx')) ||
      (path.startsWith('/notes/') && ((file.includes('/visuals/') && noteText.includes(file.split('/').pop()!.replace('.tsx', ''))) || file.endsWith('/note-visual.tsx') || file.endsWith('/note-diagram.tsx') || file.endsWith('/diagrams.ts')))
    if (relevant) strings.forEach((text) => segments.add(text))
  }
  if (path === '/') {
    for (const chapter of BIOGRAPHY_CHAPTERS) for (const block of chapter.body) {
      if (block.type === 'paragraph') collectTree(<p>{block.parts.map((part, i) => typeof part === 'string' ? part : <a key={i} href={part.href}>{part.text}</a>)}</p>, segments)
    }
  }
  return { path, title, description, tree, segments: [...segments].filter((text) => text.trim()) }
})

export const getLocalizedDocument = cache(async (locale: Locale, path: string) => {
  if (!isLocale(locale)) notFound()
  const source = await getSourceDocument(path)
  let record: TranslationRecord | null = null
  try {
    const store = translationStore()
    record = await store.get<TranslationRecord>(documentKey(source, locale))
    const requestHeaders = await headers()
    if (!record && requestHeaders.get('x-public-translation-generate') === '1') {
      after(() => generateTranslation(source, locale, store, geminiTranslate))
    }
  } catch (error) {
    console.error('[PUBLIC_I18N_READ_FAILED]', { path, locale, errorName: error instanceof Error ? error.name : 'Error' })
  }
  const dictionary = record?.dictionary ?? {}
  return { ...source, ready: Boolean(record), dictionary,
    tree: record ? structuredTree(translateTree(source.tree, dictionary, locale), new Set(), dictionary, locale) : source.tree,
    title: dictionary[source.title] ?? source.title, description: dictionary[source.description] ?? source.description,
  }
})
