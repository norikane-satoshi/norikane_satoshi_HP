import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { appendFile, mkdir, readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { homedir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { config as loadDotenv } from "dotenv"

import { createTier2GeminiFlashClient } from "@/lib/chatbot/server/llm-clients/tier2-gemini-flash"
import { createTier3FormFallbackClient } from "@/lib/chatbot/server/llm-clients/tier3-form-fallback"

type TierName =
  | "tier-2-gemini-flash"
  | "tier-3-form-fallback"
  | "local-41238-runtime"
type GuardStatus = "green" | "yellow" | "red"

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
  intervalMs: number
  logPath: string
  simulateTier2Absent: boolean
  simulateTier3EnvMissing: boolean
}

const defaultIntervalMs = 120_000
const fetchTimeoutMs = 3000
const defaultLogPath = path.join(homedir(), "Library", "Logs", "norikane_satoshi_hp", "local-tier-guard.jsonl")
const liveRepoEnvPath = path.join(homedir(), "projects", "norikane_satoshi_HP", ".env.local")

loadLocalEnv()

export async function runGuard(options: GuardOptions): Promise<TierResult[]> {
  const results = [
    await guardTier2(options),
    await guardTier3(options),
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

async function guardTier2(options: GuardOptions): Promise<TierResult> {
  const client = createTier2GeminiFlashClient()
  const healthy = !options.simulateTier2Absent && (await client.isHealthy())
  if (healthy) {
    return {
      tier: "tier-2-gemini-flash",
      status: "green",
      action: "none",
      detail: "model_ready",
    }
  }

  return {
    tier: "tier-2-gemini-flash",
    status: "red",
    action: "gemini-health-check-required",
    detail: options.simulateTier2Absent ? "simulated_absent" : "model_unavailable",
    nextAction: "restore_gemini_configuration_or_service",
  }
}

async function guardTier3(options: GuardOptions): Promise<TierResult> {
  const hasResendApiKey = !options.simulateTier3EnvMissing && isPresent(process.env.RESEND_API_KEY)
  const hasFromEmail = !options.simulateTier3EnvMissing && isPresent(process.env.RESEND_FROM_EMAIL)
  const client = createTier3FormFallbackClient()
  const clientHealthy = await client.isHealthy()

  if (clientHealthy && hasResendApiKey && hasFromEmail) {
    return {
      tier: "tier-3-form-fallback",
      status: "green",
      action: "none",
      detail: "client_ready:resend_env_present",
    }
  }

  return {
    tier: "tier-3-form-fallback",
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
    intervalMs: readNumberFlag(argv, "--interval-ms", defaultIntervalMs),
    logPath: readStringFlag(argv, "--log-path", defaultLogPath),
    simulateTier2Absent: argv.includes("--simulate-tier2-absent"),
    simulateTier3EnvMissing: argv.includes("--simulate-tier3-env-missing"),
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
          tier: "local-41238-runtime",
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
