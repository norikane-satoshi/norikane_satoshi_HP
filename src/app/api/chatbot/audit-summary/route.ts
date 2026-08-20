import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"

import { evaluateChatbotAuditCompleteness } from "@/lib/chatbot/audit/completeness"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const querySchema = z.string().uuid()

export async function GET(request: NextRequest) {
  if (!isLoopbackHostname(request.nextUrl.hostname)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 })
  }
  const parsed = querySchema.safeParse(request.nextUrl.searchParams.get("correlationId"))
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  }

  const events = await prisma.chatbotAuditEvent.findMany({
    where: { correlationId: parsed.data },
    select: {
      eventName: true,
      result: true,
      uiKind: true,
      tier: true,
      durationMs: true,
      errorCode: true,
      source: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
    take: 100,
  })
  const completeness = evaluateChatbotAuditCompleteness(events)
  return NextResponse.json({
    correlationId: parsed.data,
    ...completeness,
    events: events.map((event) => ({
      ...event,
      createdAt: event.createdAt.toISOString(),
    })),
  })
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase().replace(/^\[(.*)\]$/, "$1")
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1"
}
