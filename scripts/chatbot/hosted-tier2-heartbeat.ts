import { spawn } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

type HeartbeatStatus = "healthy" | "suspect" | "unhealthy"
type NotificationKind = "unhealthy" | "recovered" | "test"
type IncidentClass =
  | "none"
  | "chrome_cdp"
  | "notion_model"
  | "notion_runtime_trust_rule_denied"
  | "worker_error:auth"
  | "worker_error:connection"
  | "worker_error:invalid-output"
  | "worker_http_502"
  | "http"
  | "timeout"
  | "unknown"

export type HeartbeatState = {
  status: HeartbeatStatus
  consecutiveFailures: number
  lastGenerateAt?: string
  lastNotificationAt?: string
  lastNotificationKind?: NotificationKind
  lastRepairAt?: string
  incidentClass?: IncidentClass
  incidentStartedAt?: string
  lastTransientGenerateFailureAt?: string
}

type CheckResult = {
  name: "health" | "generate"
  ok: boolean
  status?: number
  detail: string
  durationMs?: number
}

type RepairAction = {
  action: "ensure-chrome" | "restart-worker" | "restart-chrome"
  ok: boolean
  detail: string
}

type NotificationResult = {
  kind: NotificationKind
  status: "sent" | "skipped" | "dry-run" | "failed"
  detail: string
}

export type HeartbeatConfig = {
  workerUrl: string
  token?: string
  timeoutMs: number
  generateTimeoutMs: number
  generateIntervalMs: number
  failureThreshold: number
  transientGenerateFailureThreshold: number
  notificationCooldownMs: number
  statePath: string
  logPath: string
  notificationTo: string
  notificationFrom?: string
  resendApiKey?: string
  slackWebhookUrl?: string
  slackBotToken?: string
  slackChannel?: string
  dryRunNotify: boolean
  repair: boolean
  forceGenerate: boolean
  workerServiceName: string
  chromeServiceName: string
}

type RuntimeDeps = {
  fetch: typeof fetch
  now: () => Date
  runCommand: (command: string, args: string[]) => Promise<{ exitCode: number | null; stdout: string; stderr: string }>
}

type HeartbeatResult = {
  ok: boolean
  status: HeartbeatStatus
  checks: CheckResult[]
  repairActions: RepairAction[]
  notification?: NotificationResult
  statePath: string
  logPath: string
}

const tier = "tier-2-hosted-chrome-notion-ai"
const defaultWorkerUrl = "http://127.0.0.1:8787"
const defaultNotificationTo = "norikane.satoshi@gmail.com"
const defaultTimeoutMs = 10_000
const defaultGenerateTimeoutMs = 60_000
const defaultGenerateIntervalMs = 10 * 60_000
const defaultNotificationCooldownMs = 60 * 60_000
const defaultFailureThreshold = 1
const defaultTransientGenerateFailureThreshold = 3
const repairCooldownMs = 20 * 60_000
const stateDir = path.join(homedir(), ".local", "state", "norikane_satoshi_hp")
const defaultStatePath = path.join(stateDir, "hosted-tier2-heartbeat-state.json")
const defaultLogPath = path.join(stateDir, "hosted-tier2-heartbeat.jsonl")
const defaultEnvPath = path.join(homedir(), ".config", "norikane", "hosted-tier2-heartbeat.env")
const localEnvPath = path.join(process.cwd(), ".env.local")
const bearerPrefix = "Bearer "

export async function runHeartbeat(
  config: HeartbeatConfig,
  deps: RuntimeDeps = defaultDeps(),
): Promise<HeartbeatResult> {
  if (!config.token) throw new Error("Hosted Tier2 worker token env is missing.")

  const previous = await readState(config.statePath)
  const checks: CheckResult[] = []
  const repairActions: RepairAction[] = []
  const now = deps.now()

  const health = await checkHealth(config, deps.fetch)
  checks.push(health)

  let generate: CheckResult | undefined
  if (health.ok && shouldRunGenerate(previous, now, config.generateIntervalMs, config.forceGenerate)) {
    generate = await checkGenerate(config, deps.fetch)
    checks.push(generate)
  }

  const primaryFailure = checks.find((check) => !check.ok)
  const incidentClass = classifyFailureOrigin(primaryFailure)
  const transientGenerateFailure = isTransientGenerateFailure(primaryFailure)
  const delayedTransientGenerateFailure =
    primaryFailure?.name === "generate" && incidentClass === "worker_error:invalid-output"
  let ok = checks.every((check) => check.ok)
  let nextState = buildNextState({
    previous,
    ok,
    now,
    threshold: effectiveFailureThreshold(config, delayedTransientGenerateFailure),
    generateSucceeded: generate?.ok === true,
    generateFailed: generate?.ok === false,
    incidentClass,
    transientGenerateFailure,
  })

  if (
    !ok &&
    nextState.status === "unhealthy" &&
    previous.status !== "unhealthy" &&
    config.repair &&
    shouldAttemptRepair(previous, nextState, checks, now)
  ) {
    const repaired = await attemptRepair(config, deps, repairActions, checks)
    ok = repaired
    nextState = buildNextState({
      previous,
      ok,
      now,
      threshold: effectiveFailureThreshold(config, delayedTransientGenerateFailure),
      generateSucceeded: generate?.ok === true,
      generateFailed: generate?.ok === false,
      incidentClass,
      transientGenerateFailure,
    })
    if (repairActions.length > 0) nextState.lastRepairAt = now.toISOString()
  }

  const notification = await maybeNotify(config, previous, nextState, checks, repairActions, deps.fetch, now)
  if (notification?.status === "sent" || notification?.status === "dry-run") {
    nextState.lastNotificationAt = now.toISOString()
    nextState.lastNotificationKind = notification.kind
  }

  await writeState(config.statePath, nextState)
  await writeLog(config.logPath, {
    ts: now.toISOString(),
    event: "hosted_tier2_heartbeat",
    tier,
    ok,
    status: nextState.status,
    incident: buildHeartbeatIncident(checks, repairActions),
    checks,
    repairActions,
    notification,
  })

  return {
    ok,
    status: nextState.status,
    checks,
    repairActions,
    notification,
    statePath: config.statePath,
    logPath: config.logPath,
  }
}

export function evaluateHealthResponse(status: number, body: unknown): CheckResult {
  if (status !== 200) return { name: "health", ok: false, status, detail: "http_status_not_200" }
  if (!isRecord(body)) return { name: "health", ok: false, status, detail: "invalid_json_shape" }

  const ok = body.ok === true
  const ready = body.status === "ready"
  const modelAvailable = readModelAvailable(body)
  if (!ok || !ready || modelAvailable !== true) {
    return {
      name: "health",
      ok: false,
      status,
      detail: `ok:${String(body.ok)};status:${String(body.status)};model_available:${String(modelAvailable)}`,
    }
  }

  return { name: "health", ok: true, status, detail: "ok:true;status:ready;model_available:true" }
}

export function evaluateGenerateResponse(status: number, body: unknown): CheckResult {
  if (status !== 200) {
    return {
      name: "generate",
      ok: false,
      status,
      detail: `http_status_not_200${publicResponseErrorDetail(body)}`,
    }
  }
  if (!isRecord(body)) return { name: "generate", ok: false, status, detail: "invalid_json_shape" }

  const rawTextPresent = typeof body.rawText === "string" && body.rawText.trim().length > 0
  const tierMatches = body.tier === tier
  return {
    name: "generate",
    ok: rawTextPresent && tierMatches,
    status,
    detail: `tier:${String(body.tier)};rawText:${rawTextPresent ? "present" : "missing"}`,
  }
}

export function shouldRunGenerate(
  state: HeartbeatState,
  now: Date,
  intervalMs: number,
  forceGenerate: boolean,
): boolean {
  if (forceGenerate) return true
  if (!state.lastGenerateAt) return true
  const last = Date.parse(state.lastGenerateAt)
  return !Number.isFinite(last) || now.getTime() - last >= intervalMs
}

export function buildSmokeRequest() {
  return {
    systemPrompt: "新規映像案件の相談受付として、所要日数だけを短く返してください。",
    messages: [],
    latestUserMessage: "Web CM 30秒、追加作業なしの相談です。",
    conversationState: {
      hasFinalMedium: true,
      hasJobKind: true,
      hasAdditionalWork: true,
      hasDocumentaryAttachments: true,
      hasWorkSite: true,
      hasReferenceUrls: false,
      hasContactEmail: false,
      hasDesiredSchedule: false,
      turnCount: 1,
    },
    jobContext: {
      jobKind: "cm-30s",
      finalMedium: "web",
      projectLengthMinutes: 0.5,
      additionalWork: [],
      workSite: "remote-grading",
      documentaryAttachment: { kind: "none" },
    },
    temperature: 0,
    maxOutputTokens: 128,
  }
}

async function checkHealth(config: HeartbeatConfig, fetchClient: typeof fetch): Promise<CheckResult> {
  const response = await requestJson(`${trimTrailingSlash(config.workerUrl)}/health`, config.token, {
    method: "GET",
    timeoutMs: config.timeoutMs,
    fetchClient,
  })
  if (!response.ok) return { name: "health", ok: false, status: response.status, detail: response.detail, durationMs: response.durationMs }
  return { ...evaluateHealthResponse(response.status, response.body), durationMs: response.durationMs }
}

async function checkGenerate(config: HeartbeatConfig, fetchClient: typeof fetch): Promise<CheckResult> {
  const response = await requestJson(`${trimTrailingSlash(config.workerUrl)}/generate`, config.token, {
    method: "POST",
    timeoutMs: config.generateTimeoutMs,
    fetchClient,
    body: JSON.stringify(buildSmokeRequest()),
  })
  if (!response.ok) return { name: "generate", ok: false, status: response.status, detail: response.detail, durationMs: response.durationMs }
  return { ...evaluateGenerateResponse(response.status, response.body), durationMs: response.durationMs }
}

async function attemptRepair(
  config: HeartbeatConfig,
  deps: RuntimeDeps,
  repairActions: RepairAction[],
  checks: CheckResult[],
): Promise<boolean> {
  repairActions.push(await postEnsureChrome(config, deps.fetch))
  if (await repaired(config, deps.fetch, checks)) return true

  repairActions.push(await restartService(config.workerServiceName, deps.runCommand))
  if (await repaired(config, deps.fetch, checks)) return true

  repairActions.push(await restartService(config.chromeServiceName, deps.runCommand))
  return repaired(config, deps.fetch, checks)
}

async function repaired(config: HeartbeatConfig, fetchClient: typeof fetch, checks: CheckResult[]): Promise<boolean> {
  const health = await checkHealth(config, fetchClient)
  checks.push({ ...health, name: "health", detail: `post_repair:${health.detail}` })
  if (!health.ok) return false
  const generate = await checkGenerate(config, fetchClient)
  checks.push({ ...generate, name: "generate", detail: `post_repair:${generate.detail}` })
  return generate.ok
}

async function postEnsureChrome(config: HeartbeatConfig, fetchClient: typeof fetch): Promise<RepairAction> {
  const response = await requestJson(`${trimTrailingSlash(config.workerUrl)}/ensure-chrome`, config.token, {
    method: "POST",
    timeoutMs: config.timeoutMs,
    fetchClient,
  })
  if (!response.ok) return { action: "ensure-chrome", ok: false, detail: response.detail }
  const ready = isRecord(response.body) && response.body.ok === true && response.body.status === "ready"
  return { action: "ensure-chrome", ok: ready, detail: ready ? "ready" : "not_ready" }
}

async function restartService(
  serviceName: string,
  runCommand: RuntimeDeps["runCommand"],
): Promise<RepairAction> {
  const result = await runCommand("systemctl", ["--user", "restart", serviceName])
  return {
    action: serviceName.includes("chrome") ? "restart-chrome" : "restart-worker",
    ok: result.exitCode === 0,
    detail: result.exitCode === 0 ? serviceName : `exit:${String(result.exitCode)}`,
  }
}

async function maybeNotify(
  config: HeartbeatConfig,
  previous: HeartbeatState,
  next: HeartbeatState,
  checks: CheckResult[],
  repairActions: RepairAction[],
  fetchClient: typeof fetch,
  now: Date,
): Promise<NotificationResult | undefined> {
  if (next.status === "unhealthy" && previous.status !== "unhealthy") {
    if (!canNotify(previous.lastNotificationAt, now, config.notificationCooldownMs)) {
      return { kind: "unhealthy", status: "skipped", detail: "rate_limited" }
    }
    return sendNotification(config, "unhealthy", checks, repairActions, fetchClient, now)
  }

  if (
    next.status === "healthy" &&
    previous.status === "unhealthy" &&
    previous.lastNotificationKind === "unhealthy"
  ) {
    return sendNotification(config, "recovered", checks, repairActions, fetchClient, now)
  }

  return undefined
}

async function sendNotification(
  config: HeartbeatConfig,
  kind: NotificationKind,
  checks: CheckResult[],
  repairActions: RepairAction[],
  fetchClient: typeof fetch,
  now: Date,
): Promise<NotificationResult> {
  const message = buildNotificationMessage(config, kind, checks, repairActions, now)
  const slackRoute = resolveSlackRoute(config)
  if (config.dryRunNotify) return { kind, status: "dry-run", detail: slackRoute ?? `resend:${config.notificationTo}` }

  if (slackRoute) {
    const slack = await sendSlackNotification(config, slackRoute, message, fetchClient, kind)
    if (slack.status === "sent") return slack
    const fallback = await sendResendNotification(config, kind, message, fetchClient)
    if (fallback.status !== "skipped") {
      return {
        kind,
        status: fallback.status,
        detail: `slack_failed:${slack.detail};fallback:${fallback.detail}`,
      }
    }
    return slack
  }

  return sendResendNotification(config, kind, message, fetchClient)
}

function buildNotificationMessage(
  config: HeartbeatConfig,
  kind: NotificationKind,
  checks: CheckResult[],
  repairActions: RepairAction[],
  now: Date,
): string {
  const primaryFailure = checks.find((check) => !check.ok)
  return [
    `tier: ${tier}`,
    `state: ${kind}`,
    `detected_at_jst: ${formatJst(now)}`,
    `failing_phase: ${primaryFailure?.name ?? "none"}`,
    `failure_origin: ${classifyFailureOrigin(primaryFailure)}`,
    `failure_reason: ${primaryFailure ? sanitizePublicText(primaryFailure.detail) : "none"}`,
    `http_status: ${primaryFailure?.status ?? checks[0]?.status ?? "none"}`,
    `incident_kind: ${buildHeartbeatIncident(checks, repairActions)?.kind ?? "none"}`,
    `duration_ms: ${primaryFailure?.durationMs ?? "none"}`,
    `checks: ${checks.map((check) => `${check.name}:${check.status ?? 0}:${sanitizePublicText(check.detail)}`).join(", ") || "test"}`,
    `repair_actions: ${repairActions.map((action) => `${action.action}:${action.ok}`).join(", ") || "none"}`,
    `current_state: ${kind}`,
    `log_path: ${config.logPath}`,
  ].join("\n")
}

type SlackRoute = "slack_webhook" | "slack_bot"

function resolveSlackRoute(config: HeartbeatConfig): SlackRoute | undefined {
  if (config.slackWebhookUrl) return "slack_webhook"
  if (config.slackBotToken && config.slackChannel) return "slack_bot"
  return undefined
}

async function sendSlackNotification(
  config: HeartbeatConfig,
  route: SlackRoute,
  text: string,
  fetchClient: typeof fetch,
  kind: NotificationKind,
): Promise<NotificationResult> {
  try {
    if (route === "slack_webhook") {
      const response = await fetchClient(config.slackWebhookUrl as string, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, unfurl_links: false, unfurl_media: false }),
      })
      return { kind, status: response.ok ? "sent" : "failed", detail: `slack_webhook:http:${response.status}` }
    }

    const response = await fetchClient("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        authorization: `${bearerPrefix}${config.slackBotToken}`,
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        channel: config.slackChannel,
        text,
        unfurl_links: false,
        unfurl_media: false,
      }),
    })
    const body = (await response.json().catch(() => undefined)) as unknown
    const ok = response.ok && isRecord(body) && body.ok === true
    const error = isRecord(body) && typeof body.error === "string" ? `:${body.error}` : ""
    return { kind, status: ok ? "sent" : "failed", detail: `slack_bot:http:${response.status}${error}` }
  } catch (error) {
    return { kind, status: "failed", detail: `slack:${publicError(error)}` }
  }
}

async function sendResendNotification(
  config: HeartbeatConfig,
  kind: NotificationKind,
  text: string,
  fetchClient: typeof fetch,
): Promise<NotificationResult> {
  if (!config.resendApiKey || !config.notificationFrom) {
    return { kind, status: "skipped", detail: "missing_resend_env" }
  }

  const subject =
    kind === "recovered"
      ? "[norikane HP] Tier2 hosted worker recovered"
      : kind === "test"
        ? "[norikane HP] Tier2 hosted worker heartbeat test"
        : "[norikane HP] Tier2 hosted worker unhealthy"

  try {
    const response = await fetchClient("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `${bearerPrefix}${config.resendApiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: config.notificationFrom,
        to: [config.notificationTo],
        subject,
        text,
      }),
    })
    return {
      kind,
      status: response.ok ? "sent" : "failed",
      detail: `resend:http:${response.status}`,
    }
  } catch (error) {
    return { kind, status: "failed", detail: `resend:${publicError(error)}` }
  }
}

function buildNextState(input: {
  previous: HeartbeatState
  ok: boolean
  now: Date
  threshold: number
  generateSucceeded: boolean
  generateFailed: boolean
  incidentClass: IncidentClass
  transientGenerateFailure: boolean
}): HeartbeatState {
  const { previous, ok, now, threshold, generateSucceeded, generateFailed, incidentClass, transientGenerateFailure } =
    input

  if (ok) {
    return {
      ...previous,
      status: "healthy",
      consecutiveFailures: 0,
      lastGenerateAt: generateSucceeded ? now.toISOString() : previous.lastGenerateAt,
      incidentClass: undefined,
      incidentStartedAt: undefined,
    }
  }

  const consecutiveFailures = previous.consecutiveFailures + 1
  const existingIncidentStartedAt =
    previous.status === "healthy" || previous.incidentClass !== incidentClass
      ? undefined
      : previous.incidentStartedAt
  const incidentStartedAt = existingIncidentStartedAt ?? now.toISOString()
  const status = consecutiveFailures >= threshold ? "unhealthy" : "suspect"

  return {
    ...previous,
    status,
    consecutiveFailures,
    incidentClass,
    incidentStartedAt,
    lastGenerateAt: generateFailed && transientGenerateFailure ? now.toISOString() : previous.lastGenerateAt,
    lastTransientGenerateFailureAt:
      generateFailed && transientGenerateFailure ? now.toISOString() : previous.lastTransientGenerateFailureAt,
  }
}

function effectiveFailureThreshold(config: HeartbeatConfig, transientGenerateFailure: boolean): number {
  return transientGenerateFailure
    ? Math.max(config.failureThreshold, config.transientGenerateFailureThreshold)
    : config.failureThreshold
}

function shouldAttemptRepair(
  previous: HeartbeatState,
  nextState: HeartbeatState,
  checks: CheckResult[],
  now: Date,
): boolean {
  if (isTransientGenerateFailure(checks.find((check) => !check.ok))) return false
  if (previous.status === "healthy") return true

  if (!nextState.lastRepairAt) return true
  const lastRepairAt = Date.parse(nextState.lastRepairAt)
  return !Number.isFinite(lastRepairAt) || now.getTime() - lastRepairAt >= repairCooldownMs
}

async function requestJson(
  url: string,
  token: string | undefined,
  input: {
    method: "GET" | "POST"
    timeoutMs: number
    fetchClient: typeof fetch
    body?: string
  },
): Promise<
  | { ok: true; status: number; body: unknown; durationMs: number }
  | { ok: false; status?: number; detail: string; durationMs: number }
> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), input.timeoutMs)
  const startedAt = Date.now()
  try {
    const response = await input.fetchClient(url, {
      method: input.method,
      signal: controller.signal,
      headers: {
        authorization: `${bearerPrefix}${token}`,
        ...(input.body ? { "content-type": "application/json" } : {}),
      },
      body: input.body,
    })
    const body = await response.json().catch(() => undefined)
    return { ok: true, status: response.status, body, durationMs: Date.now() - startedAt }
  } catch (error) {
    return { ok: false, detail: publicError(error), durationMs: Date.now() - startedAt }
  } finally {
    clearTimeout(timer)
  }
}

function buildHeartbeatIncident(
  checks: CheckResult[],
  repairActions: RepairAction[],
): Record<string, unknown> | undefined {
  const health = checks.find((check) => check.name === "health" && !check.detail.startsWith("post_repair:"))
  const generate = checks.find((check) => check.name === "generate" && !check.detail.startsWith("post_repair:"))
  const primaryFailure = checks.find((check) => !check.ok)
  if (!primaryFailure) return undefined

  return {
    kind: health?.ok === true && generate?.ok === false ? "health_ok_generate_failed" : "check_failed",
    operation: "hosted-tier2-heartbeat",
    phase: primaryFailure.name,
    httpStatus: primaryFailure.status,
    failureOrigin: classifyFailureOrigin(primaryFailure),
    failureReason: sanitizePublicText(primaryFailure.detail),
    durationMs: primaryFailure.durationMs,
    repairAttempted: repairActions.length > 0,
    repairActions: repairActions.map((action) => ({ action: action.action, ok: action.ok })),
  }
}

async function readState(statePath: string): Promise<HeartbeatState> {
  try {
    const parsed = JSON.parse(await readFile(statePath, "utf8")) as Partial<HeartbeatState>
    return {
      status: isHeartbeatStatus(parsed.status) ? parsed.status : "healthy",
      consecutiveFailures: Number.isFinite(parsed.consecutiveFailures) ? Number(parsed.consecutiveFailures) : 0,
      lastGenerateAt: stringOrUndefined(parsed.lastGenerateAt),
      lastNotificationAt: stringOrUndefined(parsed.lastNotificationAt),
      lastNotificationKind: isNotificationKind(parsed.lastNotificationKind) ? parsed.lastNotificationKind : undefined,
      lastRepairAt: stringOrUndefined(parsed.lastRepairAt),
      incidentClass: isIncidentClass(parsed.incidentClass) ? parsed.incidentClass : undefined,
      incidentStartedAt: stringOrUndefined(parsed.incidentStartedAt),
      lastTransientGenerateFailureAt: stringOrUndefined(parsed.lastTransientGenerateFailureAt),
    }
  } catch {
    return { status: "healthy", consecutiveFailures: 0 }
  }
}

async function writeState(statePath: string, state: HeartbeatState): Promise<void> {
  await mkdir(path.dirname(statePath), { recursive: true })
  await writeFile(statePath, JSON.stringify(state, null, 2) + "\n", "utf8")
}

async function writeLog(logPath: string, record: unknown): Promise<void> {
  await mkdir(path.dirname(logPath), { recursive: true })
  await appendFile(logPath, JSON.stringify(record) + "\n", "utf8")
}

function defaultDeps(): RuntimeDeps {
  return {
    fetch,
    now: () => new Date(),
    runCommand,
  }
}

function runCommand(command: string, args: string[]): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk)
    })
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk)
    })
    child.on("error", reject)
    child.on("close", (exitCode) => resolve({ exitCode, stdout, stderr }))
  })
}

function resolveConfig(argv: string[]): { config: HeartbeatConfig; sendTestNotification: boolean } {
  const args = parseArgs(argv)
  loadEnvFiles([args["env-file"], process.env.CHATBOT_HOSTED_TIER2_HEARTBEAT_ENV_FILE, defaultEnvPath, localEnvPath])

  return {
    sendTestNotification: args["send-test-notification"] === "true",
    config: {
      workerUrl:
        args["worker-url"] ??
        process.env.CHATBOT_HOSTED_TIER2_HEARTBEAT_WORKER_URL ??
        process.env.CHATBOT_HOSTED_NOTION_AI_WORKER_URL ??
        defaultWorkerUrl,
      token:
        process.env.CHATBOT_HOSTED_TIER2_HEARTBEAT_TOKEN ??
        process.env.CHATBOT_HOSTED_NOTION_AI_WORKER_TOKEN ??
        process.env.CHATBOT_HOSTED_WORKER_TOKEN,
      timeoutMs: readPositiveInt(args["timeout-ms"] ?? process.env.CHATBOT_HOSTED_TIER2_HEARTBEAT_TIMEOUT_MS, defaultTimeoutMs),
      generateTimeoutMs: readPositiveInt(
        args["generate-timeout-ms"] ?? process.env.CHATBOT_HOSTED_TIER2_HEARTBEAT_GENERATE_TIMEOUT_MS,
        defaultGenerateTimeoutMs,
      ),
      generateIntervalMs: readPositiveInt(
        args["generate-interval-ms"] ?? process.env.CHATBOT_HOSTED_TIER2_HEARTBEAT_GENERATE_INTERVAL_MS,
        defaultGenerateIntervalMs,
      ),
      failureThreshold: readPositiveInt(
        args["failure-threshold"] ?? process.env.CHATBOT_HOSTED_TIER2_HEARTBEAT_FAILURE_THRESHOLD,
        defaultFailureThreshold,
      ),
      transientGenerateFailureThreshold: readPositiveInt(
        args["transient-generate-failure-threshold"] ??
          process.env.CHATBOT_HOSTED_TIER2_HEARTBEAT_TRANSIENT_GENERATE_FAILURE_THRESHOLD,
        defaultTransientGenerateFailureThreshold,
      ),
      notificationCooldownMs: readPositiveInt(
        args["notification-cooldown-ms"] ?? process.env.CHATBOT_HOSTED_TIER2_HEARTBEAT_NOTIFICATION_COOLDOWN_MS,
        defaultNotificationCooldownMs,
      ),
      statePath: args["state-path"] ?? process.env.CHATBOT_HOSTED_TIER2_HEARTBEAT_STATE_PATH ?? defaultStatePath,
      logPath: args["log-path"] ?? process.env.CHATBOT_HOSTED_TIER2_HEARTBEAT_LOG_PATH ?? defaultLogPath,
      notificationTo:
        args["notification-to"] ??
        process.env.CHATBOT_HOSTED_TIER2_HEARTBEAT_NOTIFY_EMAIL ??
        defaultNotificationTo,
      notificationFrom:
        process.env.CHATBOT_HOSTED_TIER2_HEARTBEAT_FROM_EMAIL ?? process.env.RESEND_FROM_EMAIL,
      resendApiKey: process.env.RESEND_API_KEY,
      slackWebhookUrl: process.env.CHATBOT_HOSTED_TIER2_HEARTBEAT_SLACK_WEBHOOK_URL,
      slackBotToken: process.env.CHATBOT_HOSTED_TIER2_HEARTBEAT_SLACK_BOT_TOKEN ?? process.env.SLACK_BOT_TOKEN,
      slackChannel: process.env.CHATBOT_HOSTED_TIER2_HEARTBEAT_SLACK_CHANNEL,
      dryRunNotify: args["dry-run-notify"] === "true" || process.env.CHATBOT_HOSTED_TIER2_HEARTBEAT_DRY_RUN_NOTIFY === "1",
      repair: args["no-repair"] !== "true",
      forceGenerate: args["force-generate"] === "true",
      workerServiceName:
        process.env.CHATBOT_HOSTED_TIER2_HEARTBEAT_WORKER_SERVICE ?? "hosted-notion-ai-worker.service",
      chromeServiceName:
        process.env.CHATBOT_HOSTED_TIER2_HEARTBEAT_CHROME_SERVICE ?? "hosted-worker-chrome.service",
    },
  }
}

function parseArgs(argv: string[]): Record<string, string> {
  const parsed: Record<string, string> = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg.startsWith("--")) continue
    const key = arg.slice(2)
    const next = argv[index + 1]
    if (!next || next.startsWith("--")) {
      parsed[key] = "true"
      continue
    }
    parsed[key] = next
    index += 1
  }
  return parsed
}

function loadEnvFiles(candidates: Array<string | undefined>): void {
  for (const candidate of candidates) {
    if (!candidate || !existsSync(candidate)) continue
    const raw = safeReadFile(candidate)
    for (const [key, value] of Object.entries(parseEnvFile(raw))) {
      if (process.env[key] === undefined) process.env[key] = value
    }
  }
}

function safeReadFile(filePath: string): string {
  try {
    return existsSync(filePath) ? readFileSync(filePath, "utf8") : ""
  } catch {
    return ""
  }
}

function parseEnvFile(raw: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const separator = trimmed.indexOf("=")
    if (separator < 0) continue
    const key = trimmed.slice(0, separator).trim()
    let value = trimmed.slice(separator + 1).trim()
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    env[key] = value
  }
  return env
}

function readModelAvailable(body: Record<string, unknown>): boolean | undefined {
  if (typeof body.modelAvailable === "boolean") return body.modelAvailable
  const preferredModel = body.preferredModel
  if (isRecord(preferredModel) && typeof preferredModel.available === "boolean") return preferredModel.available
  return undefined
}

function canNotify(lastNotificationAt: string | undefined, now: Date, cooldownMs: number): boolean {
  if (!lastNotificationAt) return true
  const parsed = Date.parse(lastNotificationAt)
  return !Number.isFinite(parsed) || now.getTime() - parsed >= cooldownMs
}

function formatJst(date: Date): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date)
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function isHeartbeatStatus(value: unknown): value is HeartbeatStatus {
  return value === "healthy" || value === "suspect" || value === "unhealthy"
}

function isIncidentClass(value: unknown): value is IncidentClass {
  return (
    value === "none" ||
    value === "chrome_cdp" ||
    value === "notion_model" ||
    value === "notion_runtime_trust_rule_denied" ||
    value === "worker_error:auth" ||
    value === "worker_error:connection" ||
    value === "worker_error:invalid-output" ||
    value === "worker_http_502" ||
    value === "http" ||
    value === "timeout" ||
    value === "unknown"
  )
}

function isNotificationKind(value: unknown): value is NotificationKind {
  return value === "unhealthy" || value === "recovered" || value === "test"
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function publicResponseErrorDetail(body: unknown): string {
  if (!isRecord(body) || !isRecord(body.error)) return ""

  const code = typeof body.error.code === "string" ? sanitizePublicText(body.error.code) : undefined
  const message = typeof body.error.message === "string" ? sanitizePublicText(body.error.message) : undefined
  const retryable = typeof body.error.retryable === "boolean" ? String(body.error.retryable) : undefined
  return [
    code ? `error:${code}` : undefined,
    message ? `message:${message}` : undefined,
    retryable ? `retryable:${retryable}` : undefined,
  ]
    .filter((entry): entry is string => Boolean(entry))
    .join(";")
    .replace(/^/, ";")
}

function classifyFailureOrigin(check: CheckResult | undefined): IncidentClass {
  if (!check) return "none"
  if (check.detail.includes("notion_runtime_trust_rule_denied")) return "notion_runtime_trust_rule_denied"
  if (check.detail.includes("trust-rule-denied") || check.detail.includes("AI inference is not allowed")) {
    return "notion_runtime_trust_rule_denied"
  }
  if (check.detail.includes("error:connection")) return "worker_error:connection"
  if (check.detail.includes("error:auth")) return "worker_error:auth"
  if (check.detail.includes("error:invalid-output")) return "worker_error:invalid-output"
  if (check.detail.includes("cdp_")) return "chrome_cdp"
  if (check.detail.includes("model_available:false")) return "notion_model"
  if (check.detail.includes("timeout")) return "timeout"
  if (check.detail.includes("worker_http_502")) return "worker_http_502"
  if (check.status === 502) return "worker_http_502"
  if (check.status && check.status >= 400) return "http"
  return "unknown"
}

function isTransientGenerateIncident(incidentClass: IncidentClass | undefined): boolean {
  return incidentClass === "notion_runtime_trust_rule_denied" || incidentClass === "worker_error:invalid-output"
}

function isTransientGenerateFailure(check: CheckResult | undefined): boolean {
  return check?.name === "generate" && isTransientGenerateIncident(classifyFailureOrigin(check))
}

function publicError(error: unknown): string {
  if (error instanceof Error) return error.name === "AbortError" ? "timeout" : error.message
  return String(error)
}

function sanitizePublicText(value: string): string {
  const sanitized = value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/xox[baprs]-[A-Za-z0-9-]+/gi, "[redacted-slack-token]")
    .replace(/https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+/gi, "[redacted-slack-webhook]")
  return sanitized.length <= 600 ? sanitized : `${sanitized.slice(0, 600)}...[truncated]`
}

async function main(): Promise<void> {
  const { config, sendTestNotification } = resolveConfig(process.argv.slice(2))
  if (sendTestNotification) {
    const notification = await sendNotification(config, "test", [], [], fetch, new Date())
    console.log(JSON.stringify({ ok: notification.status === "sent" || notification.status === "dry-run", notification }, null, 2))
    return
  }

  const result = await runHeartbeat(config)
  console.log(JSON.stringify(result, null, 2))
}

function isMainModule(): boolean {
  return process.argv[1] === fileURLToPath(import.meta.url)
}

if (isMainModule()) {
  main().catch((error: unknown) => {
    console.error(publicError(error))
    process.exit(1)
  })
}
