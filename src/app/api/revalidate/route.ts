import { NextResponse, type NextRequest } from "next/server"
import { revalidatePath, revalidateTag } from "next/cache"
import {
  CC_NOTION_SIGNATURE_HEADER,
  CC_NOTION_TIMESTAMP_HEADER,
  verifyCcNotionSignedRequest,
} from "@/lib/api/server/signed-request"

type Payload = {
  slug: string
  reason?: string
}

function parsePayload(raw: string): Payload | null {
  try {
    const obj = JSON.parse(raw) as unknown
    if (!obj || typeof obj !== "object") return null
    const slug = (obj as { slug?: unknown }).slug
    const reason = (obj as { reason?: unknown }).reason
    if (typeof slug !== "string" || !slug) return null
    if (!/^[a-z0-9-]+$/.test(slug)) return null
    return {
      slug,
      reason: typeof reason === "string" ? reason : undefined,
    }
  } catch {
    return null
  }
}

export async function POST(request: NextRequest) {
  const secret = process.env.REVALIDATE_SECRET
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "server misconfigured: REVALIDATE_SECRET not set" },
      { status: 500 }
    )
  }

  const rawBody = await request.text()
  const verified = verifyCcNotionSignedRequest({
    rawBody,
    timestampHeader: request.headers.get(CC_NOTION_TIMESTAMP_HEADER),
    signatureHeader: request.headers.get(CC_NOTION_SIGNATURE_HEADER) ?? "",
    secret,
  })
  if (!verified.ok) {
    return NextResponse.json({ ok: false, error: verified.error }, { status: 403 })
  }

  const payload = parsePayload(rawBody)
  if (!payload) {
    return NextResponse.json(
      { ok: false, error: "invalid payload" },
      { status: 400 }
    )
  }

  revalidatePath(`/notes/${payload.slug}`, "page")
  revalidateTag("notes", "max")
  revalidatePath("/", "page")

  return NextResponse.json({
    ok: true,
    revalidated: {
      path: `/notes/${payload.slug}`,
      tag: "notes",
      home: true,
    },
    reason: payload.reason ?? null,
  })
}
