import { NextRequest, NextResponse } from "next/server"

import { cleanupExpiredChatbotConversations } from "@/lib/chatbot/server/cleanup-conversations"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  try {
    const result = await cleanupExpiredChatbotConversations()
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    console.error("[cleanup-chatbot-conversations]", error)
    return NextResponse.json({ ok: false, error: "cleanup_failed" }, { status: 500 })
  }
}
