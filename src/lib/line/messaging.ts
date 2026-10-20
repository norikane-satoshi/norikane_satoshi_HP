import { getLineMessagingChannelAccessToken } from "@/lib/line/env"

export type LineSendResult = { ok: true } | { ok: false; status?: number; error: string }

async function postLineMessage(path: "reply" | "push", body: Record<string, unknown>): Promise<LineSendResult> {
  const accessToken = getLineMessagingChannelAccessToken()
  if (!accessToken) return { ok: false, error: "missing_line_access_token" }

  try {
    const response = await fetch(`https://api.line.me/v2/bot/message/${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    })
    if (response.ok) return { ok: true }
    const text = await response.text().catch(() => "")
    return { ok: false, status: response.status, error: text || `LINE ${path} failed` }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : `LINE ${path} failed` }
  }
}

/** Answers a webhook event. Reply tokens exist only on webhook events. */
export function replyLineText(replyToken: string, text: string): Promise<LineSendResult> {
  return postLineMessage("reply", { replyToken, messages: [{ type: "text", text }] })
}

export function sendLineBookingReceipt(args: {
  lineUserId: string
  projectTitle: string
  scheduleLabel: string
}): Promise<LineSendResult> {
  const text = [
    "日程相談を受け付けました。",
    "",
    `案件名: ${args.projectTitle.trim() || "日程相談"}`,
    `希望日: ${args.scheduleLabel.trim() || "候補日未選択"}`,
    "",
    "内容を確認し、オーナーから折り返しご連絡します。",
  ].join("\n")
  return postLineMessage("push", { to: args.lineUserId, messages: [{ type: "text", text }] })
}
