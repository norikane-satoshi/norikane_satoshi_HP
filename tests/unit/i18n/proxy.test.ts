import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
vi.mock('next-auth/jwt', () => ({ getToken: vi.fn(async () => null) }))
import proxy, { config } from '@/proxy'
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server'

const request = (path: string, headers: Record<string, string> = {}) => new NextRequest(`https://norikane.studio${path}`, { headers })
describe('public locale request security', () => {
  it('routes supported public locales to ISR and rejects direct internal URLs', async () => {
    const localized = await proxy(request('/fr/privacy?utm_source=x'))
    expect(localized.headers.get('location')).toBeNull()
    expect(localized.headers.get('x-middleware-rewrite')).toBe('https://norikane.studio/i18n/fr/privacy?utm_source=x')
    const internal = await proxy(request('/i18n/fr/privacy'))
    expect(internal.status).toBe(404)
    expect(internal.headers.get('x-middleware-rewrite')).toBe('https://norikane.studio/_not-found')
    expect(unstable_doesMiddlewareMatch({ config, url: '/i18n/fr/privacy' })).toBe(true)
  })
  it('keeps booking authentication and never rewrites localized protected URLs', async () => {
    const booking = await proxy(request('/booking/history', { 'x-public-locale': 'en' }))
    expect(booking.headers.get('location')).toBe('https://norikane.studio/login?callbackUrl=%2Fbooking%2Fhistory')
    const localized = await proxy(request('/en/booking'))
    expect(localized.headers.get('x-middleware-rewrite')).toBeNull()
    expect(localized.headers.get('x-middleware-request-x-public-locale')).toBeNull()
  })
  it('allows only the fixed languages and honors the saved choice', async () => {
    const saved = await proxy(request('/privacy', { cookie: 'site_language=ja', 'accept-language': 'fr' }))
    expect(saved.headers.get('location')).toBeNull()
    const malicious = await proxy(request('/privacy?language=https://evil.test', { cookie: 'site_language=//evil.test' }))
    expect(malicious.headers.get('location')).toBeNull()
  })
  it('does not redirect robots or headerless requests and never adds generation headers', async () => {
    for (const headers of [{} as Record<string, string>, { 'accept-language': 'fr', 'user-agent': 'Googlebot' }, { 'accept-language': 'fr', 'user-agent': 'Slackbot-LinkExpanding' }]) {
      const result = await proxy(request('/', headers))
      expect(result.headers.get('location')).toBeNull()
    }
    for (const path of ['/xx/privacy', '/en/booking', '/en/privacy?anything=1']) {
      const result = await proxy(request(path, { 'x-public-translation-generate': '1' }))
      expect(result.headers.get('x-middleware-request-x-public-translation-generate')).toBeNull()
    }
    const canonical = await proxy(request('/en/privacy'))
    expect(canonical.headers.get('x-middleware-request-x-public-translation-generate')).toBeNull()
    expect(canonical.headers.get('vary')).toBeNull()
  })
})

it('matches public and protected page routes but not static images or unrelated endpoints', () => {
  for (const url of ['/', '/privacy', '/notes/correction', '/en/notes/correction', '/booking', '/booking/history']) expect(unstable_doesMiddlewareMatch({ config, url })).toBe(true)
  for (const url of ['/images/profile.jpg', '/notes/diagrams/test.webp', '/notes/test.webp', '/icon.svg', '/_next/static/test.js', '/api/chatbot', '/login']) expect(unstable_doesMiddlewareMatch({ config, url })).toBe(false)
})
