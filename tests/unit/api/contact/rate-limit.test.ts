import { NextRequest, NextResponse } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  limitByIp: vi.fn(),
}))

vi.mock("@/lib/rate-limit/server", () => ({
  limitByIp: mocks.limitByIp,
}))

import { POST } from "@/app/api/contact/route"

function contactRequest(body: unknown) {
  return new NextRequest("http://localhost/api/contact", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" },
  })
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    name: "のりかね",
    email: "satoshi@example.com",
    body: "お問い合わせ本文です。十分な長さがあります。",
    ...overrides,
  }
}

describe("POST /api/contact rate limit", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, "log").mockImplementation(() => {})
    mocks.limitByIp.mockResolvedValue({ limited: false, headers: new Headers() })
  })

  it("returns 200 when the contact IP limit allows the request", async () => {
    const response = await POST(contactRequest(validBody()))
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json).toEqual({ ok: true })
    expect(mocks.limitByIp).toHaveBeenCalledWith(
      "contactIp",
      expect.any(NextRequest),
      "送信回数の上限に達しました。5分後にお試しください。",
    )
  })

  it("returns 429 with the Japanese message and Retry-After when the limit is exceeded", async () => {
    mocks.limitByIp.mockResolvedValue({
      limited: true,
      headers: new Headers({ "Retry-After": "300" }),
      response: NextResponse.json(
        { error: "送信回数の上限に達しました。5分後にお試しください。" },
        { status: 429, headers: { "Retry-After": "300" } },
      ),
    })

    const response = await POST(contactRequest(validBody()))
    const json = await response.json()

    expect(response.status).toBe(429)
    expect(response.headers.get("Retry-After")).toBe("300")
    expect(json).toEqual({ error: "送信回数の上限に達しました。5分後にお試しください。" })
  })

  it("evaluates the rate limit before Zod validation", async () => {
    mocks.limitByIp.mockResolvedValue({
      limited: true,
      headers: new Headers({ "Retry-After": "300" }),
      response: NextResponse.json(
        { error: "送信回数の上限に達しました。5分後にお試しください。" },
        { status: 429, headers: { "Retry-After": "300" } },
      ),
    })

    const response = await POST(contactRequest({ email: "not-an-email" }))
    const json = await response.json()

    expect(response.status).toBe(429)
    expect(json).toEqual({ error: "送信回数の上限に達しました。5分後にお試しください。" })
  })

  it("evaluates the rate limit before the honeypot branch", async () => {
    mocks.limitByIp.mockResolvedValue({
      limited: true,
      headers: new Headers({ "Retry-After": "300" }),
      response: NextResponse.json(
        { error: "送信回数の上限に達しました。5分後にお試しください。" },
        { status: 429, headers: { "Retry-After": "300" } },
      ),
    })

    const response = await POST(contactRequest(validBody({ website: "https://bot.example" })))
    const json = await response.json()

    expect(response.status).toBe(429)
    expect(json).not.toEqual({ ok: true })
    expect(json).toEqual({ error: "送信回数の上限に達しました。5分後にお試しください。" })
  })
})
