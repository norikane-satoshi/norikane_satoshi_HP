import { chromium } from "playwright"
import { config as loadDotenv } from "dotenv"
import { createClient } from "@libsql/client"
import { randomUUID, randomBytes } from "node:crypto"

loadDotenv({ path: ".env.local", override: true })
loadDotenv({ path: ".env", override: false })

const BASE = "http://localhost:41237"

const tursoUrl = process.env.TURSO_DATABASE_URL
const tursoAuth = process.env.TURSO_AUTH_TOKEN
if (!tursoUrl || !tursoAuth) {
  console.error("missing TURSO_DATABASE_URL / TURSO_AUTH_TOKEN")
  process.exit(2)
}

const turso = createClient({ url: tursoUrl, authToken: tursoAuth })

const cleanupEmails = new Set()
async function cleanup() {
  for (const email of cleanupEmails) {
    await turso.execute({ sql: "DELETE FROM VerificationToken WHERE identifier = ?", args: [email] })
    await turso.execute({ sql: "DELETE FROM User WHERE email = ?", args: [email] })
  }
}

function uniqEmail(label) {
  return `e2e-verify-${label}-${Date.now()}-${randomBytes(4).toString("hex")}@example.com`
}

async function signupViaApi(email, password) {
  const res = await fetch(`${BASE}/api/auth/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, displayName: "E2E Tester" }),
  })
  return { status: res.status, body: await res.json().catch(() => ({})) }
}

async function getVerificationToken(email) {
  const r = await turso.execute({
    sql: "SELECT token, expires FROM VerificationToken WHERE identifier = ? ORDER BY expires DESC LIMIT 1",
    args: [email],
  })
  return r.rows[0] ? { token: String(r.rows[0].token), expires: r.rows[0].expires } : null
}

async function getUserEmailVerified(email) {
  const r = await turso.execute({
    sql: "SELECT emailVerified FROM User WHERE email = ? LIMIT 1",
    args: [email],
  })
  return r.rows[0] ? r.rows[0].emailVerified : null
}

async function getTokenRow(token) {
  const r = await turso.execute({
    sql: "SELECT identifier, token, expires FROM VerificationToken WHERE token = ?",
    args: [token],
  })
  return r.rows[0] ?? null
}

const results = []
async function runCase(name, fn) {
  try {
    const detail = await fn()
    results.push({ name, pass: true, detail })
    console.log(`PASS ${name}`)
  } catch (e) {
    results.push({ name, pass: false, error: e.message, stack: e.stack })
    console.log(`FAIL ${name}: ${e.message}`)
  }
}

const browser = await chromium.launch({ headless: true })
try {
  const context = await browser.newContext()
  const page = await context.newPage()

  // (a) success path
  await runCase("(a) signup → verify (303 + /login?verified=1) → banner → signin → /booking", async () => {
    const email = uniqEmail("a")
    cleanupEmails.add(email)
    const password = "Password1234!"
    const signup = await signupViaApi(email, password)
    if (signup.status !== 200) throw new Error(`signup status=${signup.status} body=${JSON.stringify(signup.body)}`)
    const tokenRow = await getVerificationToken(email)
    if (!tokenRow) throw new Error("VerificationToken not created")

    const verifyRes = await fetch(`${BASE}/api/auth/verify-email/${tokenRow.token}`, { redirect: "manual" })
    if (verifyRes.status !== 303) throw new Error(`verify status=${verifyRes.status} (expected 303)`)
    const loc = verifyRes.headers.get("location") || ""
    if (!loc.endsWith("/login?verified=1")) throw new Error(`Location=${loc} (expected /login?verified=1)`)

    const ev = await getUserEmailVerified(email)
    if (!ev) throw new Error("emailVerified not set")

    await page.goto(`${BASE}/login?verified=1`)
    await page.waitForSelector('p[role="status"]', { timeout: 5000 })
    const bannerText = (await page.locator('p[role="status"]').textContent()) || ""
    if (!bannerText.includes("メールアドレスの認証が完了しました")) {
      throw new Error(`banner text mismatch: ${bannerText}`)
    }

    await page.fill('#email', email)
    await page.fill('#password', password)
    await Promise.all([
      page.waitForURL("**/booking", { timeout: 15000 }),
      page.click('button[type="submit"]'),
    ])
    if (!page.url().endsWith("/booking")) throw new Error(`final url=${page.url()} (expected /booking)`)
    return { redirectStatus: verifyRes.status, location: loc, emailVerified: String(ev) }
  })

  // (b) invalid token
  await runCase("(b) GET /verify-email/INVALID → 303 + /login?verifyError=invalid_or_expired → banner", async () => {
    const verifyRes = await fetch(`${BASE}/api/auth/verify-email/INVALID_TOKEN_DOES_NOT_EXIST`, { redirect: "manual" })
    if (verifyRes.status !== 303) throw new Error(`verify status=${verifyRes.status} (expected 303)`)
    const loc = verifyRes.headers.get("location") || ""
    if (!loc.endsWith("/login?verifyError=invalid_or_expired")) {
      throw new Error(`Location=${loc} (expected /login?verifyError=invalid_or_expired)`)
    }
    await page.goto(`${BASE}/login?verifyError=invalid_or_expired`)
    await page.waitForSelector('p[role="alert"]', { timeout: 5000 })
    const text = (await page.locator('p[role="alert"]').first().textContent()) || ""
    if (!text.includes("認証リンクが無効か期限切れです")) {
      throw new Error(`banner text mismatch: ${text}`)
    }
    return { redirectStatus: verifyRes.status, location: loc }
  })

  // (c) expired token
  await runCase("(c) expired token → 303 + /login?verifyError=invalid_or_expired + DB row deleted", async () => {
    const email = uniqEmail("c")
    cleanupEmails.add(email)
    // create user (pending) + expired token row directly
    const userId = randomUUID()
    const now = Date.now()
    const nowIso = new Date(now).toISOString()
    await turso.execute({
      sql: "INSERT INTO User (id, email, passwordHash, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)",
      args: [
        userId,
        email,
        "$2a$12$abcdefghijklmnopqrstuv_placeholder_for_e2e_only_____________",
        nowIso,
        nowIso,
      ],
    })
    const expiredToken = `expired-${randomBytes(16).toString("hex")}`
    await turso.execute({
      sql: "INSERT INTO VerificationToken (identifier, token, expires) VALUES (?, ?, ?)",
      args: [email, expiredToken, new Date(now - 60_000).toISOString()],
    })
    const verifyRes = await fetch(`${BASE}/api/auth/verify-email/${expiredToken}`, { redirect: "manual" })
    if (verifyRes.status !== 303) throw new Error(`verify status=${verifyRes.status} (expected 303)`)
    const loc = verifyRes.headers.get("location") || ""
    if (!loc.endsWith("/login?verifyError=invalid_or_expired")) {
      throw new Error(`Location=${loc} (expected /login?verifyError=invalid_or_expired)`)
    }
    const stillThere = await getTokenRow(expiredToken)
    if (stillThere) throw new Error("expired VerificationToken row was NOT deleted")
    return { redirectStatus: verifyRes.status, location: loc }
  })
} finally {
  await cleanup()
  await browser.close()
}

const summary = {
  passed: results.filter((r) => r.pass).length,
  failed: results.filter((r) => !r.pass).length,
  results,
}
console.log(JSON.stringify(summary, null, 2))
process.exit(summary.failed === 0 ? 0 : 1)
