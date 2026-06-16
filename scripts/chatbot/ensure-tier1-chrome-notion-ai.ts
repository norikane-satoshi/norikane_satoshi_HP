import { spawn } from "node:child_process"
import { homedir } from "node:os"
import path from "node:path"

import {
  getNotionAiChatbotThreadUrl,
  notionAiChatbotThreadId,
} from "@/lib/chatbot/server/llm-clients/tier1-chrome-notion-ai-config"
import { isNotionAiChatbotTargetUrl } from "@/lib/chatbot/server/llm-clients/tier1-chrome-notion-ai"

type CdpTarget = {
  id?: string
  type?: string
  title?: string
  url?: string
}

type CdpTargetSummary = {
  id?: string
  type?: string
  title?: string
  url?: string
}

type Snapshot =
  | { status: "target-ready"; browser?: string; target: CdpTargetSummary; targetCount: number }
  | { status: "login-redirect"; browser?: string; target: CdpTargetSummary; targetCount: number }
  | { status: "target-missing"; browser?: string; targetCount: number; pageTargets: CdpTargetSummary[] }
  | { status: "cdp-down"; error: string }

const cdpBaseUrl = process.env.CHATBOT_TIER1_CDP_BASE_URL ?? "http://127.0.0.1:9223"
const chatbotThreadUrl = getNotionAiChatbotThreadUrl()
const chromeProfileDir =
  process.env.CHATBOT_TIER1_CHROME_PROFILE_DIR ??
  path.join(homedir(), ".cc-notion", "chrome-profiles", "notion-ai")
const chromeApp = process.env.CHATBOT_TIER1_CHROME_APP ?? "Google Chrome"
const waitMs = Number(process.env.CHATBOT_TIER1_CHROME_WAIT_MS ?? "30000")
const openTargetEnabled = process.env.CHATBOT_TIER1_ENSURE_CHROME_OPEN_TARGET !== "0"

async function main(): Promise<void> {
  const before = await inspect()
  if (before.status === "target-ready") {
    print({ ok: true, action: "none", ...before })
    return
  }

  if (before.status === "login-redirect") {
    print({ ok: false, action: "manual-reauth-required", ...before })
    process.exitCode = 1
    return
  }

  if (!openTargetEnabled) {
    print({ ok: false, action: "read-only", ...before })
    return
  }

  await openChatbotThread(before.status)
  const after = await waitForReady()

  if (after.status === "target-ready") {
    print({ ok: true, action: before.status === "cdp-down" ? "started-chrome" : "opened-thread", ...after })
    return
  }

  print({ ok: false, action: "manual-check-required", ...after })
  process.exitCode = 1
}

async function waitForReady(): Promise<Snapshot> {
  const deadline = Date.now() + waitMs
  let latest = await inspect()

  while (Date.now() < deadline) {
    if (latest.status === "target-ready" || latest.status === "login-redirect") return latest
    await sleep(1000)
    latest = await inspect()
  }

  return latest
}

async function inspect(): Promise<Snapshot> {
  try {
    const [version, targets] = await Promise.all([
      fetchJson<{ Browser?: string }>("/json/version"),
      fetchJson<CdpTarget[]>("/json/list"),
    ])
    const pageTargets = targets.filter((target) => target.type === "page")
    const loginTarget = pageTargets.find((target) => {
      const url = target.url ?? ""
      return url.includes("notion.so") && url.includes("/login")
    })
    if (loginTarget) {
      return {
        status: "login-redirect",
        browser: version.Browser,
        target: summarizeTarget(loginTarget),
        targetCount: targets.length,
      }
    }

    const target = pageTargets.find((candidate) => {
      return isNotionAiChatbotTargetUrl(candidate.url, chatbotThreadUrl)
    })
    if (target) {
      return {
        status: "target-ready",
        browser: version.Browser,
        target: summarizeTarget(target),
        targetCount: targets.length,
      }
    }

    return {
      status: "target-missing",
      browser: version.Browser,
      targetCount: targets.length,
      pageTargets: pageTargets.map(summarizeTarget),
    }
  } catch (error) {
    return {
      status: "cdp-down",
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function openChatbotThread(reason: Snapshot["status"]): Promise<void> {
  if (reason === "target-missing") {
    await fetch(`${cdpBaseUrl}/json/new?${encodeURIComponent(chatbotThreadUrl)}`, { method: "PUT" }).catch(
      () => undefined,
    )
    return
  }

  const child = spawn(
    "/usr/bin/open",
    [
      "-na",
      chromeApp,
      "--args",
      `--user-data-dir=${chromeProfileDir}`,
      "--remote-debugging-address=127.0.0.1",
      "--remote-debugging-port=9223",
      "--remote-allow-origins=http://127.0.0.1:9223",
      "--no-first-run",
      "--no-default-browser-check",
      chatbotThreadUrl,
    ],
    { detached: true, stdio: "ignore" },
  )
  child.unref()
}

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${cdpBaseUrl}${path}`)
  if (!response.ok) throw new Error(`${path} returned ${response.status}`)
  return (await response.json()) as T
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function summarizeTarget(target: CdpTarget): CdpTargetSummary {
  return {
    id: target.id,
    type: target.type,
    title: target.title,
    url: target.url,
  }
}

function print(value: Record<string, unknown>): void {
  console.log(
    JSON.stringify(
      {
        cdpBaseUrl,
        chatbotThreadUrl,
        chatbotThreadId: notionAiChatbotThreadId,
        chromeProfileDir,
        openTargetEnabled,
        ...value,
      },
      null,
      2,
    ),
  )
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
