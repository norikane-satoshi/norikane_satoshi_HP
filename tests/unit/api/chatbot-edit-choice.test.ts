import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({ load: vi.fn(), auth: vi.fn(), recover: vi.fn(), knowledge: vi.fn() }))
vi.mock("@/auth", () => ({ auth: mocks.auth }))
vi.mock("@/lib/chatbot/server/repository", () => ({ loadConversationById: mocks.load }))
vi.mock("@/lib/chatbot/server/message-handler", () => ({ recoverHistoricalChoiceAnswer: mocks.recover }))
vi.mock("@/lib/chatbot/server/notion-knowledge-sync", () => ({ loadLatestChatbotKnowledgeSnapshot: mocks.knowledge }))
import { POST } from "@/app/api/chatbot/edit-choice/route"
function request(cookie = "session") {
  return new NextRequest("http://localhost/api/chatbot/edit-choice", { method: "POST", headers: cookie ? { cookie: `chatbot_session_id=${cookie}` } : {}, body: JSON.stringify({ conversationId: "conversation", messageId: "old" }) })
}
describe("historical choice lookup ownership", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.load.mockResolvedValue({ context: { sessionId: "session" } }); mocks.auth.mockResolvedValue(null); mocks.recover.mockReturnValue(undefined); mocks.knowledge.mockResolvedValue(undefined) })
  it("requires the conversation cookie", async () => { expect((await POST(request(""))).status).toBe(401); expect(mocks.load).not.toHaveBeenCalled() })
  it("rejects another session before replay", async () => { expect((await POST(request("other"))).status).toBe(403); expect(mocks.recover).not.toHaveBeenCalled() })
  it.each([null, { user: { id: "other" } }])("rejects another account even with the cookie: %s", async session => {
    mocks.load.mockResolvedValue({ context: { sessionId: "session", userId: "owner" } }); mocks.auth.mockResolvedValue(session)
    expect((await POST(request())).status).toBe(403); expect(mocks.knowledge).not.toHaveBeenCalled()
  })
  it("returns no panel for free text without caching", async () => { const response = await POST(request()); expect(response.status).toBe(200); expect(await response.json()).toEqual({ choiceAnswer: null }); expect(response.headers.get("cache-control")).toBe("no-store") })
  it("returns the reconstructed panel for its owner", async () => {
    mocks.load.mockResolvedValue({ context: { sessionId: "session", userId: "owner" } }); mocks.auth.mockResolvedValue({ user: { id: "owner" } })
    const answer = { selectedIds: ["web"] }; mocks.recover.mockReturnValue(answer)
    expect(await (await POST(request())).json()).toEqual({ choiceAnswer: answer })
  })
})
