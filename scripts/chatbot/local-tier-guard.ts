import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { appendFile, mkdir, readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { homedir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { config as loadDotenv } from "dotenv"

import {
  getNotionAiChatbotThreadUrl,
} from "@/lib/chatbot/server/llm-clients/tier1-chrome-notion-ai-config"
import { isNotionAiChatbotTargetUrl } from "@/lib/chatbot/server/llm-clients/tier1-chrome-notion-ai"
import { createTier4FormFallbackClient } from "@/lib/chatbot/server/llm-clients/tier4-form-fallback"
import { tier3OllamaDeepSeekDefaults } from "@/lib/chatbot/server/llm-clients/tier3-ollama-deepseek"

type TierName =
  | "tier-1-chrome-notion-ai"
  | "tier-3-ollama-deepseek"
  | "tier-4-form-fallback"
  | "local-41238-runtime"
type GuardStatus = "green" | "yellow" | "red"

type CdpTarget = {
  type?: string
  title?: string
  url?: string
}

type CdpInspection =
  | { status: "target-ready"; httpStatus: number; browser?: string; targetCount: number }
  | { status: "login-redirect"; httpStatus: number; browser?: string; targetCount: number }
  | { status: "target-missing"; httpStatus: number; browser?: string; targetCount: number }
  | { status: "cdp-down"; httpStatus: number; error: string }

type TierResult = {
  tier: TierName
  status: GuardStatus
  action: string
  httpStatus?: number
  detail?: string
  nextAction?: string
}

type GuardOptions = {
  daemon: boolean
  repair: boolean
  intervalMs: number
  logPath: string
  simulateTier1Absent: boolean
  simulateTier3Absent: boolean
  simulateTier4EnvMissing: boolean
}

const defaultIntervalMs = 120_000
const fetchTimeoutMs = 3000
const waitForTier1Ms = 30_000
const oneSecondMs = 1000
const labelOllama = "homebrew.mxcl.ollama"
const tier1DefaultCdpBaseUrl = "http://127.0.0.1:9223"
const defaultLogPath = path.join(homedir(), "Library", "Logs", "norikane_satoshi_hp", "local-tier-guard.jsonl")
const liveRepoEnvPath = path.join(homedir(), "projects", "norikane_satoshi_HP", ".env.local")

loadLocalEnv()

export async function runGuard(options: GuardOptions): Promise<TierResult[]> {
  const results = [
    await guardTier1(options),
    await guardTier3(options),
    await guardTier4(options),
    await guardLocal41238Runtime(),
  ]

  await writeLog(options.logPath, results)
  console.log(JSON.stringify({ ok: results.every((result) => result.status === "green"), results }, null, 2))

  return results
}

async function guardLocal41238Runtime(): Promise<TierResult> {
  const inspection = await inspectLocal41238Runtime()

  if (inspection.status === "current") {
    return {
      tier: "local-41238-runtime",
      status: "green",
      action: "none",
      httpStatus: inspection.httpStatus,
      detail: `pid:${inspection.pid};head_current:${inspection.head.slice(0, 12)};dirty:${inspection.dirtyFiles};prisma_client_schema:${inspection.prismaClientSchema};cwd:${inspection.cwd}`,
    }
  }

  if (inspection.status === "dirty") {
    return {
      tier: "local-41238-runtime",
      status: "yellow",
      action: "inspect-41238-dirty-diff",
      httpStatus: inspection.httpStatus,
      detail: `pid:${inspection.pid};head_current:${inspection.head.slice(0, 12)};dirty:${inspection.dirtyFiles};prisma_client_schema:${inspection.prismaClientSchema};cwd:${inspection.cwd}`,
      nextAction: "inspect_41238_dirty_diff_without_reset",
    }
  }

  if (inspection.status === "unreachable") {
    return {
      tier: "local-41238-runtime",
      status: "red",
      action: "inspect-41238-http-required",
      httpStatus: inspection.httpStatus,
      detail: `pid:${inspection.pid};http_status:${inspection.httpStatus};head:${inspection.head.slice(0, 12)};expected:${inspection.expectedHead.slice(0, 12)};dirty:${inspection.dirtyFiles};prisma_client_schema:${inspection.prismaClientSchema};cwd:${inspection.cwd}`,
      nextAction: "inspect_41238_http_without_restart",
    }
  }

  if (inspection.status === "prisma-client-stale") {
    return {
      tier: "local-41238-runtime",
      status: "red",
      action: "regenerate-prisma-client-required",
      httpStatus: inspection.httpStatus,
      detail: `pid:${inspection.pid};prisma_client_schema:${inspection.prismaClientSchema};head:${inspection.head.slice(0, 12)};dirty:${inspection.dirtyFiles};cwd:${inspection.cwd}`,
      nextAction: "run_prisma_generate_before_chatbot_runtime",
    }
  }

  if (inspection.status === "stale") {
    return {
      tier: "local-41238-runtime",
      status: "red",
      action: "update-41238-worktree-required",
      httpStatus: inspection.httpStatus,
      detail: `pid:${inspection.pid};head_stale:${inspection.head.slice(0, 12)};expected:${inspection.expectedHead.slice(0, 12)};dirty:${inspection.dirtyFiles};prisma_client_schema:${inspection.prismaClientSchema};cwd:${inspection.cwd}`,
      nextAction: "update_41238_to_origin_staging_without_restart",
    }
  }

  return {
    tier: "local-41238-runtime",
    status: "red",
    action: "inspect-41238-runtime-required",
    detail: inspection.detail,
    nextAction: "inspect_41238_listener_and_worktree",
  }
}

async function guardTier1(options: GuardOptions): Promise<TierResult> {
  const cdpBaseUrl = process.env.CHATBOT_TIER1_CDP_BASE_URL ?? tier1DefaultCdpBaseUrl
  const threadUrl = getNotionAiChatbotThreadUrl()

  let before = options.simulateTier1Absent
    ? ({ status: "cdp-down", httpStatus: 0, error: "simulated_absent" } as CdpInspection)
    : await inspectTier1(cdpBaseUrl, threadUrl)

  if (before.status === "target-ready") {
    return {
      tier: "tier-1-chrome-notion-ai",
      status: "green",
      action: "none",
      httpStatus: before.httpStatus,
      detail: `target_ready:${before.targetCount}`,
    }
  }

  if (before.status === "login-redirect") {
    return {
      tier: "tier-1-chrome-notion-ai",
      status: "red",
      action: "manual-reauth-required",
      httpStatus: before.httpStatus,
      detail: "notion_login_redirect",
      nextAction: "manual_notion_reauth_required",
    }
  }

  if (!options.repair) {
    return tier1NeedsRepair(before)
  }

  if (before.status === "cdp-down") {
    await startTier1Chrome(cdpBaseUrl, threadUrl)
  } else if (before.status === "target-missing") {
    await openTier1Target(cdpBaseUrl, threadUrl)
  }

  const after = await waitForTier1Ready(cdpBaseUrl, threadUrl)
  if (after.status === "target-ready") {
    return {
      tier: "tier-1-chrome-notion-ai",
      status: "green",
      action: before.status === "cdp-down" ? "started-chrome" : "opened-thread",
      httpStatus: after.httpStatus,
      detail: `target_ready:${after.targetCount}`,
    }
  }

  if (after.status === "login-redirect") {
    return {
      tier: "tier-1-chrome-notion-ai",
      status: "red",
      action: "manual-reauth-required",
      httpStatus: after.httpStatus,
      detail: "notion_login_redirect",
      nextAction: "manual_notion_reauth_required",
    }
  }

  before = after
  return tier1NeedsRepair(before)
}

function tier1NeedsRepair(inspection: CdpInspection): TierResult {
  return {
    tier: "tier-1-chrome-notion-ai",
    status: "red",
    action: inspection.status === "cdp-down" ? "start-chrome-required" : "open-thread-required",
    httpStatus: inspection.httpStatus,
    detail: inspection.status,
    nextAction: inspection.status === "cdp-down" ? "start_chrome_cdp_9223" : "open_notion_ai_thread",
  }
}

async function inspectTier1(cdpBaseUrl: string, threadUrl: string): Promise<CdpInspection> {
  try {
    const [versionResponse, targetsResponse] = await Promise.all([
      fetchJson<{ Browser?: string }>(`${cdpBaseUrl}/json/version`),
      fetchJson<CdpTarget[]>(`${cdpBaseUrl}/json/list`),
    ])
    const pageTargets = targetsResponse.body.filter((target) => target.type === "page")
    const hasLoginRedirect = pageTargets.some((target) => {
      const url = target.url ?? ""
      return (url.includes("notion.so") || url.includes("app.notion.com")) && url.includes("/login")
    })
    if (hasLoginRedirect) {
      return {
        status: "login-redirect",
        httpStatus: targetsResponse.status,
        browser: versionResponse.body.Browser,
        targetCount: targetsResponse.body.length,
      }
    }

    const hasTarget = pageTargets.some((target) => isNotionAiChatbotTargetUrl(target.url, threadUrl))
    return {
      status: hasTarget ? "target-ready" : "target-missing",
      httpStatus: targetsResponse.status,
      browser: versionResponse.body.Browser,
      targetCount: targetsResponse.body.length,
    }
  } catch (error) {
    return {
      status: "cdp-down",
      httpStatus: 0,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function startTier1Chrome(cdpBaseUrl: string, threadUrl: string): Promise<void> {
  const cdpUrl = new URL(cdpBaseUrl)
  const profileDir =
    process.env.CHATBOT_TIER1_CHROME_PROFILE_DIR ??
    path.join(homedir(), ".cc-notion", "chrome-profiles", "notion-ai")
  const chromeApp = process.env.CHATBOT_TIER1_CHROME_APP ?? "Google Chrome"
  const port = cdpUrl.port || "9223"
  const host = cdpUrl.hostname || "127.0.0.1"
  await spawnAndWait("/usr/bin/open", [
    "-na",
    chromeApp,
    "--args",
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-address=${host}`,
    `--remote-debugging-port=${port}`,
    `--remote-allow-origins=http://${host}:${port}`,
    "--no-first-run",
    "--no-default-browser-check",
    threadUrl,
  ])
}

async function openTier1Target(cdpBaseUrl: string, threadUrl: string): Promise<void> {
  await fetch(`${cdpBaseUrl}/json/new?${encodeURIComponent(threadUrl)}`, { method: "PUT" }).catch(() => undefined)
}

async function waitForTier1Ready(cdpBaseUrl: string, threadUrl: string): Promise<CdpInspection> {
  const deadline = Date.now() + waitForTier1Ms
  let latest = await inspectTier1(cdpBaseUrl, threadUrl)
  while (Date.now() < deadline) {
    if (latest.status === "target-ready" || latest.status === "login-redirect") return latest
    await sleep(oneSecondMs)
    latest = await inspectTier1(cdpBaseUrl, threadUrl)
  }
  return latest
}

async function guardTier3(options: GuardOptions): Promise<TierResult> {
  const baseUrl = process.env.CHATBOT_TIER3_OLLAMA_BASE_URL ?? tier3OllamaDeepSeekDefaults.baseUrl
  const modelName = process.env.CHATBOT_TIER3_OLLAMA_MODEL ?? tier3OllamaDeepSeekDefaults.modelName
  const before = options.simulateTier3Absent
    ? { reachable: false, status: 0, hasModel: false, modelCount: 0 }
    : await inspectTier3(baseUrl, modelName)

  if (before.reachable && before.hasModel) {
    return {
      tier: "tier-3-ollama-deepseek",
      status: "green",
      action: "none",
      httpStatus: before.status,
      detail: `model_present:${before.modelCount}`,
    }
  }

  if (!options.repair) {
    return tier3NeedsRepair(before)
  }

  if (!before.reachable) {
    await startOllama()
    const after = await waitForTier3Ready(baseUrl, modelName)
    if (after.reachable && after.hasModel) {
      return {
        tier: "tier-3-ollama-deepseek",
        status: "green",
        action: "started-ollama",
        httpStatus: after.status,
        detail: `model_present:${after.modelCount}`,
      }
    }
    return tier3NeedsRepair(after)
  }

  if (!before.hasModel && process.env.CHATBOT_LOCAL_TIER_GUARD_PULL_MISSING_MODEL === "1") {
    await spawnAndWait("ollama", ["pull", modelName])
    const after = await inspectTier3(baseUrl, modelName)
    if (after.reachable && after.hasModel) {
      return {
        tier: "tier-3-ollama-deepseek",
        status: "green",
        action: "pulled-model",
        httpStatus: after.status,
        detail: `model_present:${after.modelCount}`,
      }
    }
  }

  return tier3NeedsRepair(before)
}

function tier3NeedsRepair(inspection: Awaited<ReturnType<typeof inspectTier3>>): TierResult {
  return {
    tier: "tier-3-ollama-deepseek",
    status: "red",
    action: inspection.reachable ? "model-pull-required" : "start-ollama-required",
    httpStatus: inspection.status,
    detail: inspection.reachable ? `model_missing:${inspection.modelCount}` : "ollama_unreachable",
    nextAction: inspection.reachable ? "model_pull_required" : "start_ollama",
  }
}

async function inspectTier3(baseUrl: string, modelName: string): Promise<{
  reachable: boolean
  status: number
  hasModel: boolean
  modelCount: number
}> {
  try {
    const response = await fetchJson<{ models?: unknown }>(`${baseUrl}/api/tags`)
    const models = Array.isArray(response.body.models) ? response.body.models : []
    return {
      reachable: true,
      status: response.status,
      hasModel: hasOllamaModel(models, modelName),
      modelCount: models.length,
    }
  } catch {
    return { reachable: false, status: 0, hasModel: false, modelCount: 0 }
  }
}

async function startOllama(): Promise<void> {
  const uid = process.getuid?.() ?? Number(process.env.UID ?? "501")
  const label = `gui/${uid}/${labelOllama}`
  const printResult = await spawnCapture("/bin/launchctl", ["print", label])
  if (printResult.exitCode === 0) {
    await spawnAndWait("/bin/launchctl", ["kickstart", label])
    return
  }

  await spawnAndWait("brew", ["services", "start", "ollama"])
}

async function waitForTier3Ready(baseUrl: string, modelName: string) {
  const deadline = Date.now() + 20_000
  let latest = await inspectTier3(baseUrl, modelName)
  while (Date.now() < deadline) {
    if (latest.reachable) return latest
    await sleep(oneSecondMs)
    latest = await inspectTier3(baseUrl, modelName)
  }
  return latest
}

async function guardTier4(options: GuardOptions): Promise<TierResult> {
  const hasResendApiKey = !options.simulateTier4EnvMissing && isPresent(process.env.RESEND_API_KEY)
  const hasFromEmail = !options.simulateTier4EnvMissing && isPresent(process.env.RESEND_FROM_EMAIL)
  const client = createTier4FormFallbackClient()
  const clientHealthy = await client.isHealthy()

  if (clientHealthy && hasResendApiKey && hasFromEmail) {
    return {
      tier: "tier-4-form-fallback",
      status: "green",
      action: "none",
      detail: "client_ready:resend_env_present",
    }
  }

  return {
    tier: "tier-4-form-fallback",
    status: hasResendApiKey ? "yellow" : "red",
    action: "env-check-required",
    detail: `client:${clientHealthy ? "ready" : "not_ready"};RESEND_API_KEY:${hasResendApiKey ? "present" : "missing"};RESEND_FROM_EMAIL:${hasFromEmail ? "present" : "missing"}`,
    nextAction: "restore_resend_env",
  }
}

type Local41238RuntimeInspection =
  | { status: "current"; cwd: string; pid: string; head: string; expectedHead: string; httpStatus: number; dirtyFiles: number; prismaClientSchema: PrismaClientSchemaStatus }
  | { status: "dirty"; cwd: string; pid: string; head: string; expectedHead: string; httpStatus: number; dirtyFiles: number; prismaClientSchema: PrismaClientSchemaStatus }
  | { status: "stale"; cwd: string; pid: string; head: string; expectedHead: string; httpStatus: number; dirtyFiles: number; prismaClientSchema: PrismaClientSchemaStatus }
  | { status: "unreachable"; cwd: string; pid: string; head: string; expectedHead: string; httpStatus: number; dirtyFiles: number; prismaClientSchema: PrismaClientSchemaStatus }
  | { status: "prisma-client-stale"; cwd: string; pid: string; head: string; expectedHead: string; httpStatus: number; dirtyFiles: number; prismaClientSchema: PrismaClientSchemaStatus }
  | { status: "unknown"; detail: string }

type PrismaClientSchemaStatus = "current" | "stale" | "missing" | "unknown"

export function classifyLocal41238Runtime(input: {
  cwd?: string
  pid?: string
  head?: string
  expectedHead?: string
  httpStatus?: number
  dirtyFiles?: number
  prismaClientSchema?: PrismaClientSchemaStatus
  error?: string
}): Local41238RuntimeInspection {
  if (input.error) return { status: "unknown", detail: input.error }
  if (!input.cwd) return { status: "unknown", detail: "41238_listener_cwd_missing" }
  if (!input.pid) return { status: "unknown", detail: `41238_listener_pid_missing;cwd:${input.cwd}` }
  if (!input.head) return { status: "unknown", detail: `41238_head_missing;cwd:${input.cwd}` }
  if (!input.expectedHead) return { status: "unknown", detail: `41238_expected_head_missing;cwd:${input.cwd}` }
  if (input.httpStatus === undefined) return { status: "unknown", detail: `41238_http_status_missing;cwd:${input.cwd}` }
  const dirtyFiles = input.dirtyFiles ?? 0
  const prismaClientSchema = input.prismaClientSchema ?? "current"

  if (input.httpStatus !== 200) {
    return {
      status: "unreachable",
      cwd: input.cwd,
      pid: input.pid,
      head: input.head,
      expectedHead: input.expectedHead,
      httpStatus: input.httpStatus,
      dirtyFiles,
      prismaClientSchema,
    }
  }

  if (prismaClientSchema !== "current") {
    return {
      status: "prisma-client-stale",
      cwd: input.cwd,
      pid: input.pid,
      head: input.head,
      expectedHead: input.expectedHead,
      httpStatus: input.httpStatus,
      dirtyFiles,
      prismaClientSchema,
    }
  }

  if (input.head === input.expectedHead) {
    if (dirtyFiles > 0) {
      return {
        status: "dirty",
        cwd: input.cwd,
        pid: input.pid,
        head: input.head,
        expectedHead: input.expectedHead,
        httpStatus: input.httpStatus,
        dirtyFiles,
        prismaClientSchema,
      }
    }
    return {
      status: "current",
      cwd: input.cwd,
      pid: input.pid,
      head: input.head,
      expectedHead: input.expectedHead,
      httpStatus: input.httpStatus,
      dirtyFiles,
      prismaClientSchema,
    }
  }

  return {
    status: "stale",
    cwd: input.cwd,
    pid: input.pid,
    head: input.head,
    expectedHead: input.expectedHead,
    httpStatus: input.httpStatus,
    dirtyFiles,
    prismaClientSchema,
  }
}

async function inspectLocal41238Runtime(): Promise<Local41238RuntimeInspection> {
  try {
    const pid = await read41238ListenerPid()
    const cwd = await read41238ListenerCwd(pid)
    const [head, expectedHead, httpStatus, dirtyFiles, prismaClientSchema] = await Promise.all([
      readGitRevision(cwd, "HEAD"),
      readGitRevision(cwd, process.env.CHATBOT_41238_EXPECTED_REF ?? "origin/staging"),
      readLocal41238HttpStatus(),
      readGitDirtyFileCount(cwd),
      readPrismaClientSchemaStatus(cwd),
    ])
    return classifyLocal41238Runtime({ cwd, pid, head, expectedHead, httpStatus, dirtyFiles, prismaClientSchema })
  } catch (error) {
    return classifyLocal41238Runtime({
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

async function readPrismaClientSchemaStatus(cwd: string): Promise<PrismaClientSchemaStatus> {
  try {
    const appSchema = await readFile(path.join(cwd, "prisma", "schema.prisma"), "utf8")
    const requireFromRepo = createRequire(path.join(cwd, "package.json"))
    const clientPackageJson = requireFromRepo.resolve("@prisma/client/package.json")
    const generatedSchemaPath = path.join(path.dirname(clientPackageJson), "..", "..", ".prisma", "client", "schema.prisma")
    const generatedSchema = await readFile(generatedSchemaPath, "utf8")
    const requiredFields = ["currentQuestion", "activeChoices", "conversationState"]
    return requiredFields.every((field) => !appSchema.includes(field) || generatedSchema.includes(field))
      ? "current"
      : "stale"
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return message.includes("Cannot find module") || message.includes("ENOENT") ? "missing" : "unknown"
  }
}

async function read41238ListenerCwd(pid: string): Promise<string> {
  const result = await spawnCapture("/usr/sbin/lsof", ["-p", pid, "-a", "-d", "cwd", "-Fn"])
  if (result.exitCode !== 0) {
    throw new Error(`lsof_cwd_failed:${result.stderr.trim() || result.stdout.trim()}`)
  }

  const cwd = result.stdout
    .split("\n")
    .find((line) => line.startsWith("n"))
    ?.slice(1)
    .trim()
  if (!cwd) throw new Error("41238_listener_cwd_missing")

  return cwd
}

async function read41238ListenerPid(): Promise<string> {
  const result = await spawnCapture("/usr/sbin/lsof", ["-nP", "-iTCP:41238", "-sTCP:LISTEN", "-Fp"])
  if (result.exitCode !== 0) {
    throw new Error(`lsof_41238_failed:${result.stderr.trim() || result.stdout.trim()}`)
  }

  const pid = result.stdout
    .split("\n")
    .find((line) => line.startsWith("p"))
    ?.slice(1)
    .trim()
  if (!pid) throw new Error("41238_listener_pid_missing")

  return pid
}

async function readGitRevision(cwd: string, ref: string): Promise<string> {
  const result = await spawnCapture("git", ["-C", cwd, "rev-parse", ref])
  if (result.exitCode !== 0) {
    throw new Error(`git_rev_parse_failed:${ref}:${result.stderr.trim() || result.stdout.trim()}`)
  }

  return result.stdout.trim()
}

async function readGitDirtyFileCount(cwd: string): Promise<number> {
  const result = await spawnCapture("git", ["-C", cwd, "status", "--porcelain"])
  if (result.exitCode !== 0) {
    throw new Error(`git_status_failed:${result.stderr.trim() || result.stdout.trim()}`)
  }

  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean).length
}

async function readLocal41238HttpStatus(): Promise<number> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), fetchTimeoutMs)
  try {
    const response = await fetch("http://127.0.0.1:41238/", {
      method: "HEAD",
      signal: controller.signal,
    })
    return response.status
  } catch {
    return 0
  } finally {
    clearTimeout(timeout)
  }
}

export function hasOllamaModel(models: unknown[], modelName: string): boolean {
  return models.some((model) => {
    if (typeof model === "string") return model === modelName
    if (!model || typeof model !== "object") return false
    const candidate = model as { name?: unknown; model?: unknown }
    return candidate.name === modelName || candidate.model === modelName
  })
}

function isPresent(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0
}

function loadLocalEnv(): void {
  const candidates = [
    process.env.CHATBOT_LOCAL_TIER_GUARD_ENV_FILE,
    path.join(process.cwd(), ".env.local"),
    liveRepoEnvPath,
  ].filter((candidate): candidate is string => Boolean(candidate))

  for (const candidate of candidates) {
    if (existsSync(candidate)) loadDotenv({ path: candidate, override: false, quiet: true })
  }
}

async function fetchJson<T>(url: string): Promise<{ status: number; body: T }> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), fetchTimeoutMs)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) throw new Error(`${url} returned ${response.status}`)
    return { status: response.status, body: (await response.json()) as T }
  } finally {
    clearTimeout(timeout)
  }
}

async function spawnAndWait(command: string, args: string[]): Promise<void> {
  const result = await spawnCapture(command, args)
  if (result.exitCode !== 0) {
    throw new Error(`${command} exited ${result.exitCode}: ${result.stderr.trim() || result.stdout.trim()}`)
  }
}

function spawnCapture(command: string, args: string[]): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    })
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

async function writeLog(logPath: string, results: TierResult[]): Promise<void> {
  await mkdir(path.dirname(logPath), { recursive: true })
  const timestamp = new Date().toISOString()
  const records = results.map((result) => ({
    ts: timestamp,
    tier: result.tier,
    status: result.status,
    action: result.action,
    httpStatus: result.httpStatus,
    detail: result.detail,
    nextAction: result.nextAction,
  }))
  await appendFile(logPath, records.map((record) => JSON.stringify(record)).join("\n") + "\n", "utf8")
}

function parseOptions(argv: string[]): GuardOptions {
  return {
    daemon: argv.includes("--daemon"),
    repair: !argv.includes("--no-repair"),
    intervalMs: readNumberFlag(argv, "--interval-ms", defaultIntervalMs),
    logPath: readStringFlag(argv, "--log-path", defaultLogPath),
    simulateTier1Absent: argv.includes("--simulate-tier1-absent"),
    simulateTier3Absent: argv.includes("--simulate-tier3-absent"),
    simulateTier4EnvMissing: argv.includes("--simulate-tier4-env-missing"),
  }
}

function readStringFlag(argv: string[], flag: string, fallback: string): string {
  const index = argv.indexOf(flag)
  if (index === -1) return fallback
  return argv[index + 1] ?? fallback
}

function readNumberFlag(argv: string[], flag: string, fallback: number): number {
  const value = Number(readStringFlag(argv, flag, String(fallback)))
  return Number.isFinite(value) && value > 0 ? value : fallback
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2))
  if (!options.daemon) {
    const results = await runGuard(options)
    if (results.some((result) => result.status !== "green")) process.exitCode = 1
    return
  }

  let stopping = false
  process.on("SIGTERM", () => {
    stopping = true
  })
  process.on("SIGINT", () => {
    stopping = true
  })

  while (!stopping) {
    try {
      await runGuard(options)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await writeLog(options.logPath, [
        {
          tier: "tier-1-chrome-notion-ai",
          status: "red",
          action: "guard-error",
          detail: message,
        },
      ])
      console.error(message)
    }
    await sleep(options.intervalMs)
  }
}

function isMainModule(): boolean {
  return process.argv[1] === fileURLToPath(import.meta.url)
}

if (isMainModule()) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error))
    process.exit(1)
  })
}
