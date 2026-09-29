import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { performance } from "node:perf_hooks"
import { fileURLToPath } from "node:url"

type ChatMessage = {
  role: "system" | "user"
  content: string
}

type OllamaChatResponse = {
  message?: {
    content?: unknown
  }
  eval_count?: unknown
  eval_duration?: unknown
}

type SampleResult = {
  label: string
  outputTokens: number
  elapsedSeconds: number
  tps: number
  rawTextPreview: string
}

type RunSet = {
  label: string
  options?: Record<string, number>
  samples: SampleResult[]
  averageTps: number
  p50Tps: number
  p95Tps: number
}

const modelName =
  process.env.CHATBOT_TIER2_MODEL ??
  "hf.co/mmnga/cyberagent-DeepSeek-R1-Distill-Qwen-14B-Japanese-gguf:Q4_K_M"
const baseUrl = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434"
const docsDir = path.resolve(projectRoot(), "docs", "chatbot")
const baselineDocPath = path.join(docsDir, "tier2-tps-baseline.md")
const resultDocPath = path.join(docsDir, "tier1-tier2-smoke-result.md")
const tuneAverageTpsThreshold = 5
const baseOllamaOptions = { num_predict: 192 } as const

const systemPrompt =
  "あなたはのりかね映像設計室の新規案件相談窓口です。金額は提示せず、所要日数の目安だけを簡潔に返してください。"

const prompts = [
  {
    label: "CM 30 秒",
    content: "fake 顧客です。CM 30 秒で追加作業なしの相談です。所要日数だけ教えてください。",
  },
  {
    label: "MV 5 分",
    content: "fake 顧客です。MV 5 分で追加作業なしの相談です。所要日数だけ教えてください。",
  },
  {
    label: "本編 90 分",
    content: "fake 顧客です。本編 90 分で追加作業なしの相談です。所要日数だけ教えてください。",
  },
  {
    label: "ドラマ初回",
    content: "fake 顧客です。ドラマ初回で追加作業なしの相談です。所要日数だけ教えてください。",
  },
  {
    label: "縦型 60 秒",
    content: "fake 顧客です。縦型 60 秒で追加作業なしの相談です。所要日数だけ教えてください。",
  },
]

async function main(): Promise<void> {
  await ensureModelIsAvailable()
  const baseline = await runSet("baseline")
  const runs = [baseline]

  if (baseline.averageTps < tuneAverageTpsThreshold) {
    runs.push(await runSet("tuned-num_thread-12", { num_thread: 12 }))
  }

  await writeBaselineDoc(runs)
  await writeResultSection(runs)

  const finalRun = runs[runs.length - 1]
  console.log(
    JSON.stringify(
      {
        modelName,
        baseline: summarizeRun(baseline),
        final: summarizeRun(finalRun),
      },
      null,
      2,
    ),
  )
}

async function ensureModelIsAvailable(): Promise<void> {
  const response = await fetch(`${baseUrl}/api/tags`)
  if (!response.ok) throw new Error(`Ollama tags request failed: ${response.status}`)

  const payload = (await response.json()) as { models?: Array<{ name?: string; model?: string }> }
  const found = payload.models?.some((model) => model.name === modelName || model.model === modelName)
  if (!found) throw new Error(`Ollama model is not available: ${modelName}`)
}

async function runSet(label: string, options?: Record<string, number>): Promise<RunSet> {
  const samples: SampleResult[] = []

  for (const prompt of prompts) {
    samples.push(await runSample(prompt.label, prompt.content, options))
  }

  const values = samples.map((sample) => sample.tps)

  return {
    label,
    options,
    samples,
    averageTps: average(values),
    p50Tps: percentile(values, 0.5),
    p95Tps: percentile(values, 0.95),
  }
}

async function runSample(
  label: string,
  content: string,
  options?: Record<string, number>,
): Promise<SampleResult> {
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content },
  ]
  const startedAt = performance.now()
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: modelName,
      messages,
      stream: false,
      options: {
        ...baseOllamaOptions,
        ...options,
      },
      keep_alive: "5m",
    }),
  })
  const elapsedSeconds = (performance.now() - startedAt) / 1000

  if (!response.ok) throw new Error(`Ollama chat request failed: ${response.status}`)

  const payload = (await response.json()) as OllamaChatResponse
  const rawText = typeof payload.message?.content === "string" ? payload.message.content : ""
  const outputTokens = typeof payload.eval_count === "number" ? payload.eval_count : countFallbackTokens(rawText)
  const tps = outputTokens / elapsedSeconds

  return {
    label,
    outputTokens,
    elapsedSeconds,
    tps,
    rawTextPreview: preview(rawText),
  }
}

async function writeBaselineDoc(runs: RunSet[]): Promise<void> {
  const lines = [
    "# Tier 2 Ollama TPS baseline",
    "",
    `model: ${modelName}`,
    `baseUrl: ${baseUrl}`,
    `baseOptions: ${JSON.stringify(baseOllamaOptions)}`,
    "",
    ...runs.flatMap((run) => [
      `## ${run.label}`,
      `options: ${JSON.stringify({ ...baseOllamaOptions, ...run.options })}`,
      `averageTps: ${formatNumber(run.averageTps)}`,
      `p50Tps: ${formatNumber(run.p50Tps)}`,
      `p95Tps: ${formatNumber(run.p95Tps)}`,
      "",
      "| prompt | outputTokens | elapsedSeconds | tps | rawTextPreview |",
      "| --- | ---: | ---: | ---: | --- |",
      ...run.samples.map(
        (sample) =>
          `| ${sample.label} | ${sample.outputTokens} | ${formatNumber(sample.elapsedSeconds)} | ${formatNumber(
            sample.tps,
          )} | ${escapeTable(sample.rawTextPreview)} |`,
      ),
      "",
    ]),
  ]

  await writeFile(baselineDocPath, `${lines.join("\n").trimEnd()}\n`, "utf-8")
}

async function writeResultSection(runs: RunSet[]): Promise<void> {
  const finalRun = runs[runs.length - 1]
  const tunedLine =
    runs.length > 1
      ? `- tuned: ${runs[1].label} averageTps=${formatNumber(runs[1].averageTps)} p50=${formatNumber(
          runs[1].p50Tps,
        )} p95=${formatNumber(runs[1].p95Tps)}`
      : "- tuned: not-run"

  await upsertSection(
    resultDocPath,
    "## Tier 2 Ollama TPS",
    `## Tier 2 Ollama TPS
- status: pass
- model: ${modelName}
- baselineAverageTps: ${formatNumber(runs[0].averageTps)}
- baselineP50Tps: ${formatNumber(runs[0].p50Tps)}
- baselineP95Tps: ${formatNumber(runs[0].p95Tps)}
${tunedLine}
- finalAverageTps: ${formatNumber(finalRun.averageTps)}
- finalP50Tps: ${formatNumber(finalRun.p50Tps)}
- finalP95Tps: ${formatNumber(finalRun.p95Tps)}
- baselineDoc: docs/chatbot/tier2-tps-baseline.md
`,
  )
}

async function upsertSection(filePath: string, heading: string, nextSection: string): Promise<void> {
  const current = await readFile(filePath, "utf-8").catch(() => "# Tier 1 / Tier 2 smoke result\n")
  const headingIndex = current.indexOf(heading)
  const normalizedSection = `${nextSection.trim()}\n`

  if (headingIndex === -1) {
    await writeFile(filePath, `${current.trimEnd()}\n\n${normalizedSection}`, "utf-8")
    return
  }

  const nextHeadingIndex = current.indexOf("\n## ", headingIndex + heading.length)
  const before = current.slice(0, headingIndex).trimEnd()
  const after = nextHeadingIndex === -1 ? "" : current.slice(nextHeadingIndex).trimStart()
  await writeFile(filePath, `${before}\n\n${normalizedSection}${after ? `\n${after}` : ""}`, "utf-8")
}

function summarizeRun(run: RunSet) {
  return {
    label: run.label,
    averageTps: Number(formatNumber(run.averageTps)),
    p50Tps: Number(formatNumber(run.p50Tps)),
    p95Tps: Number(formatNumber(run.p95Tps)),
  }
}

function countFallbackTokens(text: string): number {
  return Math.max(1, Math.ceil(Array.from(text).length / 2))
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function percentile(values: number[], percentileValue: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * percentileValue) - 1)
  return sorted[index]
}

function preview(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 200)
}

function escapeTable(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ")
}

function formatNumber(value: number): string {
  return value.toFixed(2)
}

function projectRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
