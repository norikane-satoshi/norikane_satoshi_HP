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
const redis = http.createServer(async (req, res) => {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const commands = JSON.parse(Buffer.concat(chunks).toString())
  assert(commands.every(command => command[0].toLowerCase() === 'get'), 'Only translation reads are expected')
  reads += commands.length
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
const server = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
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
  const url = `http://127.0.0.1:${port}/en/terms`
  const first = await fetch(url)
  const html = await first.text()
  const readsAfterFirst = reads
  const second = await fetch(url)
  await second.text()
  const result = { url, pid: server.pid, firstStatus: first.status, secondStatus: second.status,
    firstCache: first.headers.get('x-nextjs-cache'), secondCache: second.headers.get('x-nextjs-cache'),
    readsAfterFirst, readsAfterSecond: reads, japaneseFallback: html.includes('lang="ja"'), noindex: html.includes('noindex, follow') }
  await fs.writeFile(path.join(output, 'isr-runtime.json'), JSON.stringify(result, null, 2))
  assert.equal(first.status, 200)
  assert.equal(second.status, 200)
  assert.equal(result.secondCache, 'HIT')
  assert(readsAfterFirst > 0)
  assert.equal(reads, readsAfterFirst, 'The cached request must not read Redis')
  assert(result.japaneseFallback && result.noindex)
  console.log(JSON.stringify(result, null, 2))
} finally {
  if (server.exitCode === null) process.kill(-server.pid, 'SIGTERM')
  await exited
  await new Promise(resolve => redis.close(resolve))
  await fs.writeFile(path.join(output, 'isr-server.log'), log)
}
