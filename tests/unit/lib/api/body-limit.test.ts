import { describe, expect, it } from "vitest"

import { DEFAULT_MAX_BODY_BYTES, enforceBodyLimit } from "@/lib/api/server/body-limit"

function request(contentLength?: string) {
  return new Request("http://localhost/api/test", {
    method: "POST",
    headers: contentLength === undefined ? undefined : { "Content-Length": contentLength },
  })
}

describe("enforceBodyLimit", () => {
  it("returns 413 when Content-Length exceeds 64KB", async () => {
    const response = enforceBodyLimit(request(String(DEFAULT_MAX_BODY_BYTES + 1)))

    expect(response?.status).toBe(413)
    await expect(response?.json()).resolves.toEqual({ error: "payload_too_large" })
  })

  it("returns null when Content-Length is under the limit", () => {
    expect(enforceBodyLimit(request(String(DEFAULT_MAX_BODY_BYTES)))).toBeNull()
  })

  it("returns null when Content-Length is absent", () => {
    expect(enforceBodyLimit(request())).toBeNull()
  })
})
