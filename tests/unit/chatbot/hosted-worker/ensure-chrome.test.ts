import { describe, expect, it, vi } from "vitest"

import {
  ensureHostedWorkerChrome,
  inspectHostedWorkerChrome,
} from "@/lib/chatbot/hosted-worker"

const cdpBaseUrl = "http://127.0.0.1:9223"
const targetUrlIncludes = "https://www.notion.so/chat?t=36b13ee3141a8073885d00a99ebb676c&wfv=chat"

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: vi.fn(async () => body),
  } as unknown as Response
}

function fetchForTargets(targets: unknown[]) {
  return vi.fn(async (input: string) => {
    if (input.endsWith("/json/version")) return jsonResponse({ Browser: "Chrome" })
    if (input.endsWith("/json/list")) return jsonResponse(targets)
    if (input.includes("/json/new")) return jsonResponse({})
    return jsonResponse({}, { ok: false, status: 404 })
  })
}

describe("hosted worker Chrome inspection", () => {
  it("classifies CDP connection refusal without opening auth UI", async () => {
    const fetchClient = vi.fn(async () => {
      throw new Error("ECONNREFUSED")
    })

    await expect(
      inspectHostedWorkerChrome({ cdpBaseUrl, targetUrlIncludes, fetchClient }),
    ).resolves.toMatchObject({
      ok: false,
      status: "cdp_connection_refused",
      cdp: { reachable: false },
      notionTarget: { found: false },
    })
  })

  it("classifies login redirect as manual login required", async () => {
    const fetchClient = fetchForTargets([
      { id: "login", type: "page", url: "https://www.notion.so/login" },
    ])

    await expect(
      inspectHostedWorkerChrome({ cdpBaseUrl, targetUrlIncludes, fetchClient }),
    ).resolves.toMatchObject({
      ok: false,
      status: "manual_login_required",
      action: "manual_pending",
      notionTarget: { found: true, loginRedirect: true },
    })
  })

  it("classifies target missing and can open the configured thread", async () => {
    const fetchClient = fetchForTargets([])
    const chromeLauncher = vi.fn(async () => undefined)

    await expect(
      ensureHostedWorkerChrome({
        cdpBaseUrl,
        targetUrlIncludes,
        fetchClient,
        chromeLauncher,
        waitMs: 1,
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "target_missing",
    })
    expect(fetchClient).toHaveBeenCalledWith(
      expect.stringContaining("/json/new?"),
      expect.objectContaining({ method: "PUT" }),
    )
    expect(chromeLauncher).not.toHaveBeenCalled()
  })

  it("classifies mismatched Notion AI target", async () => {
    const fetchClient = fetchForTargets([
      { id: "wrong", type: "page", url: "https://www.notion.so/chat?t=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    ])

    await expect(
      inspectHostedWorkerChrome({ cdpBaseUrl, targetUrlIncludes, fetchClient }),
    ).resolves.toMatchObject({
      ok: false,
      status: "target_url_mismatch",
      notionTarget: { found: true, targetUrlMatches: false },
    })
  })

  it("classifies unavailable preferred model after target match", async () => {
    const fetchClient = fetchForTargets([
      { id: "ready", type: "page", url: targetUrlIncludes },
    ])

    await expect(
      inspectHostedWorkerChrome({
        cdpBaseUrl,
        targetUrlIncludes,
        fetchClient,
        runtimeInspector: async () => ({
          targetUrl: targetUrlIncludes,
          preferredModelAvailable: false,
          selectedModel: "other-model",
        }),
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "model_unavailable",
      preferredModel: { available: false, selectedModel: "other-model" },
    })
  })

  it("returns ready when target and preferred model are available", async () => {
    const fetchClient = fetchForTargets([
      { id: "ready", type: "page", url: targetUrlIncludes },
    ])

    await expect(
      inspectHostedWorkerChrome({
        cdpBaseUrl,
        targetUrlIncludes,
        fetchClient,
        runtimeInspector: async () => ({
          targetUrl: targetUrlIncludes,
          preferredModelAvailable: true,
          selectedModel: "apricot-sorbet-high",
        }),
      }),
    ).resolves.toMatchObject({
      ok: true,
      status: "ready",
      notionTarget: { found: true, targetUrlMatches: true },
      preferredModel: { available: true },
    })
  })
})
