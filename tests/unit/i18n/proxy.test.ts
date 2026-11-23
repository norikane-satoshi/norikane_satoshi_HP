import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
vi.mock('next-auth/jwt', () => ({ getToken: vi.fn(async () => null) }))
import proxy from '@/proxy'

const request = (path: string, headers: Record<string, string> = {}) => new NextRequest(`https://norikane.studio${path}`, { headers })
describe('public locale request security', () => {
  it('keeps booking authentication and never rewrites localized protected URLs', async () => {
    const booking = await proxy(request('/booking/history', { 'x-public-locale': 'en' }))
    expect(booking.headers.get('location')).toBe('https://norikane.studio/login?callbackUrl=%2Fbooking%2Fhistory')
    const localized = await proxy(request('/en/booking'))
    expect(localized.headers.get('x-middleware-rewrite')).toBeNull()
    expect(localized.headers.get('x-middleware-request-x-public-locale')).toBeNull()
  })
  it('allows only the fixed languages, honors choice, and sets hardened cookies', async () => {
    const selected = await proxy(request('/fr/privacy?language=ja'))
    expect(selected.headers.get('location')).toBe('https://norikane.studio/privacy')
    expect(selected.headers.get('set-cookie')).toMatch(/site_language=ja;.*Secure;.*SameSite=lax/)
    const saved = await proxy(request('/privacy', { cookie: 'site_language=ja', 'accept-language': 'fr' }))
    expect(saved.headers.get('location')).toBeNull()
    const malicious = await proxy(request('/privacy?language=https://evil.test', { cookie: 'site_language=//evil.test' }))
    expect(malicious.headers.get('location')).toBeNull()
  })
  it('does not redirect robots or headerless requests and strips spoofed generation headers', async () => {
    for (const headers of [{} as Record<string, string>, { 'accept-language': 'fr', 'user-agent': 'Googlebot' }, { 'accept-language': 'fr', 'user-agent': 'Slackbot-LinkExpanding' }]) {
      const result = await proxy(request('/', headers))
      expect(result.headers.get('location')).toBeNull()
    }
    for (const path of ['/xx/privacy', '/en/booking', '/en/privacy?anything=1']) {
      const result = await proxy(request(path, { 'x-public-translation-generate': '1' }))
      expect(result.headers.get('x-middleware-request-x-public-translation-generate')).toBeNull()
    }
    const canonical = await proxy(request('/en/privacy'))
    expect(canonical.headers.get('x-middleware-request-x-public-translation-generate')).toBe('1')
  })
})
