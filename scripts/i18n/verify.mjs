import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { JSDOM } from 'jsdom'
const run = promisify(execFile)
const [deployment, directory, ...requested] = process.argv.slice(2)
if (!deployment || !directory) throw new Error('Usage: node scripts/i18n/verify.mjs <deployment> <artifact-directory> [paths...]')
await fs.mkdir(directory, {recursive:true})
const locales = ['en','ko','zh-Hans','zh-Hant','es','fr','de','pt']
const warm = requested[0] === '--warm'
if (warm) requested.shift()
const paths = requested.length ? requested : locales.flatMap(locale => ['','/notes/correction','/notes/ai-thoughts','/privacy','/terms'].map(p=>`/${locale}${p}`))
const results = []
for (const pathname of paths) {
  const name = pathname.replaceAll('/', '_') || 'home'
  const htmlFile = path.join(directory, `${name}.html`)
  const headersFile = path.join(directory, `${name}.headers`)
  let stdout
  let doc
  const deadline = Date.now() + 15 * 60 * 1000
  do {
  ;({stdout} = await run('vercel', ['curl', pathname, '--deployment', deployment, '--', '--silent', '--show-error', '--max-time','90','--output',htmlFile,'--dump-header',headersFile,'--write-out','%{http_code}'], {maxBuffer:4e6}))
  const html = await fs.readFile(htmlFile,'utf8')
  doc = new JSDOM(html).window.document
  if (!warm || doc.querySelector('meta[name="robots"]')?.content === 'index, follow') break
  if (Date.now() > deadline) throw new Error(`Translation did not become ready: ${pathname}`)
  await new Promise(resolve => setTimeout(resolve, 45000))
  } while (true)
  doc.querySelectorAll('script,style').forEach(el=>el.remove())
  const text = (doc.body?.textContent ?? '').replace(/\s+/g,' ').trim()
  await fs.writeFile(path.join(directory, `${name}.txt`), text)
  const result = {path:pathname,status:stdout.trim(),lang:doc.documentElement.lang,title:doc.title,description:doc.querySelector('meta[name="description"]')?.content,robots:doc.querySelector('meta[name="robots"]')?.content,canonical:doc.querySelector('link[rel="canonical"]')?.href,hreflang:[...doc.querySelectorAll('link[hreflang]')].map(x=>[x.hreflang,x.href]),heading:doc.querySelector('h1')?.textContent,textLength:text.length,japaneseCount:(text.match(/[\u3040-\u30ff]/g)||[]).length}
  results.push(result)
  console.log(JSON.stringify({path:pathname,status:result.status,lang:result.lang,title:result.title,robots:result.robots,japaneseCount:result.japaneseCount}))
}
await fs.writeFile(path.join(directory,'results.json'),JSON.stringify(results,null,2))
