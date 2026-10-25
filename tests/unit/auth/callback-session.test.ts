import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { encode } from "next-auth/jwt"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({ findUnique: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: mocks.findUnique } } }))
import { withoutRevokedCallbackSession } from "@/lib/auth/server/callback-session"

const secret = "local-regression-test-secret-with-no-external-use"
const cookieName = "authjs.session-token"

async function sessionCookie(tv = 1, name = cookieName) {
  return encode({ token: { sub: "user_1", tv }, secret, salt: name })
}
function request(cookie: string, method = "GET", url = "http://localhost/api/auth/callback/google") {
  return new NextRequest(url, {
    method,
    headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
    ...(method === "POST" ? { body: "state=test-state&code=test-code" } : {}),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("AUTH_SECRET", secret)
  vi.stubEnv("AUTH_URL", "")
  vi.stubEnv("NEXTAUTH_URL", "")
  mocks.findUnique.mockResolvedValue({ tokenVersion: 2 })
})
afterEach(() => vi.unstubAllEnvs())

describe("callback session validation before Auth.js", () => {
  it.each(["GET", "POST"])("removes revoked session cookies before the %s handler and preserves OAuth cookies/body", async (method) => {
    const jwt = await sessionCookie()
    const handler = vi.fn(async (incoming: NextRequest) => {
      expect(incoming.cookies.get(cookieName)).toBeUndefined()
      expect(incoming.cookies.get("authjs.pkce.code_verifier")?.value).toBe("test-pkce")
      if (method === "POST") expect(await incoming.text()).toBe("state=test-state&code=test-code")
      return new Response(null, { status: 302, headers: { location: "/login" } })
    })
    const response = await withoutRevokedCallbackSession(request(`${cookieName}=${jwt}; authjs.pkce.code_verifier=test-pkce`, method), handler)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(mocks.findUnique).toHaveBeenCalledWith({ where: { id: "user_1" }, select: { tokenVersion: true } })
    expect(response.headers.getSetCookie()).toContain(`${cookieName}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`)
  })

  it("allows a current session to reach the handler unchanged", async () => {
    const original = request(`${cookieName}=${await sessionCookie(2)}`)
    const handler = vi.fn(async () => new Response())
    const response = await withoutRevokedCallbackSession(original, handler)
    expect(handler).toHaveBeenCalledWith(original)
    expect(response.headers.getSetCookie()).toEqual([])
  })

  it("removes all revoked chunks without deleting a newly issued session", async () => {
    const jwt = await sessionCookie()
    const midpoint = Math.floor(jwt.length / 2)
    const handler = vi.fn(async (incoming: NextRequest) => {
      expect(incoming.cookies.getAll()).toEqual([{ name: "authjs.state", value: "test-state" }])
      return new Response(null, { headers: { "set-cookie": `${cookieName}.0=fresh-session; Path=/; HttpOnly` } })
    })
    const response = await withoutRevokedCallbackSession(request(`${cookieName}.0=${jwt.slice(0, midpoint)}; ${cookieName}.1=${jwt.slice(midpoint)}; authjs.state=test-state`), handler)
    const cookies = response.headers.getSetCookie()
    expect(cookies).toContain(`${cookieName}.0=fresh-session; Path=/; HttpOnly`)
    expect(cookies).toContain(`${cookieName}.1=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`)
    expect(cookies.some((cookie) => cookie.startsWith(`${cookieName}.0=;`))).toBe(false)
  })

  it("validates secure cookies using the configured Auth.js origin", async () => {
    vi.stubEnv("AUTH_URL", "https://norikane.studio")
    const name = `__Secure-${cookieName}`
    const jwt = await sessionCookie(1, name)
    const handler = vi.fn(async (incoming: NextRequest) => {
      expect(incoming.cookies.get(name)).toBeUndefined()
      return new Response()
    })
    const response = await withoutRevokedCallbackSession(request(`${name}=${jwt}`), handler)
    expect(response.headers.getSetCookie()[0]).toContain("; Secure")
  })

  it("clears a session whose user no longer exists", async () => {
    mocks.findUnique.mockResolvedValue(null)
    const response = await withoutRevokedCallbackSession(request(`${cookieName}=${await sessionCookie()}`), async (incoming) => {
      expect(incoming.cookies.get(cookieName)).toBeUndefined()
      return new Response()
    })
    expect(response.headers.getSetCookie()).toHaveLength(1)
  })

  it("clears an invalid session without querying the database", async () => {
    await withoutRevokedCallbackSession(request(`${cookieName}=invalid-test-session`), async (incoming) => {
      expect(incoming.cookies.get(cookieName)).toBeUndefined()
      return new Response()
    })
    expect(mocks.findUnique).not.toHaveBeenCalled()
  })

  it.each(["/api/auth/session", "/api/auth/signin/google"])("does not intercept %s", async (path) => {
    const original = request(`${cookieName}=unused`, "GET", `http://localhost${path}`)
    const handler = vi.fn(async () => new Response())
    await withoutRevokedCallbackSession(original, handler)
    expect(handler).toHaveBeenCalledWith(original)
    expect(mocks.findUnique).not.toHaveBeenCalled()
  })

  it("allows a callback without an existing session", async () => {
    const original = request("authjs.state=test-state")
    const handler = vi.fn(async () => new Response())
    await withoutRevokedCallbackSession(original, handler)
    expect(handler).toHaveBeenCalledWith(original)
    expect(mocks.findUnique).not.toHaveBeenCalled()
  })
})
