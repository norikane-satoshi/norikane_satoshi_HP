import { NextResponse } from "next/server"

function shouldHideInternalErrorDetail(): boolean {
  const isLocalSafeEnv = process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test"
  const isVercelRuntime = process.env.VERCEL === "1"
  const isVercelProductionLike = process.env.VERCEL_ENV === "production" || process.env.VERCEL_ENV === "preview"
  return !isLocalSafeEnv && isVercelRuntime && isVercelProductionLike
}

export function respondInternalError(error: unknown, context?: string): NextResponse {
  console.error("[INTERNAL_ERROR]", context ?? "(no context)", error)

  if (shouldHideInternalErrorDetail()) {
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 })
  }

  return NextResponse.json(
    {
      error: "INTERNAL_ERROR",
      detail: error instanceof Error ? error.message : String(error),
    },
    { status: 500 },
  )
}
