import { describe, expect, it } from "vitest"
import nextConfig from "../../../next.config"

type HeaderEntry = {
  key: string
  value: string
}

type HeaderRoute = {
  source: string
  headers: HeaderEntry[]
}

const expectedSecurityHeaders = {
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy":
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=(), interest-cohort=()",
  "Content-Security-Policy-Report-Only":
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.youtube.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https:; frame-src https://www.youtube.com https://www.youtube-nocookie.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; report-uri /api/csp-report; object-src 'none'",
}

const cacheControlValue = "no-store, no-cache, must-revalidate"

async function loadHeaderRoutes() {
  if (!nextConfig.headers) {
    throw new Error("next.config.ts headers() is not defined")
  }
  return (await nextConfig.headers()) as HeaderRoute[]
}

function findRoute(routes: HeaderRoute[], source: string) {
  const route = routes.find((entry) => entry.source === source)
  if (!route) {
    throw new Error(`Missing header route: ${source}`)
  }
  return route
}

function headerMap(route: HeaderRoute) {
  return new Map(route.headers.map((header) => [header.key, header.value]))
}

describe("security headers", () => {
  it("adds the shared hardening headers to all paths", async () => {
    const routes = await loadHeaderRoutes()
    const sharedHeaders = headerMap(findRoute(routes, "/:path*"))

    expect(Object.fromEntries(sharedHeaders)).toMatchObject(expectedSecurityHeaders)
  })

  it("uses CSP report-only instead of enforcing CSP", async () => {
    const routes = await loadHeaderRoutes()
    const sharedHeaders = headerMap(findRoute(routes, "/:path*"))

    expect(sharedHeaders.has("Content-Security-Policy-Report-Only")).toBe(true)
    expect(sharedHeaders.has("Content-Security-Policy")).toBe(false)
  })

  it("keeps the CSP hardening directives in the report-only draft", async () => {
    const routes = await loadHeaderRoutes()
    const csp = headerMap(findRoute(routes, "/:path*")).get(
      "Content-Security-Policy-Report-Only",
    )

    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("frame-src https://www.youtube.com")
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("base-uri 'self'")
    expect(csp).toContain("frame-src https://www.youtube.com https://www.youtube-nocookie.com")
    expect(csp).toContain("report-uri /api/csp-report")
  })

  it("disables caching for admin routes", async () => {
    const routes = await loadHeaderRoutes()
    const adminHeaders = headerMap(findRoute(routes, "/admin/:path*"))

    expect(adminHeaders.get("Cache-Control")).toBe(cacheControlValue)
  })

  it("disables caching for booking edit routes", async () => {
    const routes = await loadHeaderRoutes()
    const bookingEditHeaders = headerMap(findRoute(routes, "/booking/edit/:path*"))

    expect(bookingEditHeaders.get("Cache-Control")).toBe(cacheControlValue)
  })

  it("sets clickjacking, MIME sniffing, and browser API restrictions", async () => {
    const routes = await loadHeaderRoutes()
    const sharedHeaders = headerMap(findRoute(routes, "/:path*"))
    const permissionsPolicy = sharedHeaders.get("Permissions-Policy")

    expect(sharedHeaders.get("X-Frame-Options")).toBe("DENY")
    expect(sharedHeaders.get("X-Content-Type-Options")).toBe("nosniff")
    expect(permissionsPolicy).toContain("camera=()")
    expect(permissionsPolicy).toContain("microphone=()")
    expect(permissionsPolicy).toContain("geolocation=()")
  })
})
