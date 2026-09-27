import { createHmac } from "node:crypto"
import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const cacheMocks = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}))

vi.mock("next/cache", () => cacheMocks)

function signedRequest(body: unknown, timestamp: number, secret = "revalidate_secret") {
  const rawBody = JSON.stringify(body)
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex")
  return new NextRequest("http://localhost/api/revalidate", {
    method: "POST",
    headers: {
      "x-cc-notion-timestamp": String(timestamp),
      "x-cc-notion-signature": `sha256=${signature}`,
    },
    body: rawBody,
  })
}

async function loadPost() {
  vi.resetModules()
  vi.stubEnv("REVALIDATE_SECRET", "revalidate_secret")
  return import("@/app/api/revalidate/route")
}

describe("POST /api/revalidate replay defense", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-05-20T12:00:00.000Z"))
  })

  it("returns 403 when timestamp is missing", async () => {
    const { POST } = await loadPost()
    const response = await POST(new NextRequest("http://localhost/api/revalidate", {
      method: "POST",
      headers: {
        "x-cc-notion-signature": "sha256=00",
      },
      body: JSON.stringify({ slug: "look-decomposition" }),
    }))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ ok: false, error: "invalid_timestamp" })
  })

  it("returns 403 when timestamp is stale by 301 seconds", async () => {
    const { POST } = await loadPost()
    const now = Math.floor(Date.now() / 1000)
    const response = await POST(signedRequest({ slug: "look-decomposition" }, now - 301))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ ok: false, error: "stale_request" })
  })

  it("returns 403 when signature does not match timestamp and body", async () => {
    const { POST } = await loadPost()
    const now = Math.floor(Date.now() / 1000)
    const request = new NextRequest("http://localhost/api/revalidate", {
      method: "POST",
      headers: {
        "x-cc-notion-timestamp": String(now),
        "x-cc-notion-signature": "sha256=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
      body: JSON.stringify({ slug: "look-decomposition" }),
    })

    const response = await POST(request)

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ ok: false, error: "invalid_signature" })
  })

  it("revalidates when timestamp and signature are valid", async () => {
    const { POST } = await loadPost()
    const now = Math.floor(Date.now() / 1000)

    const response = await POST(signedRequest({ slug: "look-decomposition", reason: "test" }, now))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      revalidated: {
        path: "/notes/look-decomposition",
        tag: "notes",
        home: true,
      },
      reason: "test",
    })
    expect(cacheMocks.revalidatePath).toHaveBeenCalledWith("/notes/look-decomposition", "page")
    expect(cacheMocks.revalidateTag).toHaveBeenCalledWith("notes", "max")
    expect(cacheMocks.revalidatePath).toHaveBeenCalledWith("/", "page")
  })
})
