import { getToken } from "next-auth/jwt"
import { NextResponse, type NextRequest } from "next/server"
import { LANGUAGE_COOKIE, isLanguage, isLocale, isPublicPath, localizedPath, preferredLanguage } from "@/lib/i18n/locales"

export default async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname
  if (pathname !== '/booking' && !pathname.startsWith('/booking/')) {
    const parts = pathname.split('/')
    const locale = isLocale(parts[1]) ? parts[1] : 'ja'
    const path = locale === 'ja' ? pathname : '/' + parts.slice(2).join('/')
    if (!isPublicPath(path)) return NextResponse.next()
    // Query variants must not generate or persist translation documents.
    if (locale !== 'ja' && request.nextUrl.search) {
      const url = request.nextUrl.clone()
      url.search = ''
      return NextResponse.redirect(url, 307)
    }
    const crawler = /bot|crawler|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|discord|slack|linkedin|twitter|pinterest/i.test(request.headers.get('user-agent') ?? '')
    const saved = request.cookies.get(LANGUAGE_COOKIE)?.value
    const language = isLanguage(saved) ? saved : preferredLanguage(request.headers.get('accept-language'))
    if (locale === 'ja' && !crawler && language && language !== 'ja') {
      const url = request.nextUrl.clone()
      url.pathname = localizedPath(path, language)
      const response = NextResponse.redirect(url, 307)
      response.headers.set('Cache-Control', 'private, no-store')
      return response
    }
    return NextResponse.next()
  }
  const token = await getToken({
    req: request,
    secret: process.env.AUTH_SECRET,
    secureCookie: process.env.NODE_ENV === "production",
  })

  if (token?.sub) return NextResponse.next()

  const loginUrl = new URL("/login", request.url)
  loginUrl.searchParams.set("callbackUrl", request.nextUrl.pathname)
  return NextResponse.redirect(loginUrl)
}

export const config = {
  matcher: ["/", "/privacy", "/terms", "/notes/:slug([a-z0-9-]+)", "/booking/:path*", "/(en|ko|zh-Hans|zh-Hant|es|fr|de|pt)/:path*"],
}
