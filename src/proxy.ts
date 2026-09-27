import { getToken } from "next-auth/jwt"
import { NextResponse, type NextRequest } from "next/server"

export default async function proxy(request: NextRequest) {
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
  matcher: ["/booking/:path*"],
}
