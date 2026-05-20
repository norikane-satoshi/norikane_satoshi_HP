import { describe, expect, it } from "vitest"
import { getClientIp } from "@/lib/security/server/client-ip"

describe("getClientIp", () => {
  it("prefers request.ip when NextRequest provides it", () => {
    const request = new Request("http://localhost", {
      headers: { "x-forwarded-for": "203.0.113.2, 10.0.0.1" },
    }) as Request & { ip?: string }
    request.ip = "198.51.100.10"

    expect(getClientIp(request)).toBe("198.51.100.10")
  })

  it("uses the leftmost x-forwarded-for value", () => {
    const request = new Request("http://localhost", {
      headers: { "x-forwarded-for": "203.0.113.2, 10.0.0.1" },
    })

    expect(getClientIp(request)).toBe("203.0.113.2")
  })

  it("trims x-forwarded-for whitespace", () => {
    const request = new Request("http://localhost", {
      headers: { "x-forwarded-for": " 203.0.113.2 , 10.0.0.1" },
    })

    expect(getClientIp(request)).toBe("203.0.113.2")
  })

  it("falls back to unknown", () => {
    expect(getClientIp(new Request("http://localhost"))).toBe("unknown")
  })
})
