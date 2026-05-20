import { NextResponse } from "next/server"

export const DEFAULT_MAX_BODY_BYTES = 64 * 1024

export function enforceBodyLimit(
  request: Request,
  maxBytes = DEFAULT_MAX_BODY_BYTES,
): NextResponse | null {
  const contentLength = request.headers.get("content-length")
  if (!contentLength) return null

  const byteLength = Number(contentLength)
  if (Number.isNaN(byteLength)) return null

  if (byteLength > maxBytes) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 })
  }

  return null
}
