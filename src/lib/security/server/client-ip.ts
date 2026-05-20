export function getClientIp(request: Request): string {
  const reqIp = (request as { ip?: string }).ip
  if (reqIp) return reqIp

  const xff = request.headers.get("x-forwarded-for")
  if (xff) {
    const first = xff.split(",")[0]?.trim()
    if (first) return first
  }

  return "unknown"
}
