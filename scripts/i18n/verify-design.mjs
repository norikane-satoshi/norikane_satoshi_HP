import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createRequire } from 'node:module'
const require = createRequire(process.env.I18N_NODE_MODULE_ROOT || import.meta.url)
const { JSDOM } = require('jsdom')
const run = promisify(execFile)
const [mode, output, target] = process.argv.slice(2)
const staging = target || 'https://norikane-satoshi-hp-git-staging-satoshi-norikanes-projects.vercel.app'
await fs.mkdir(output, { recursive: true })
async function request(site, pathname, name, headers = {}) {
  const file = path.join(output, `${name}.html`)
  const headerFile = path.join(output, `${name}.headers`)
  const args = ['--silent', '--show-error', '--max-time', '90', '--output', file, '--dump-header', headerFile]
  for (const [key, value] of Object.entries(headers)) args.push('-H', `${key}: ${value}`)
  if (site.endsWith('.vercel.app')) await run('vercel', ['curl', pathname, '--deployment', site, '--', ...args], { maxBuffer: 2e6 })
  else await run('curl', [site + pathname, ...args])
  const raw = await fs.readFile(headerFile, 'utf8')
  const block = raw.trim().split(/\r?\n\r?\n/).at(-1).split(/\r?\n/)
  const h = Object.fromEntries(block.slice(1).map(line => { const i = line.indexOf(':'); return [line.slice(0, i).toLowerCase(), line.slice(i + 1).trim()] }))
  const html = await fs.readFile(file, 'utf8')
  const doc = new JSDOM(html).window.document
  const rsc = [...doc.querySelectorAll('script')].filter(el => el.textContent.includes('self.__next_f.push')).reduce((n, el) => n + el.textContent.length, 0)
  const links = [...doc.querySelectorAll('nav[aria-label="Language"] a')].map(a => a.getAttribute('href'))
  const lang = doc.documentElement.lang
  const robots = doc.querySelector('meta[name="robots"]')?.content
  doc.querySelectorAll('script,style,nav[aria-label="Language"]').forEach(el => el.remove())
  const text = doc.body.textContent.replace(/\s+/g, ' ').trim()
  return { status: Number(block[0].split(' ')[1]), headers: h, bytes: Buffer.byteLength(html), rsc, lang, robots, links, text, shell: Boolean(doc.querySelector('header nav') && doc.querySelector('footer nav[aria-label="法務"]')) }
}
const results = {}
if (mode === 'before') {
  for (const [name, url] of [['home', '/'], ['correction', '/notes/correction'], ['ai-thoughts', '/notes/ai-thoughts'], ['not-found', '/no-such-page']]) {
    for (const [label, site] of [['production', 'https://norikane.studio'], ['before', staging]]) {
      results[`${label}-${name}`] = await request(site, url, `${label}-${name}`)
    }
  }
} else {
  for (const [name, url] of [['home', '/'], ['correction', '/notes/correction'], ['ai-thoughts', '/notes/ai-thoughts'], ['privacy', '/privacy'], ['terms', '/terms'], ['login', '/login'], ['signup', '/signup'], ['notes', '/notes']]) {
    results[name] = await request(staging, url, name)
  }
  results['en-first'] = await request(staging, '/en/notes/correction', 'en-first')
  results['en-second'] = await request(staging, '/en/notes/correction', 'en-second')
  const cases = [
    ['fr', '/', { 'Accept-Language': 'fr' }, 307, '/fr'],
    ['unsupported', '/', { 'Accept-Language': 'ar' }, 307, '/en'],
    ['headerless', '/', {}, 200],
    ['japanese-included', '/', { 'Accept-Language': 'fr,ja;q=0.1' }, 200],
    ['robot', '/', { 'Accept-Language': 'fr', 'User-Agent': 'Googlebot' }, 200],
    ['preview', '/', { 'Accept-Language': 'fr', 'User-Agent': 'Slackbot-LinkExpanding' }, 200],
    ['choose-canonical', '/fr/privacy', { Cookie: 'site_language=fr' }, 200],
    ['chosen', '/privacy', { Cookie: 'site_language=ja', 'Accept-Language': 'fr' }, 200],
    ['malicious', '/privacy?language=https://evil.example', { Cookie: 'site_language=//evil.example' }, 200],
    ['booking', '/booking/history', {}, 307, '/login?callbackUrl=%2Fbooking%2Fhistory'],
    ['localized-booking', '/en/booking', {}, 404],
    ['unknown-locale', '/xx/privacy', {}, 404],
    ['unpublished', '/en/notes/not-published-i18n-check', {}, 404],
    ['query', '/fr/privacy?i18n-check=1', { 'x-public-translation-generate': '1' }, 200],
  ]
  results.security = []
  for (const [name, url, headers, status, location] of cases) {
    const got = await request(staging, url, `security-${name}`, headers)
    const actual = got.headers.location
    const secure = got.status !== 200 || ['x-frame-options', 'x-content-type-options', 'strict-transport-security', 'content-security-policy-report-only', 'referrer-policy', 'permissions-policy'].every(k => got.headers[k])
    results.security.push({ name, status: got.status, location: actual, pass: got.status === status && (location ? actual === location || actual === staging + location : !actual) && Boolean(secure) })
  }
  results.notFound = []
  for (const pathname of ['/no-such-page', '/missing/deep/path', '/en/booking', '/xx/terms', '/i18n/fr/privacy']) {
    const got = await request(staging, pathname, `404-${pathname.replaceAll('/', '_')}`)
    results.notFound.push({ pathname, text: got.text, status: got.status, lang: got.lang, shell: got.shell, pass: got.status === 404 && got.lang === 'ja' && got.shell })
  }
  const utm = await request(staging, '/?utm_source=x', 'utm-entry', { 'Accept-Language': 'fr' })
  const utmPage = await request(staging, '/fr?utm_source=x', 'utm-page')
  const canonical = await request(staging, '/fr/privacy', 'query-canonical')
  const query = await request(staging, '/fr/privacy?utm_source=cache-check', 'query-cache')
  const baseline = {}
  for (const [name, pathname] of [['home', '/'], ['correction', '/notes/correction'], ['ai-thoughts', '/notes/ai-thoughts'], ['not-found', '/no-such-page']]) {
    baseline[`production-${name}`] = await request('https://norikane.studio', pathname, `production-${name}`)
  }
  results.verification = {
    brandedNotFound: results.notFound.every(result => result.pass),
    notFoundText: results.notFound[0].text === baseline['production-not-found'].text,
    utmPreserved: utm.status === 307 && [staging + '/fr?utm_source=x', '/fr?utm_source=x'].includes(utm.headers.location) && utmPage.status === 200 && !utmPage.headers.location,
    queryCache: query.status === 200 && !query.headers.location && [query.headers['x-vercel-cache'], query.headers['x-nextjs-cache']].includes('HIT') && Boolean(canonical.headers.etag) && query.headers.etag === canonical.headers.etag,
    japanesePrerender: ['home', 'correction', 'ai-thoughts', 'privacy', 'terms', 'login', 'signup', 'notes'].every(name => results[name].headers['x-nextjs-prerender'] === '1'),
    localizedCache: results['en-first'].status === 200 && results['en-second'].status === 200 && [results['en-second'].headers['x-vercel-cache'], results['en-second'].headers['x-nextjs-cache']].includes('HIT'),
    fallback: ['en-first', 'en-second'].every(name => results[name].lang === 'ja' && results[name].robots === 'noindex, follow'),
    canonicalLinks: results['en-second'].links.length === 9 && results['en-second'].links.every(href => !href.includes('?')),
    japaneseText: ['home', 'correction', 'ai-thoughts'].every(name => results[name].text === baseline[`production-${name}`].text),
  }
  if (results.security.some(r => !r.pass) || Object.values(results.verification).some(pass => !pass)) process.exitCode = 1
}
await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2))
console.log(JSON.stringify(Object.fromEntries(Object.entries(results).map(([key, value]) => [key, ['security', 'verification', 'notFound'].includes(key) ? value : { ...value, text: undefined, headers: { cache: value.headers['x-vercel-cache'], prerender: value.headers['x-nextjs-prerender'], nextCache: value.headers['x-nextjs-cache'], age: value.headers.age } }])), null, 2))
