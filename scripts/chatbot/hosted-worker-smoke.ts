import type { ChatbotLlmRequest } from "@/lib/chatbot/server"

type SmokeResult = {
  ok: boolean
  baseUrl: string
  checks: Array<{ name: string; ok: boolean; status?: number; detail?: string }>
  manualPending: string[]
}

const defaultBaseUrl = "http://127.0.0.1:8787"
const invalidToken = "invalid-smoke-token"

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const baseUrl = trimTrailingSlash(args["base-url"] ?? process.env.CHATBOT_HOSTED_WORKER_SMOKE_BASE_URL ?? defaultBaseUrl)
  const token = args.token ?? process.env.CHATBOT_HOSTED_WORKER_TOKEN

  if (args["dry-run"] === "true") {
    print({
      ok: true,
      baseUrl,
      checks: [
        { name: "health", ok: true, detail: "planned GET /health with bearer token" },
        { name: "generate", ok: true, detail: "planned POST /generate and tier normalization check" },
        { name: "invalid-token", ok: true, detail: "planned 401 check" },
      ],
      manualPending: ["live Notion login and model availability are not exercised in dry-run"],
    })
    return
  }

  if (!token) {
    throw new Error("CHATBOT_HOSTED_WORKER_TOKEN or --token is required for live smoke.")
  }

  const checks: SmokeResult["checks"] = []
  const manualPending: string[] = []

  const invalidTokenResponse = await request(`${baseUrl}/health`, invalidToken)
  checks.push({
    name: "invalid-token",
    ok: invalidTokenResponse.status === 401,
    status: invalidTokenResponse.status,
  })

  const health = await request(`${baseUrl}/health`, token)
  checks.push({ name: "health-status", ok: health.status === 200, status: health.status })
  if (health.status === 200) {
    const body = (await health.json()) as { ok?: unknown; status?: unknown; tier?: unknown }
    checks.push({
      name: "health-ok",
      ok: body.ok === true,
      detail: typeof body.status === "string" ? body.status : undefined,
    })
    checks.push({
      name: "health-secret-redaction",
      ok: !JSON.stringify(body).includes(token),
    })
    if (body.ok !== true) {
      manualPending.push(`Notion/Chrome readiness is ${String(body.status)}`)
    }
  }

  const generate = await request(`${baseUrl}/generate`, token, {
    method: "POST",
    body: JSON.stringify(buildSmokeRequest()),
  })
  checks.push({ name: "generate-status", ok: generate.status === 200, status: generate.status })
  if (generate.status === 200) {
    const body = (await generate.json()) as { tier?: unknown; rawText?: unknown }
    checks.push({
      name: "generate-tier",
      ok: body.tier === "tier-2-hosted-chrome-notion-ai",
    })
    checks.push({
      name: "generate-secret-redaction",
      ok: !JSON.stringify(body).includes(token),
    })
  } else {
    manualPending.push(`generate returned HTTP ${generate.status}; live Notion readiness may still be pending`)
  }

  const result = {
    ok: checks.every((check) => check.ok),
    baseUrl,
    checks,
    manualPending,
  }
  print(result)
  if (!result.ok) process.exitCode = 1
}

function request(url: string, token: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, {
    method: init.method ?? "GET",
    body: init.body,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.body ? { "content-type": "application/json" } : {}),
    },
  })
}

function buildSmokeRequest(): ChatbotLlmRequest {
  return {
    systemPrompt: "新規映像案件の相談受付として、所要日数だけを短く返してください。",
    messages: [],
    latestUserMessage: "Web CM 30秒、追加作業なしの相談です。",
    conversationState: {
      hasFinalMedium: true,
      hasJobKind: true,
      hasProjectLength: true,
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
    maxOutputTokens: 256,
  }
}

function parseArgs(args: string[]): Record<string, string> {
  const parsed: Record<string, string> = {}
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === "--dry-run") {
      parsed["dry-run"] = "true"
      continue
    }
    if (!arg.startsWith("--")) continue
    const key = arg.slice(2)
    const next = args[index + 1]
    if (next && !next.startsWith("--")) {
      parsed[key] = next
      index += 1
    }
  }
  return parsed
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "")
}

function print(result: SmokeResult): void {
  console.log(JSON.stringify(result, null, 2))
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
