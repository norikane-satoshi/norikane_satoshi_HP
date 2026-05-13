import { NextResponse } from "next/server"
import { getCalendarAuthUrl } from "@/lib/google-calendar"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    return NextResponse.redirect(getCalendarAuthUrl(), 302)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create Google Calendar auth URL" },
      { status: 500 },
    )
  }
}
