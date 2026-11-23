import { getToken } from "next-auth/jwt"
import { NextResponse, type NextRequest } from "next/server"
import { LANGUAGE_COOKIE, isLanguage, isLocale, isPublicPath, localizedPath, preferredLanguage } from "@/lib/i18n/locales"

export default async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname
  const requestHeaders = new Headers(request.headers)
  for (const name of ['x-public-translation-generate', 'x-public-locale', 'x-public-path']) requestHeaders.delete(name)
  if (!pathname.startsWith('/booking')) {
    const parts = pathname.split('/')
    const locale = isLocale(parts[1]) ? parts[1] : 'ja'
    const path = locale === 'ja' ? pathname : '/' + parts.slice(2).join('/')
    if (!isPublicPath(path)) return NextResponse.next({ request: { headers: requestHeaders } })
    requestHeaders.set('x-public-locale', locale)
    requestHeaders.set('x-public-path', path)
    const selection = request.nextUrl.searchParams.get('language')
    if (isLanguage(selection)) {
      const url = request.nextUrl.clone()
      url.pathname = localizedPath(path, selection)
      url.searchParams.delete('language')
      const response = NextResponse.redirect(url, 307)
      response.cookies.set(LANGUAGE_COOKIE, selection, { path: '/', maxAge: 365 * 86400, secure: true, sameSite: 'lax', httpOnly: true })
      response.headers.set('Cache-Control', 'private, no-store')
      return response
    }
    const crawler = /bot|crawler|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|discord|slack|linkedin|twitter|pinterest/i.test(request.headers.get('user-agent') ?? '')
    const saved = request.cookies.get(LANGUAGE_COOKIE)?.value
    const language = isLanguage(saved) ? saved : preferredLanguage(request.headers.get('accept-language'))
    if (locale === 'ja' && !crawler && language && language !== 'ja') {
      const url = request.nextUrl.clone()
      url.pathname = localizedPath(path, language)
      const response = NextResponse.redirect(url, 307)
      response.headers.set('Vary', 'Accept-Language, Cookie, User-Agent')
      response.headers.set('Cache-Control', 'private, no-store')
      return response
    }
    if (locale !== 'ja' && !request.nextUrl.search) requestHeaders.set('x-public-translation-generate', '1')
    const response = NextResponse.next({ request: { headers: requestHeaders } })
    response.headers.set('Vary', 'Accept-Language, Cookie, User-Agent')
    return response
  }
  const token = await getToken({
    req: request,
    secret: process.env.AUTH_SECRET,
    secureCookie: process.env.NODE_ENV === "production",
  })

  if (token?.sub) return NextResponse.next({ request: { headers: requestHeaders } })

  const loginUrl = new URL("/login", request.url)
  loginUrl.searchParams.set("callbackUrl", request.nextUrl.pathname)
  return NextResponse.redirect(loginUrl)
}

export const config = {
  matcher: ["/((?!api(?:/|$)|_next/static|_next/image|favicon.ico).*)"],
}
