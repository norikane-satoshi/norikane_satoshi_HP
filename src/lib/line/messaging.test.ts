import { afterEach, describe, expect, it, vi } from "vitest"

import { sendLineBookingReceipt } from "./messaging"

const ORIGINAL_ENV = { ...process.env }

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  vi.unstubAllGlobals()
})

describe("sendLineBookingReceipt", () => {
  it("uses reply when a usable reply token is provided", async () => {
    process.env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN = "test-token"
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)

    const result = await sendLineBookingReceipt({
      bookingGroupId: "group_1",
      lineUserId: "Uline123",
      replyToken: "reply-token",
      projectTitle: "Color grading",
      scheduleLabel: "2099年6月10日",
    })

    expect(result).toEqual({ ok: true, method: "reply" })
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.line.me/v2/bot/message/reply",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer test-token" }),
      }),
    )
    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body as string)
    expect(body.replyToken).toBe("reply-token")
    expect(body.messages[0].text).toContain("日程相談を受け付けました。")
    expect(body.messages[0].text).toContain("希望日: 2099年6月10日")
  })

  it("falls back to push when there is no reply token", async () => {
    process.env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN = "test-token"
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)

    const result = await sendLineBookingReceipt({
      bookingGroupId: "group_1",
      lineUserId: "Uline123",
      projectTitle: "Color grading",
      scheduleLabel: "2099年6月10日",
    })

    expect(result).toEqual({ ok: true, method: "push" })
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.line.me/v2/bot/message/push",
      expect.objectContaining({ method: "POST" }),
    )
    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse(init.body as string).to).toBe("Uline123")
  })

  it("returns a non-throwing failure when the token is missing", async () => {
    const result = await sendLineBookingReceipt({
      bookingGroupId: "group_1",
      lineUserId: "Uline123",
      projectTitle: "Color grading",
      scheduleLabel: "2099年6月10日",
    })

    expect(result).toEqual({ ok: false, method: "push", error: "missing_line_access_token" })
  })
})
