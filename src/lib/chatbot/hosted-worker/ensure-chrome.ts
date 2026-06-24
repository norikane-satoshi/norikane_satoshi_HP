import { spawn } from "node:child_process"
import { homedir, platform } from "node:os"
import path from "node:path"

import {
  getNotionAiChatbotThreadUrl,
} from "@/lib/chatbot/server/llm-clients/tier1-chrome-notion-ai-config"
import {
  createTier1ChromeNotionAiClient,
  isNotionAiChatbotTargetUrl,
  tier1ChromeNotionAiDefaults,
  tier1ObservedNotionAiModel,
  type NotionAiRuntimeInspection,
} from "@/lib/chatbot/server/llm-clients/tier1-chrome-notion-ai"
import { ChatbotLlmError } from "@/lib/chatbot/server/llm-client"
import type {
  HostedWorkerCdpTargetSummary,
  HostedWorkerChromeConfig,
  HostedWorkerEnsureResult,
  HostedWorkerEnsureStatus,
} from "@/lib/chatbot/hosted-worker/types"

type CdpTarget = HostedWorkerCdpTargetSummary & {
  webSocketDebuggerUrl?: string
}

type FetchClient = (input: string, init?: RequestInit) => Promise<Response>
type RuntimeInspector = () => Promise<NotionAiRuntimeInspection>
type ChromeLauncher = (config: HostedWorkerChromeConfig) => Promise<void>

type EnsureChromeOptions = Partial<HostedWorkerChromeConfig> & {
  fetchClient?: FetchClient
  runtimeInspector?: RuntimeInspector
  chromeLauncher?: ChromeLauncher
}

type CdpVersion = {
  Browser?: string
}

const cdpJsonVersionPath = "/json/version"
const cdpJsonListPath = "/json/list"
const cdpJsonNewPath = "/json/new"
const targetTypePage = "page"
const notionHostNeedle = "notion.so"
const loginNeedle = "/login"
const retryIntervalMs = 1000

export function resolveHostedWorkerChromeConfig(
  env: NodeJS.ProcessEnv = process.env,
  overrides: Partial<HostedWorkerChromeConfig> = {},
): HostedWorkerChromeConfig {
  return {
    cdpBaseUrl: env.CHATBOT_HOSTED_WORKER_CDP_BASE_URL ?? tier1ChromeNotionAiDefaults.cdpBaseUrl,
    targetUrlIncludes:
      env.CHATBOT_HOSTED_WORKER_NOTION_THREAD_URL ??
      env.NOTION_AI_CHATBOT_THREAD_URL ??
      getNotionAiChatbotThreadUrl({ NOTION_AI_CHATBOT_THREAD_URL: env.NOTION_AI_CHATBOT_THREAD_URL }),
    preferredModel: tier1ObservedNotionAiModel,
    chromeProfileDir:
      env.CHATBOT_HOSTED_WORKER_CHROME_PROFILE_DIR ??
      path.join(homedir(), ".cc-notion", "chrome-profiles", "hosted-worker-notion-ai"),
    chromeCommand: env.CHATBOT_HOSTED_WORKER_CHROME_COMMAND,
    chromeApp: env.CHATBOT_HOSTED_WORKER_CHROME_APP ?? "Google Chrome",
    waitMs: parsePositiveInteger(env.CHATBOT_HOSTED_WORKER_CHROME_WAIT_MS, 30000),
    ...overrides,
  }
}

export async function inspectHostedWorkerChrome(
  options: EnsureChromeOptions = {},
): Promise<HostedWorkerEnsureResult> {
  const config = resolveHostedWorkerChromeConfig(process.env, options)
  const fetchClient = options.fetchClient ?? fetch
  const runtimeInspector = options.runtimeInspector ?? createRuntimeInspector(config)
  let version: CdpVersion
  let targets: CdpTarget[]

  try {
    ;[version, targets] = await Promise.all([
      fetchJson<CdpVersion>(fetchClient, config, cdpJsonVersionPath),
      fetchJson<CdpTarget[]>(fetchClient, config, cdpJsonListPath),
    ])
  } catch {
    return result(config, {
      status: "cdp_connection_refused",
      reachable: false,
    })
  }

  const pageTargets = targets.filter((target) => target.type === targetTypePage)
  const loginTarget = pageTargets.find(isLoginTarget)

  if (loginTarget) {
    return result(config, {
      status: "manual_login_required",
      browser: version.Browser,
      target: loginTarget,
      targetCount: targets.length,
      loginRedirect: true,
      action: "manual_pending",
    })
  }

  const target = pageTargets.find((candidate) => {
    return isNotionAiChatbotTargetUrl(candidate.url, config.targetUrlIncludes)
  })
  if (!target) {
    const mismatchedTarget = pageTargets.find(isNotionAiLikeTarget)
    if (mismatchedTarget) {
      return result(config, {
        status: "target_url_mismatch",
        browser: version.Browser,
        target: mismatchedTarget,
        targetCount: targets.length,
      })
    }

    return result(config, {
      status: "target_missing",
      browser: version.Browser,
      targetCount: targets.length,
    })
  }

  try {
    const inspection = await runtimeInspector()
    if (!inspection.preferredModelAvailable) {
      return result(config, {
        status: "model_unavailable",
        browser: version.Browser,
        target,
        targetCount: targets.length,
        selectedModel: inspection.selectedModel,
        finalModelName: inspection.finalModelName,
        modelAvailable: false,
      })
    }

    return result(config, {
      status: "ready",
      browser: version.Browser,
      target,
      targetCount: targets.length,
      selectedModel: inspection.selectedModel,
      finalModelName: inspection.finalModelName,
      modelAvailable: true,
    })
  } catch (error) {
    if (error instanceof ChatbotLlmError && error.code === "auth") {
      return result(config, {
        status: "manual_login_required",
        browser: version.Browser,
        target,
        targetCount: targets.length,
        loginRedirect: true,
        action: "manual_pending",
      })
    }

    return result(config, {
      status: "unknown",
      browser: version.Browser,
      target,
      targetCount: targets.length,
    })
  }
}

export async function ensureHostedWorkerChrome(
  options: EnsureChromeOptions = {},
): Promise<HostedWorkerEnsureResult> {
  const config = resolveHostedWorkerChromeConfig(process.env, options)
  const fetchClient = options.fetchClient ?? fetch
  const chromeLauncher = options.chromeLauncher ?? launchChrome
  const before = await inspectHostedWorkerChrome(options)

  if (before.status === "ready") return before
  if (
    before.status === "manual_login_required" ||
    before.status === "model_unavailable" ||
    before.status === "target_url_mismatch"
  ) {
    return { ...before, action: before.status === "manual_login_required" ? "manual_pending" : "none" }
  }

  if (before.status === "cdp_connection_refused") {
    await chromeLauncher(config)
    return waitForReady({ ...options, action: "started_chrome" })
  }

  if (before.status === "target_missing") {
    await openTarget(fetchClient, config)
    return waitForReady({ ...options, action: "opened_target" })
  }

  return before
}

async function waitForReady(
  options: EnsureChromeOptions & { action: HostedWorkerEnsureResult["action"] },
): Promise<HostedWorkerEnsureResult> {
  const config = resolveHostedWorkerChromeConfig(process.env, options)
  const deadline = Date.now() + config.waitMs
  let latest = await inspectHostedWorkerChrome(options)

  while (
    Date.now() < deadline &&
    latest.status !== "ready" &&
    latest.status !== "manual_login_required" &&
    latest.status !== "model_unavailable" &&
    latest.status !== "target_url_mismatch"
  ) {
    await sleep(retryIntervalMs)
    latest = await inspectHostedWorkerChrome(options)
  }

  return latest.status === "ready" ? { ...latest, action: options.action } : latest
}

function createRuntimeInspector(config: HostedWorkerChromeConfig): RuntimeInspector {
  return () => {
    const client = createTier1ChromeNotionAiClient({
      cdpBaseUrl: config.cdpBaseUrl,
      targetUrlIncludes: config.targetUrlIncludes,
      healthCheckTimeoutMs: Math.max(config.waitMs, tier1ChromeNotionAiDefaults.healthCheckTimeoutMs),
      preferredModel: config.preferredModel,
    })
    return client.inspectRuntimeContext()
  }
}

async function fetchJson<T>(
  fetchClient: FetchClient,
  config: HostedWorkerChromeConfig,
  requestPath: string,
): Promise<T> {
  const response = await fetchClient(`${trimTrailingSlash(config.cdpBaseUrl)}${requestPath}`, {
    method: requestPath === cdpJsonNewPath ? "PUT" : "GET",
  })
  if (!response.ok) throw new Error(`${requestPath} returned ${response.status}`)
  return (await response.json()) as T
}

async function openTarget(fetchClient: FetchClient, config: HostedWorkerChromeConfig): Promise<void> {
  await fetchClient(
    `${trimTrailingSlash(config.cdpBaseUrl)}${cdpJsonNewPath}?${encodeURIComponent(config.targetUrlIncludes)}`,
    { method: "PUT" },
  ).catch(() => undefined)
}

async function launchChrome(config: HostedWorkerChromeConfig): Promise<void> {
  const currentPlatform = platform()
  const executable = config.chromeCommand ?? (currentPlatform === "darwin" ? "/usr/bin/open" : "google-chrome")
  const args =
    currentPlatform === "darwin" && !config.chromeCommand
      ? [
          "-na",
          config.chromeApp ?? "Google Chrome",
          "--args",
          ...chromeArgs(config),
          config.targetUrlIncludes,
        ]
      : [...chromeArgs(config), config.targetUrlIncludes]
  const child = spawn(executable, args, { detached: true, stdio: "ignore" })
  child.unref()
}

function chromeArgs(config: HostedWorkerChromeConfig): string[] {
  return [
    `--user-data-dir=${config.chromeProfileDir}`,
    "--remote-debugging-address=127.0.0.1",
    "--remote-debugging-port=9223",
    "--remote-allow-origins=http://127.0.0.1:9223",
    "--no-first-run",
    "--no-default-browser-check",
  ]
}

function result(
  config: HostedWorkerChromeConfig,
  input: {
    status: HostedWorkerEnsureStatus
    browser?: string
    target?: CdpTarget
    targetCount?: number
    reachable?: boolean
    loginRedirect?: boolean
    action?: HostedWorkerEnsureResult["action"]
    selectedModel?: string
    finalModelName?: string
    modelAvailable?: boolean
  },
): HostedWorkerEnsureResult {
  return {
    ok: input.status === "ready",
    status: input.status,
    action: input.action ?? "none",
    cdp: {
      baseUrl: config.cdpBaseUrl,
      reachable: input.reachable ?? true,
      browser: input.browser,
    },
    notionTarget: {
      found: Boolean(input.target),
      loginRedirect: input.loginRedirect ?? false,
      targetUrlMatches: Boolean(
        input.target && isNotionAiChatbotTargetUrl(input.target.url, config.targetUrlIncludes),
      ),
      target: input.target ? summarizeTarget(input.target) : undefined,
    },
    preferredModel: {
      name: config.preferredModel,
      available: input.modelAvailable,
      selectedModel: input.selectedModel,
      finalModelName: input.finalModelName,
    },
    targetCount: input.targetCount,
    errorCode: input.status === "ready" ? undefined : input.status,
  }
}

function summarizeTarget(target: CdpTarget): HostedWorkerCdpTargetSummary {
  return {
    id: target.id,
    type: target.type,
    title: target.title,
    url: target.url,
  }
}

function isLoginTarget(target: CdpTarget): boolean {
  const url = target.url ?? ""
  return target.type === targetTypePage && url.includes(notionHostNeedle) && url.includes(loginNeedle)
}

function isNotionAiLikeTarget(target: CdpTarget): boolean {
  const url = target.url ?? ""
  return target.type === targetTypePage && url.includes(notionHostNeedle) && (url.includes("/ai") || url.includes("/chat"))
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "")
}
