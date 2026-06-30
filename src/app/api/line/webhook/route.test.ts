import crypto from "node:crypto"
import { NextRequest } from "next/server"
import { afterEach, describe, expect, it, vi } from "vitest"

import * as route from "./route"

const ORIGINAL_ENV = { ...process.env }

function signedRequest(body: string, secret: string, signature = sign(body, secret)) {
  return new NextRequest("http://localhost/api/line/webhook", {
    method: "POST",
    headers: {
      "x-line-signature": signature,
    },
    body,
  })
}

function sign(body: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(body).digest("base64")
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  vi.unstubAllGlobals()
})

describe("POST /api/line/webhook", () => {
  it("rejects requests with an invalid signature", async () => {
    process.env.LINE_WEBHOOK_CHANNEL_SECRET = "test-secret"

    const response = await route.POST(signedRequest('{"events":[]}', "test-secret", "invalid"))
    await expect(response.json()).resolves.toEqual({ error: "invalid_signature" })
    expect(response.status).toBe(401)
  })

  it("accepts a valid signature and does not require a messaging token", async () => {
    process.env.LINE_WEBHOOK_CHANNEL_SECRET = "test-secret"

    const response = await route.POST(signedRequest('{"events":[]}', "test-secret"))
    await expect(response.json()).resolves.toEqual({ ok: true, eventCount: 0 })
    expect(response.status).toBe(200)
  })

  it("replies with the LIFF booking URL when a token is configured", async () => {
    process.env.LINE_WEBHOOK_CHANNEL_SECRET = "test-secret"
    process.env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN = "test-token"
    process.env.NEXT_PUBLIC_LINE_LIFF_URL = "https://liff.line.me/test"
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)

    const response = await route.POST(signedRequest(
      JSON.stringify({ events: [{ type: "message", replyToken: "reply-token" }] }),
      "test-secret",
    ))

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.line.me/v2/bot/message/reply",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
        }),
      }),
    )
    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse(init.body as string).messages[0].text).toContain("https://liff.line.me/test")
  })
})
