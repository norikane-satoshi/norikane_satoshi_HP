import { Children, Fragment, cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { localizeHref, type Language } from './locales'

export type Dictionary = Record<string, string>
type Props = { children?: ReactNode; i18nBoundary?: boolean; href?: string; [key: string]: unknown }
const inlineTags = new Set(['a', 'span', 'strong', 'b', 'em', 'i', 'code', 'small', 'sup', 'sub', 'u', 's', 'br'])
export const hasWords = (text: string) => /[A-Za-z\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/u.test(text)

export function packInline(children: ReactNode) {
  const elements: ReactElement<Props>[] = []
  let valid = true
  const walk = (node: ReactNode): string => {
    if (node === null || node === undefined || typeof node === 'boolean') return ''
    if (typeof node === 'string' || typeof node === 'number') return String(node)
    if (Array.isArray(node)) return node.map(walk).join('')
    if (!isValidElement<Props>(node)) { valid = false; return '' }
    if (node.type === Fragment || node.props.i18nBoundary) return walk(node.props.children)
    if (!(typeof node.type === 'string' && inlineTags.has(node.type)) && !node.props.href) { valid = false; return '' }
    const id = elements.length
    elements.push(node)
    return `⟦${id}⟧${walk(node.props.children)}⟦/${id}⟧`
  }
  const text = walk(children)
  return valid ? { text, elements } : null
}

export function validMarkers(source: string, translated: string) {
  const pattern = /⟦(\/?)(\d+)⟧/g
  const wanted = [...source.matchAll(pattern)].map((m) => m[0]).sort()
  const found = [...translated.matchAll(pattern)].map((m) => m[0]).sort()
  if (JSON.stringify(wanted) !== JSON.stringify(found)) return false
  const stack: string[] = []
  for (const match of translated.matchAll(pattern)) {
    if (!match[1]) stack.push(match[2])
    else if (stack.pop() !== match[2]) return false
  }
  return stack.length === 0 && !/⟦[^⟧]*$/.test(translated)
}

function unpackInline(text: string, elements: ReactElement<Props>[], locale: Language): ReactNode {
  const root: ReactNode[] = []
  const stack: { children: ReactNode[]; id: number }[] = [{ children: root, id: -1 }]
  let offset = 0
  for (const match of text.matchAll(/⟦(\/?)(\d+)⟧/g)) {
    stack[stack.length - 1].children.push(text.slice(offset, match.index))
    const id = Number(match[2])
    if (!match[1]) stack.push({ children: [], id })
    else {
      const frame = stack.pop()!
      const element = elements[id]
      stack[stack.length - 1].children.push(cloneElement(element, {
        key: `translated-${id}`, ...(element.props.href ? { href: localizeHref(element.props.href, locale) } : {}),
      }, element.type === 'br' ? undefined : frame.children))
    }
    offset = match.index! + match[0].length
  }
  root.push(text.slice(offset))
  return root
}

export function collectTree(node: ReactNode, output = new Set<string>()): Set<string> {
  if (typeof node === 'string') { if (hasWords(node)) output.add(node); return output }
  if (Array.isArray(node)) { node.forEach((child) => collectTree(child, output)); return output }
  if (!isValidElement<Props>(node) || node.type === 'script' || node.type === 'style') return output
  const packed = packInline(node.props.children)
  if (packed && hasWords(packed.text)) output.add(packed.text)
  else collectTree(node.props.children, output)
  return output
}

export function translateTree(node: ReactNode, dictionary: Dictionary, locale: Language): ReactNode {
  if (locale === 'ja') return node
  if (typeof node === 'string') return dictionary[node] ?? node
  if (Array.isArray(node)) return Children.map(node, (child) => translateTree(child, dictionary, locale))
  if (!isValidElement<Props>(node) || node.type === 'script' || node.type === 'style') return node
  const packed = packInline(node.props.children)
  const translation = packed && dictionary[packed.text]
  const children = translation && validMarkers(packed!.text, translation)
    ? unpackInline(translation, packed!.elements, locale)
    : translateTree(node.props.children, dictionary, locale)
  return cloneElement(node, {
    ...(node.props.href ? { href: localizeHref(node.props.href, locale) } : {}),
    ...('children' in node.props ? { children } : {}),
  })
}
