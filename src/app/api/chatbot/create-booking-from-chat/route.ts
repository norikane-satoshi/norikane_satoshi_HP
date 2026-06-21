import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"

import { auth } from "@/auth"
import { respondInternalError } from "@/lib/api/server/error-response"
import { bookingApiSchema, type BookingApiInput } from "@/lib/booking/domain/api-schema"
import { bookingFormSchema } from "@/lib/booking/domain/form-schema"
import { createBookingFromApiInput } from "@/lib/booking/server/create-booking"
import { BookingConflictError } from "@/lib/booking/server/errors"
import { respondChatbotOperationFailure } from "@/lib/chatbot/server/operation-failure"
import { linkChatToBookingGroup } from "@/lib/chatbot/server/repository"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const selectedSlotSchema = z
  .object({
    start: z.string().datetime(),
    end: z.string().datetime(),
  })
  .superRefine((value, context) => {
    const start = new Date(value.start)
    const end = new Date(value.end)
    if (start >= end) {
      context.addIssue({
        code: "custom",
        message: "終了時刻は開始時刻より後にしてください",
        path: ["end"],
      })
    }
  })

const chatbotBookingRequestSchema = z
  .object({
    conversationId: z.string().trim().min(1).optional(),
    projectTitle: z.string().trim().min(1).max(200),
    contactName: z.string().trim().min(1).max(80),
    contactEmail: z.string().trim().email().max(254),
    companyName: z.string().trim().max(120).optional(),
    phone: z.string().trim().max(32).optional(),
    dueDate: z.string().optional(),
    memo: z.string().trim().max(2000).optional(),
    agreed: z.literal(true),
    selectedSlot: selectedSlotSchema.optional(),
    selectedSlots: z.array(selectedSlotSchema).optional(),
    jobContext: z.unknown().optional(),
    workflowEstimate: z.unknown().optional(),
  })

function normalizeSelectedSlots(input: z.infer<typeof chatbotBookingRequestSchema>) {
  return input.selectedSlots?.length ? input.selectedSlots : input.selectedSlot ? [input.selectedSlot] : []
}

function toBookingApiInput(input: z.infer<typeof chatbotBookingRequestSchema>, sessionEmail: string): BookingApiInput {
  const selectedSlots = normalizeSelectedSlots(input)
  const baseInput = {
    projectTitle: input.projectTitle,
    dueDate: input.dueDate ?? "",
    companyName: input.companyName ?? "",
    contactName: input.contactName,
    sessionEmail,
    phone: input.phone ?? "",
    memo: input.memo ?? "",
    agreed: input.agreed,
  }

  if (selectedSlots.length > 0) {
    return bookingApiSchema.parse({
      ...baseInput,
      selectedSlots,
    })
  }

  return {
    ...bookingFormSchema.parse(baseInput),
    selectedSlots: [],
  }
}

function bookingGroupIdFromBody(body: unknown): string | null {
  if (!body || typeof body !== "object") return null
  const value = (body as { bookingGroupId?: unknown }).bookingGroupId
  return typeof value === "string" && value.trim() ? value : null
}

function bodyWithLinkWarning(body: unknown): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body
  return {
    ...body,
    linkWarning: "chat_link_failed",
  }
}

export async function POST(request: NextRequest) {
  const session = await auth()
  const userId = session?.user?.id
  const userEmail = session?.user?.email

  if (!userId || !userEmail) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  }

  const parsed = chatbotBookingRequestSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "invalid_request",
        issues: parsed.error.issues,
      },
      { status: 400 },
    )
  }

  let input: BookingApiInput
  try {
    input = toBookingApiInput(parsed.data, userEmail)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: "invalid_request",
          issues: error.issues,
        },
        { status: 400 },
      )
    }
    return respondInternalError(error, "chatbot.create-booking-from-chat.parse")
  }

  try {
    const result = await createBookingFromApiInput({ input, userId, userEmail })
    const bookingGroupId = bookingGroupIdFromBody(result.body)
    if (result.status >= 200 && result.status < 300 && bookingGroupId && parsed.data.conversationId) {
      try {
        await linkChatToBookingGroup({
          conversationId: parsed.data.conversationId,
          bookingGroupId,
        })
      } catch (error) {
        console.warn("Chatbot booking link failed", {
          bookingGroupId,
          error: error instanceof Error ? error.message : String(error),
        })
        return NextResponse.json(bodyWithLinkWarning(result.body), {
          status: result.status,
          headers: result.headers,
        })
      }
    }

    return NextResponse.json(result.body, { status: result.status, headers: result.headers })
  } catch (error) {
    if (error instanceof BookingConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    return respondChatbotOperationFailure({
      operation: "create-booking-from-chat",
      stage: "booking-save",
      error,
      requestSummary: {
        conversationId: parsed.data.conversationId,
        selectedSlotCount: normalizeSelectedSlots(parsed.data).length,
        hasWorkflowEstimate: Boolean(parsed.data.workflowEstimate),
      },
    })
  }
}
