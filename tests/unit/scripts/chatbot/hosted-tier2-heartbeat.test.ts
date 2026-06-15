import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import {
  buildSmokeRequest,
  evaluateGenerateResponse,
  evaluateHealthResponse,
  runHeartbeat,
  shouldRunGenerate,
  type HeartbeatConfig,
} from "../../../../scripts/chatbot/hosted-tier2-heartbeat"

function config(dir: string, overrides: Partial<HeartbeatConfig> = {}): HeartbeatConfig {
  return {
    workerUrl: "https://worker.example.test",
    token: "secret-token",
    timeoutMs: 1000,
    generateTimeoutMs: 1000,
    generateIntervalMs: 15 * 60_000,
    failureThreshold: 3,
    notificationCooldownMs: 60 * 60_000,
    statePath: join(dir, "state.json"),
    logPath: join(dir, "heartbeat.jsonl"),
    notificationTo: "norikane.satoshi@gmail.com",
    notificationFrom: "noreply@norikane.studio",
    resendApiKey: "resend-secret",
    dryRunNotify: true,
    repair: false,
    forceGenerate: false,
    workerServiceName: "hosted-notion-ai-worker.service",
    chromeServiceName: "hosted-worker-chrome.service",
    ...overrides,
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn(async () => body),
  } as unknown as Response
}

describe("hosted-tier2-heartbeat", () => {
  const dirs: string[] = []

  afterEach(() => {
    vi.restoreAllMocks()
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it("requires health ok, ready status, and available model", () => {
    expect(
      evaluateHealthResponse(200, {
        ok: true,
        status: "ready",
        preferredModel: { available: true },
      }),
    ).toMatchObject({ ok: true })
    expect(evaluateHealthResponse(200, { ok: true, status: "ready" })).toMatchObject({ ok: false })
    expect(
      evaluateHealthResponse(200, {
        ok: true,
        status: "model_unavailable",
        preferredModel: { available: false },
      }),
    ).toMatchObject({ ok: false })
  })

  it("uses the hosted worker generate body shape and checks tier/rawText only", () => {
    expect(buildSmokeRequest()).toMatchObject({
      systemPrompt: expect.any(String),
      messages: [],
      conversationState: expect.any(Object),
      jobContext: expect.any(Object),
    })
    expect(evaluateGenerateResponse(200, { tier: "tier-2-hosted-chrome-notion-ai", rawText: "OK" })).toMatchObject({
      ok: true,
    })
    expect(evaluateGenerateResponse(200, { tier: "tier-2-hosted-chrome-notion-ai", rawText: "" })).toMatchObject({
      ok: false,
    })
  })

  it("runs generate only after the configured interval unless forced", () => {
    const now = new Date("2026-06-15T00:20:00.000Z")
    expect(shouldRunGenerate({ status: "healthy", consecutiveFailures: 0 }, now, 900_000, false)).toBe(true)
    expect(
      shouldRunGenerate(
        { status: "healthy", consecutiveFailures: 0, lastGenerateAt: "2026-06-15T00:10:00.000Z" },
        now,
        900_000,
        false,
      ),
    ).toBe(false)
    expect(
      shouldRunGenerate(
        { status: "healthy", consecutiveFailures: 0, lastGenerateAt: "2026-06-15T00:10:00.000Z" },
        now,
        900_000,
        true,
      ),
    ).toBe(true)
  })

  it("transitions to unhealthy after the failure threshold and emits a dry-run notification", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tier2-heartbeat-"))
    dirs.push(dir)
    const fetchMock = vi.fn(async () => jsonResponse({ ok: false, status: "cdp_connection_refused" }, 200))

    await runHeartbeat(config(dir), { fetch: fetchMock as typeof fetch, now: () => new Date("2026-06-15T00:00:00.000Z"), runCommand: vi.fn() })
    await runHeartbeat(config(dir), { fetch: fetchMock as typeof fetch, now: () => new Date("2026-06-15T00:02:00.000Z"), runCommand: vi.fn() })
    const result = await runHeartbeat(config(dir), {
      fetch: fetchMock as typeof fetch,
      now: () => new Date("2026-06-15T00:04:00.000Z"),
      runCommand: vi.fn(),
    })

    expect(result.status).toBe("unhealthy")
    expect(result.notification).toMatchObject({ kind: "unhealthy", status: "dry-run" })
  })

  it("runs the bounded repair sequence once on an unhealthy transition", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tier2-heartbeat-"))
    dirs.push(dir)
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ ok: false, status: "unknown" }))
      .mockResolvedValueOnce(jsonResponse({ ok: false, status: "unknown" }))
      .mockResolvedValueOnce(jsonResponse({ ok: false, status: "unknown" }))
      .mockResolvedValueOnce(jsonResponse({ ok: false, status: "unknown" }))
      .mockResolvedValueOnce(jsonResponse({ ok: false, status: "unknown" }))
      .mockResolvedValueOnce(jsonResponse({ ok: false, status: "unknown" }))
      .mockResolvedValue(jsonResponse({ ok: false, status: "unknown" }))
    const runCommand = vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" }))

    await runHeartbeat(config(dir, { failureThreshold: 3, repair: true }), {
      fetch: fetchMock as typeof fetch,
      now: () => new Date("2026-06-15T00:00:00.000Z"),
      runCommand,
    })
    await runHeartbeat(config(dir, { failureThreshold: 3, repair: true }), {
      fetch: fetchMock as typeof fetch,
      now: () => new Date("2026-06-15T00:02:00.000Z"),
      runCommand,
    })
    const result = await runHeartbeat(config(dir, { failureThreshold: 3, repair: true }), {
      fetch: fetchMock as typeof fetch,
      now: () => new Date("2026-06-15T00:04:00.000Z"),
      runCommand,
    })

    expect(result.repairActions.map((action) => action.action)).toEqual([
      "ensure-chrome",
      "restart-worker",
      "restart-chrome",
    ])
    expect(runCommand).toHaveBeenCalledTimes(2)
  })
})
