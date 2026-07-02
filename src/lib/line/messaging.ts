import { getLineMessagingChannelAccessToken } from "@/lib/line/env"

type LineTextMessage = {
  type: "text"
  text: string
}

type SendLineBookingReceiptArgs = {
  bookingGroupId: string
  lineUserId: string
  replyToken?: string
  projectTitle: string
  scheduleLabel: string
}

export type LineBookingReceiptResult =
  | { ok: true; method: "reply" | "push" }
  | { ok: false; method: "reply" | "push"; status?: number; error: string }

function isUsableReplyToken(replyToken: string | undefined): replyToken is string {
  return Boolean(
    replyToken &&
      replyToken !== "00000000000000000000000000000000" &&
      replyToken !== "ffffffffffffffffffffffffffffffff",
  )
}

function buildBookingReceiptMessage(args: SendLineBookingReceiptArgs): LineTextMessage {
  const projectTitle = args.projectTitle.trim() || "日程相談"
  const scheduleLabel = args.scheduleLabel.trim() || "候補日未選択"
  return {
    type: "text",
    text: [
      "日程相談を受け付けました。",
      "",
      `案件名: ${projectTitle}`,
      `希望日: ${scheduleLabel}`,
      "",
      "内容を確認し、オーナーから折り返しご連絡します。",
    ].join("\n"),
  }
}

async function postLineMessage(input: {
  endpoint: string
  accessToken: string
  body: unknown
  method: "reply" | "push"
}): Promise<LineBookingReceiptResult> {
  try {
    const response = await fetch(input.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input.body),
    })

    if (response.ok) return { ok: true, method: input.method }

    const body = await response.text().catch(() => "")
    return {
      ok: false,
      method: input.method,
      status: response.status,
      error: body || `LINE ${input.method} failed`,
    }
  } catch (error) {
    return {
      ok: false,
      method: input.method,
      error: error instanceof Error ? error.message : `LINE ${input.method} failed`,
    }
  }
}

export async function sendLineBookingReceipt(args: SendLineBookingReceiptArgs): Promise<LineBookingReceiptResult> {
  const accessToken = getLineMessagingChannelAccessToken()
  if (!accessToken) {
    return { ok: false, method: isUsableReplyToken(args.replyToken) ? "reply" : "push", error: "missing_line_access_token" }
  }

  const message = buildBookingReceiptMessage(args)
  if (isUsableReplyToken(args.replyToken)) {
    return postLineMessage({
      endpoint: "https://api.line.me/v2/bot/message/reply",
      accessToken,
      method: "reply",
      body: {
        replyToken: args.replyToken,
        messages: [message],
      },
    })
  }

  return postLineMessage({
    endpoint: "https://api.line.me/v2/bot/message/push",
    accessToken,
    method: "push",
    body: {
      to: args.lineUserId,
      messages: [message],
    },
  })
}
