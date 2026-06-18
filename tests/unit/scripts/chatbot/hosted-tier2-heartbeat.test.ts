import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
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
    slackBotToken: undefined,
    slackChannel: undefined,
    slackWebhookUrl: undefined,
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

function trustRuleDeniedResponse(): Response {
  return jsonResponse(
    {
      ok: false,
      tier: "tier-2-hosted-chrome-notion-ai",
      error: {
        code: "invalid-output",
        message:
          'Notion AI response text could not be extracted. preview={"type":"patch-start","data":{"s":[{"type":"error","subType":"trust-rule-denied","message":"AI inference is not allowed."}]}}',
        retryable: false,
      },
    },
    502,
  )
}

function readState(dir: string) {
  return JSON.parse(readFileSync(join(dir, "state.json"), "utf8")) as Record<string, unknown>
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
    expect(
      evaluateGenerateResponse(502, {
        ok: false,
        tier: "tier-2-hosted-chrome-notion-ai",
        error: {
          code: "connection",
          message: "No Notion AI page target was found on the configured Chrome CDP port.",
          retryable: true,
        },
      }),
    ).toMatchObject({
      ok: false,
      status: 502,
      detail:
        "http_status_not_200;error:connection;message:No Notion AI page target was found on the configured Chrome CDP port.;retryable:true",
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

  it("sends unhealthy state changes to Slack bot without leaking secrets", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tier2-heartbeat-"))
    dirs.push(dir)
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ ok: false, status: "cdp_connection_refused" }, 200))
      .mockResolvedValueOnce(jsonResponse({ ok: true, ts: "123.456" }, 200))

    const result = await runHeartbeat(
      config(dir, {
        dryRunNotify: false,
        failureThreshold: 1,
        slackBotToken: "test-slack-token",
        slackChannel: "D0AB0UMUFNZ",
      }),
      {
        fetch: fetchMock as typeof fetch,
        now: () => new Date("2026-06-15T00:00:00.000Z"),
        runCommand: vi.fn(),
      },
    )

    expect(result.notification).toMatchObject({ kind: "unhealthy", status: "sent", detail: "slack_bot:http:200" })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [, slackInput] = fetchMock.mock.calls[1]
    expect(fetchMock.mock.calls[1][0]).toBe("https://slack.com/api/chat.postMessage")
    const slackBody = JSON.parse(String(slackInput?.body)) as { channel: string; text: string }
    expect(slackBody.channel).toBe("D0AB0UMUFNZ")
    expect(slackBody.text).toContain("tier: tier-2-hosted-chrome-notion-ai")
    expect(slackBody.text).toContain("state: unhealthy")
    expect(slackBody.text).toContain("failing_phase: health")
    expect(slackBody.text).toContain("failure_origin: chrome_cdp")
    expect(slackBody.text).toContain("failure_reason: ok:false;status:cdp_connection_refused;model_available:undefined")
    expect(slackBody.text).not.toContain("secret-token")
    expect(slackBody.text).not.toContain("test-slack-token")
    expect(slackBody.text).not.toContain("resend-secret")
  })

  it("includes generate 502 origin and failing phase in Slack notifications", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tier2-heartbeat-"))
    dirs.push(dir)
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ ok: true, status: "ready", preferredModel: { available: true } }, 200))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            ok: false,
            error: {
              code: "connection",
              message: "No Notion AI page target was found on the configured Chrome CDP port.",
              retryable: true,
            },
          },
          502,
        ),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true, ts: "123.456" }, 200))

    const result = await runHeartbeat(
      config(dir, {
        dryRunNotify: false,
        failureThreshold: 1,
        forceGenerate: true,
        repair: false,
        slackBotToken: "test-slack-token",
        slackChannel: "D0AB0UMUFNZ",
      }),
      {
        fetch: fetchMock as typeof fetch,
        now: () => new Date("2026-06-15T14:43:01.000Z"),
        runCommand: vi.fn(),
      },
    )

    expect(result.notification).toMatchObject({ kind: "unhealthy", status: "sent", detail: "slack_bot:http:200" })
    const [, slackInput] = fetchMock.mock.calls[2]
    const slackBody = JSON.parse(String(slackInput?.body)) as { text: string }
    expect(slackBody.text).toContain("failing_phase: generate")
    expect(slackBody.text).toContain("failure_origin: worker_error:connection")
    expect(slackBody.text).toContain("http_status: 502")
    expect(slackBody.text).toContain("error:connection")
    expect(slackBody.text).not.toContain("test-slack-token")
  })

  it("keeps Notion trust-rule generate 502 in warmup without unhealthy notification or restart", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tier2-heartbeat-"))
    dirs.push(dir)
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ ok: true, status: "ready", preferredModel: { available: true } }))
      .mockResolvedValueOnce(trustRuleDeniedResponse())
      .mockResolvedValueOnce(jsonResponse({ ok: true, status: "ready", preferredModel: { available: true } }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, status: "ready", preferredModel: { available: true } }))
    const runCommand = vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" }))

    await runHeartbeat(config(dir, { failureThreshold: 1, repair: true }), {
      fetch: fetchMock as typeof fetch,
      now: () => new Date("2026-06-18T03:19:31.000Z"),
      runCommand,
    })
    await runHeartbeat(config(dir, { failureThreshold: 1, repair: true }), {
      fetch: fetchMock as typeof fetch,
      now: () => new Date("2026-06-18T03:22:01.000Z"),
      runCommand,
    })
    const result = await runHeartbeat(config(dir, { failureThreshold: 1, repair: true }), {
      fetch: fetchMock as typeof fetch,
      now: () => new Date("2026-06-18T03:24:41.000Z"),
      runCommand,
    })

    expect(result.status).toBe("suspect")
    expect(result.notification).toBeUndefined()
    expect(result.repairActions).toEqual([])
    expect(runCommand).not.toHaveBeenCalled()
    expect(result.checks.at(-1)).toMatchObject({
      name: "generate",
      ok: false,
      detail: "warming_after_transient:notion_runtime_trust_rule_denied",
    })
    expect(readState(dir)).toMatchObject({
      status: "suspect",
      incidentClass: "notion_runtime_trust_rule_denied",
      lastGenerateAt: "2026-06-18T03:19:31.000Z",
    })
  })

  it("recovers a transient Notion generate incident only after a later generate succeeds", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tier2-heartbeat-"))
    dirs.push(dir)
    writeFileSync(
      join(dir, "state.json"),
      JSON.stringify({
        status: "suspect",
        consecutiveFailures: 3,
        lastGenerateAt: "2026-06-18T03:19:31.000Z",
        incidentClass: "notion_runtime_trust_rule_denied",
        incidentStartedAt: "2026-06-18T03:19:31.000Z",
      }),
    )
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ ok: true, status: "ready", preferredModel: { available: true } }))
      .mockResolvedValueOnce(jsonResponse({ tier: "tier-2-hosted-chrome-notion-ai", rawText: "OK" }))

    const result = await runHeartbeat(config(dir), {
      fetch: fetchMock as typeof fetch,
      now: () => new Date("2026-06-18T03:35:00.000Z"),
      runCommand: vi.fn(),
    })

    expect(result.status).toBe("healthy")
    expect(result.checks).toContainEqual(
      expect.objectContaining({ name: "generate", ok: true, detail: "tier:tier-2-hosted-chrome-notion-ai;rawText:present" }),
    )
    const state = readState(dir)
    expect(state).toMatchObject({
      status: "healthy",
      consecutiveFailures: 0,
    })
    expect(state).not.toHaveProperty("incidentClass")
    expect(state).not.toHaveProperty("incidentStartedAt")
  })

  it("escalates sustained Notion trust-rule generate failure without restart looping", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tier2-heartbeat-"))
    dirs.push(dir)
    writeFileSync(
      join(dir, "state.json"),
      JSON.stringify({
        status: "suspect",
        consecutiveFailures: 5,
        lastGenerateAt: "2026-06-18T03:19:31.000Z",
        incidentClass: "notion_runtime_trust_rule_denied",
        incidentStartedAt: "2026-06-18T03:19:31.000Z",
      }),
    )
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ ok: true, status: "ready", preferredModel: { available: true } }))
      .mockResolvedValueOnce(trustRuleDeniedResponse())
    const runCommand = vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" }))

    const result = await runHeartbeat(config(dir, { repair: true }), {
      fetch: fetchMock as typeof fetch,
      now: () => new Date("2026-06-18T03:41:00.000Z"),
      runCommand,
    })

    expect(result.status).toBe("unhealthy")
    expect(result.repairActions).toEqual([])
    expect(result.notification).toMatchObject({ kind: "unhealthy", status: "dry-run" })
    expect(runCommand).not.toHaveBeenCalled()
  })

  it("falls back to Resend when Slack primary fails", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tier2-heartbeat-"))
    dirs.push(dir)
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ ok: false, status: "cdp_connection_refused" }, 200))
      .mockResolvedValueOnce(jsonResponse({ ok: false, error: "channel_not_found" }, 200))
      .mockResolvedValueOnce(jsonResponse({ id: "email-id" }, 202))

    const result = await runHeartbeat(
      config(dir, {
        dryRunNotify: false,
        failureThreshold: 1,
        slackBotToken: "test-slack-token",
        slackChannel: "D0AB0UMUFNZ",
      }),
      {
        fetch: fetchMock as typeof fetch,
        now: () => new Date("2026-06-15T00:00:00.000Z"),
        runCommand: vi.fn(),
      },
    )

    expect(result.notification).toMatchObject({
      kind: "unhealthy",
      status: "sent",
      detail: "slack_failed:slack_bot:http:200:channel_not_found;fallback:resend:http:202",
    })
    expect(fetchMock.mock.calls[2][0]).toBe("https://api.resend.com/emails")
  })

  it("rate-limits repeated new unhealthy notifications", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tier2-heartbeat-"))
    dirs.push(dir)
    writeFileSync(
      join(dir, "state.json"),
      JSON.stringify({
        status: "healthy",
        consecutiveFailures: 0,
        lastNotificationAt: "2026-06-15T00:00:00.000Z",
      }),
    )
    const fetchMock = vi.fn(async () => jsonResponse({ ok: false, status: "cdp_connection_refused" }, 200))

    const result = await runHeartbeat(config(dir, { failureThreshold: 1 }), {
      fetch: fetchMock as typeof fetch,
      now: () => new Date("2026-06-15T00:10:00.000Z"),
      runCommand: vi.fn(),
    })

    expect(result.notification).toMatchObject({ kind: "unhealthy", status: "skipped", detail: "rate_limited" })
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
