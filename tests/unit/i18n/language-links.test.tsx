// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, cleanup } from '@testing-library/react'
import { LanguageLinks, OriginalLink, rememberLanguage } from '@/lib/i18n/client'
vi.mock('next/navigation', () => ({ usePathname: () => '/en/notes/correction' }))
afterEach(() => { cleanup(); vi.restoreAllMocks() })
describe('canonical language selection', () => {
  it('renders canonical anchors and writes only validated languages with secure cookie attributes', () => {
    const cookie = vi.spyOn(document, 'cookie', 'set').mockImplementation(() => {})
    const { getByText, container } = render(<LanguageLinks />)
    expect([...container.querySelectorAll('a')].every(a => !a.href.includes('?'))).toBe(true)
    const french = getByText('Français')
    expect(french.getAttribute('href')).toBe('/fr/notes/correction')
    french.addEventListener('click', e => e.preventDefault())
    fireEvent.click(french)
    expect(cookie).toHaveBeenLastCalledWith('site_language=fr; Path=/; Max-Age=31536000; Secure; SameSite=Lax')
    rememberLanguage('https://evil.test' as 'en')
    expect(cookie).toHaveBeenCalledTimes(1)
  })
  it('keeps the original link canonical and remembers Japanese before navigation', () => {
    const cookie = vi.spyOn(document, 'cookie', 'set').mockImplementation(() => {})
    const { getByText } = render(<OriginalLink path="/privacy">原文</OriginalLink>)
    const link = getByText('原文')
    expect(link.getAttribute('href')).toBe('/privacy')
    link.addEventListener('click', e => e.preventDefault())
    fireEvent.click(link)
    expect(cookie).toHaveBeenCalledWith('site_language=ja; Path=/; Max-Age=31536000; Secure; SameSite=Lax')
  })
})
