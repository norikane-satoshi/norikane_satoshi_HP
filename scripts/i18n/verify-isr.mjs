import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const output = process.argv[2]
assert(output, 'Pass an evidence output directory; run next build first')
await fs.mkdir(output, { recursive: true })
let reads = 0
let writes = 0
const redis = http.createServer(async (req, res) => {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const commands = JSON.parse(Buffer.concat(chunks).toString())
  reads += commands.filter(command => command[0].toLowerCase() === 'get').length
  writes += commands.filter(command => command[0].toLowerCase() !== 'get').length
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(commands.map(() => ({ result: null }))))
})
redis.listen(0, '127.0.0.1')
await once(redis, 'listening')
const portProbe = http.createServer()
portProbe.listen(0, '127.0.0.1')
await once(portProbe, 'listening')
const port = portProbe.address().port
await new Promise(resolve => portProbe.close(resolve))
// NextURL normalizes loopback hosts to localhost; rewrites need the same origin.
const server = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'start', '--hostname', 'localhost', '--port', String(port)], {
  detached: true,
  env: { ...process.env, UPSTASH_REDIS_REST_URL: `http://127.0.0.1:${redis.address().port}`, UPSTASH_REDIS_REST_TOKEN: 'local-stub', GEMINI_API_KEY: 'local-stub' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let log = ''
server.stdout.on('data', data => { log += data })
server.stderr.on('data', data => { log += data })
const exited = once(server, 'exit')
try {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('next start did not become ready')), 30000)
    server.stdout.on('data', () => { if (log.includes('Ready in')) { clearTimeout(timeout); resolve() } })
    server.once('exit', () => { clearTimeout(timeout); reject(new Error('next start exited early')) })
  })
  const url = `http://localhost:${port}/en/terms`
  const first = await fetch(url)
  const html = await first.text()
  const readsAfterFirst = reads
  const cacheFiles = async () => (await fs.readdir('.next/server/app', { recursive: true })).filter(name => /\.(html|rsc|meta)$/.test(name)).sort()
  const filesAfterFirst = await cacheFiles()
  const variants = []
  for (const query of ['?utm_source=x', '?utm_source=y&campaign=two', '?i18n-check=1']) {
    const response = await fetch(url + query, { redirect: 'manual' })
    const body = await response.text()
    variants.push({ query, status: response.status, cache: response.headers.get('x-nextjs-cache'), reads, writes })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('location'), null)
    assert.equal(response.headers.get('x-nextjs-cache'), 'HIT')
    assert.equal(body, html)
    assert.equal(reads, readsAfterFirst, 'A query variant must not render or read Redis again')
    assert.equal(writes, 0)
  }
  assert.deepEqual(await cacheFiles(), filesAfterFirst, 'Query variants must not create separate cache entries')
  const second = await fetch(url)
  await second.text()
  const result = { url, pid: server.pid, firstStatus: first.status, secondStatus: second.status,
    firstCache: first.headers.get('x-nextjs-cache'), secondCache: second.headers.get('x-nextjs-cache'),
    variants, writes, sameCacheFiles: true, logPath: path.join(output, 'isr-server.log'),
    readsAfterFirst, readsAfterSecond: reads, japaneseFallback: html.includes('lang="ja"'), noindex: html.includes('noindex, follow') }
  await fs.writeFile(path.join(output, 'isr-runtime.json'), JSON.stringify(result, null, 2))
  assert.equal(first.status, 200)
  assert.equal(second.status, 200)
  assert.equal(result.secondCache, 'HIT')
  assert(readsAfterFirst > 0)
  assert.equal(reads, readsAfterFirst, 'The cached request must not read Redis')
  assert(result.japaneseFallback && result.noindex)
  console.log(JSON.stringify(result, null, 2))
  const coldUrl = `http://localhost:${port}/fr/terms`
  const cold = await fetch(coldUrl + '?utm_source=first', { redirect: 'manual' })
  const coldHtml = await cold.text()
  assert.equal(cold.status, 200)
  assert.equal(cold.headers.get('x-nextjs-cache'), 'MISS')
  const coldReads = reads
  const coldFiles = await cacheFiles()
  for (const query of ['', '?utm_source=second']) {
    const response = await fetch(coldUrl + query, { redirect: 'manual' })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('x-nextjs-cache'), 'HIT')
    assert.equal(await response.text(), coldHtml)
    assert.equal(reads, coldReads)
    assert.equal(writes, 0)
    assert.deepEqual(await cacheFiles(), coldFiles)
  }
  await fs.writeFile(path.join(output, 'isr-query-first.json'), JSON.stringify({ url: coldUrl, firstCache: cold.headers.get('x-nextjs-cache'), readsBefore: readsAfterFirst, readsAfterColdQuery: coldReads, readsAfterVariants: reads, writes, sameCacheFiles: true }, null, 2))

} finally {
  if (server.exitCode === null) process.kill(-server.pid, 'SIGTERM')
  await exited
  await new Promise(resolve => redis.close(resolve))
  await fs.writeFile(path.join(output, 'isr-server.log'), log)
}
