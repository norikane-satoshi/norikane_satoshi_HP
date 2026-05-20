import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  limitByIp: vi.fn(),
}))

vi.mock("@/lib/rate-limit/server", () => ({
  limitByIp: mocks.limitByIp,
}))

import { POST } from "@/app/api/contact/route"

function contactRequest(body: unknown) {
  const raw = JSON.stringify(body)
  return new NextRequest("http://localhost/api/contact", {
    method: "POST",
    body: raw,
    headers: { "Content-Length": String(Buffer.byteLength(raw)) },
  })
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    name: "Satoshi",
    email: "satoshi@example.com",
    body: "お問い合わせ本文です。十分な長さがあります。",
    ...overrides,
  }
}

describe("POST /api/contact input limits", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, "log").mockImplementation(() => {})
    mocks.limitByIp.mockResolvedValue({ limited: false, headers: new Headers() })
  })

  it("returns 400 when name exceeds 80 characters", async () => {
    const response = await POST(contactRequest(validBody({ name: "a".repeat(81) })))

    expect(response.status).toBe(400)
  })

  it("returns 400 when body exceeds 4000 characters", async () => {
    const response = await POST(contactRequest(validBody({ body: "a".repeat(4001) })))

    expect(response.status).toBe(400)
  })

  it("returns 400 when email exceeds 254 characters", async () => {
    const response = await POST(contactRequest(validBody({ email: `${"a".repeat(245)}@example.com` })))

    expect(response.status).toBe(400)
  })
})
