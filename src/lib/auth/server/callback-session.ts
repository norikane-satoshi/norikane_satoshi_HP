import { getToken } from "next-auth/jwt"
import { NextRequest } from "next/server"
import { prisma } from "@/lib/prisma"

export async function withoutRevokedCallbackSession(
  request: NextRequest,
  handler: (request: NextRequest) => Promise<Response>,
): Promise<Response> {
  if (!request.nextUrl.pathname.startsWith("/api/auth/callback/")) return handler(request)

  const secureCookie = new URL(process.env.AUTH_URL || process.env.NEXTAUTH_URL || request.url).protocol === "https:"
  const cookieName = `${secureCookie ? "__Secure-" : ""}authjs.session-token`
  const sessionCookies = request.cookies.getAll().filter(({ name }) =>
    name === cookieName || name.startsWith(`${cookieName}.`),
  )
  if (!sessionCookies.length) return handler(request)

  const token = await getToken({
    req: { headers: new Headers({ cookie: request.headers.get("cookie") ?? "" }) },
    secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
    secureCookie,
  })
  const user = token?.sub ? await prisma.user.findUnique({
    where: { id: token.sub },
    select: { tokenVersion: true },
  }) : null
  if (user && (token?.tv ?? 0) === user.tokenVersion) return handler(request)

  // OAuth state/PKCE cookies must survive when only the old session is discarded.
  const headers = new Headers(request.headers)
  const sessionNames = new Set(sessionCookies.map(({ name }) => name))
  headers.set("cookie", request.cookies.getAll()
    .filter(({ name }) => !sessionNames.has(name))
    .map(({ name, value }) => `${name}=${value}`).join("; "))
  const response = await handler(new NextRequest(request, { headers }))
  const issuedNames = new Set(response.headers.getSetCookie().map((cookie) => cookie.split("=", 1)[0]))
  for (const { name } of sessionCookies) {
    // A successful login may have already replaced this cookie with a fresh session.
    if (!issuedNames.has(name)) {
      response.headers.append("set-cookie", `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secureCookie ? "; Secure" : ""}`)
    }
  }
  return response
}
