import { NextResponse } from "next/server"

import { getChatbotBuildInfo } from "@/lib/chatbot/server/build-info"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export function GET() {
  return NextResponse.json(getChatbotBuildInfo())
}
