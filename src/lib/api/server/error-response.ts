import { NextResponse } from "next/server"

export function respondInternalError(error: unknown, context?: string): NextResponse {
  console.error("[INTERNAL_ERROR]", context ?? "(no context)", error)

  if (process.env.NODE_ENV === "production") {
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
