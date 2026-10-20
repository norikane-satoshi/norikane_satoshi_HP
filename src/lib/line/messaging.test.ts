import { afterEach, describe, expect, it, vi } from "vitest"

import { replyLineText, sendLineBookingReceipt } from "./messaging"

const ORIGINAL_ENV = { ...process.env }

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  vi.unstubAllGlobals()
})

describe("sendLineBookingReceipt", () => {
  it("pushes the receipt to the LINE user", async () => {
    process.env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN = "test-token"
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)

    const result = await sendLineBookingReceipt({
      lineUserId: "Uline123",
      projectTitle: "Color grading",
      scheduleLabel: "2099年6月10日",
    })

    expect(result).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.line.me/v2/bot/message/push",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer test-token" }),
      }),
    )
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.to).toBe("Uline123")
    expect(body.messages[0].text).toContain("日程相談を受け付けました。")
    expect(body.messages[0].text).toContain("希望日: 2099年6月10日")
  })

  it("returns a non-throwing failure when the token is missing", async () => {
    delete process.env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    const result = await sendLineBookingReceipt({
      lineUserId: "Uline123",
      projectTitle: "Color grading",
      scheduleLabel: "2099年6月10日",
    })

    expect(result).toEqual({ ok: false, error: "missing_line_access_token" })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("returns the LINE status on an API error", async () => {
    process.env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN = "test-token"
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("bad", { status: 400 })))

    await expect(sendLineBookingReceipt({ lineUserId: "U1", projectTitle: "", scheduleLabel: "" }))
      .resolves.toEqual({ ok: false, status: 400, error: "bad" })
  })
})

describe("replyLineText", () => {
  it("replies with the given reply token", async () => {
    process.env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN = "test-token"
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)

    await expect(replyLineText("reply-token", "hello")).resolves.toEqual({ ok: true })
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.line.me/v2/bot/message/reply")
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({
      replyToken: "reply-token",
      messages: [{ type: "text", text: "hello" }],
    })
  })
})
