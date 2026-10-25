import type { NextRequest } from "next/server"
import { handlers } from "@/auth"
import { withoutRevokedCallbackSession } from "@/lib/auth/server/callback-session"

export const GET = (request: NextRequest) => withoutRevokedCallbackSession(request, handlers.GET)
export const POST = (request: NextRequest) => withoutRevokedCallbackSession(request, handlers.POST)
