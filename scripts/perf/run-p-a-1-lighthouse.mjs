import fs from "node:fs/promises"
import path from "node:path"
import puppeteer from "puppeteer-core"
import { startFlow } from "lighthouse/core/index.js"

const RUNS = Number(process.env.PA1_RUNS ?? "3")
const RUN_START = Number(process.env.PA1_RUN_START ?? "1")
const BASE_URL = process.env.PA1_BASE_URL ?? "http://127.0.0.1:41238"
const OUTPUT_DIR = path.resolve(process.cwd(), process.env.PA1_OUTPUT_DIR ?? "reports/perf/p-a-1")
const CHROME_PATH =
  process.env.PA1_CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
const PROFILE_FILTER = parseFilter(process.env.PA1_PROFILES)
const SCENARIO_FILTER = parseFilter(process.env.PA1_SCENARIOS)

const profiles = [
  {
    id: "mobile",
    label: "mobile",
    viewport: { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
    settings: {
      formFactor: "mobile",
      throttlingMethod: "devtools",
      screenEmulation: {
        mobile: true,
        width: 390,
        height: 844,
        deviceScaleFactor: 3,
        disabled: false,
      },
    },
  },
  {
    id: "desktop",
    label: "desktop",
    viewport: { width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
    settings: {
      formFactor: "desktop",
      throttlingMethod: "devtools",
      screenEmulation: {
        mobile: false,
        width: 1440,
        height: 900,
        deviceScaleFactor: 1,
        disabled: false,
      },
    },
  },
]

const scenarios = [
  {
    id: "home",
    label: "top",
    url: `${BASE_URL}/`,
    async interact(page) {
      const selector = '[aria-label="プロフィール写真を拡大表示"]'
      await page.waitForSelector(selector, { visible: true, timeout: 15000 })
      await page.$eval(selector, (node) => node.scrollIntoView({ block: "center", inline: "center" }))
      await page.click(selector)
      await page.waitForSelector('button[aria-label="閉じる"]', { visible: true, timeout: 15000 })
      await page.click('button[aria-label="閉じる"]')
      const input = 'textarea[aria-label="相談内容"]'
      await page.waitForSelector(input, { visible: true, timeout: 15000 })
      await page.click(input)
      await page.type(input, "パフォーマンス確認")
    },
  },
  {
    id: "reservation",
    label: "reservation",
    url: `${BASE_URL}/booking`,
    async interact(page) {
      const selector = 'input[name="magic-link-email"]'
      await page.waitForSelector(selector, { visible: true, timeout: 15000 })
      await page.click(selector)
      await page.type(selector, "audit@example.com")
    },
  },
  {
    id: "chatbot",
    label: "chatbot",
    url: `${BASE_URL}/#contact`,
    async interact(page) {
      const selector = 'textarea[aria-label="相談内容"]'
      await page.waitForSelector(selector, { visible: true, timeout: 15000 })
      await page.click(selector)
      await page.type(selector, "パフォーマンス確認")
    },
  },
]

function parseFilter(value) {
  if (!value) return null
  const entries = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
  return entries.length > 0 ? new Set(entries) : null
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

function round(value, digits = 1) {
  if (!Number.isFinite(value)) return null
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function normalizeAssetPath(url) {
  try {
    const parsed = new URL(url)
    if (!parsed.hostname.endsWith("127.0.0.1") && parsed.hostname !== "localhost") return null
    return `${parsed.pathname}${parsed.search}`
  } catch {
    return null
  }
}

function summarizeNetwork(items) {
  const totals = {
    totalTransferSize: 0,
    totalResourceSize: 0,
    byType: {},
  }
  for (const item of items) {
    const resourceType = item.resourceType || "other"
    const transferSize = Number(item.transferSize || 0)
    const resourceSize = Number(item.resourceSize || 0)
    totals.totalTransferSize += transferSize
    totals.totalResourceSize += resourceSize
    totals.byType[resourceType] ??= { transferSize: 0, resourceSize: 0, count: 0 }
    totals.byType[resourceType].transferSize += transferSize
    totals.byType[resourceType].resourceSize += resourceSize
    totals.byType[resourceType].count += 1
  }
  return totals
}

function extractImageInventory(images) {
  return images
    .map((image) => {
      const assetPath = normalizeAssetPath(image.currentSrc || image.src)
      if (!assetPath) return null
      return {
        assetPath,
        loading: image.loading || "auto",
        fetchPriority: image.fetchPriority || "auto",
        decoding: image.decoding || "auto",
        width: image.naturalWidth || 0,
        height: image.naturalHeight || 0,
      }
    })
    .filter(Boolean)
}

async function ensureDirectory(dirPath) {
  await fs.mkdir(dirPath, { recursive: true })
}

function serializeError(error) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack ?? null,
    }
  }
  return {
    name: "Error",
    message: String(error),
    stack: null,
  }
}

function toSerializableSummary(summary) {
  return {
    ...summary,
    assetInventory: {
      images: Object.fromEntries(
        Object.entries(summary.assetInventory.images).map(([assetPath, image]) => [
          assetPath,
          {
            ...image,
            loading: [...image.loading],
            fetchPriority: [...image.fetchPriority],
            decoding: [...image.decoding],
            dimensions: [...image.dimensions],
            routes: [...image.routes],
          },
        ]),
      ),
      networkAssets: Object.fromEntries(
        Object.entries(summary.assetInventory.networkAssets).map(([assetPath, asset]) => [
          assetPath,
          {
            ...asset,
            routes: [...asset.routes],
          },
        ]),
      ),
    },
  }
}

async function collectDomSnapshot(page) {
  return page.evaluate(() => ({
    images: Array.from(document.images).map((image) => ({
      src: image.getAttribute("src"),
      currentSrc: image.currentSrc,
      loading: image.getAttribute("loading"),
      fetchPriority: image.getAttribute("fetchpriority"),
      decoding: image.getAttribute("decoding"),
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
    })),
  }))
}

const rawDir = path.join(OUTPUT_DIR, "lighthouse-raw")
const summaryJsonPath = path.join(OUTPUT_DIR, "lighthouse-summary.json")
await ensureDirectory(rawDir)

const selectedProfiles = profiles.filter((profile) => !PROFILE_FILTER || PROFILE_FILTER.has(profile.id))
const selectedScenarios = scenarios.filter((scenario) => !SCENARIO_FILTER || SCENARIO_FILTER.has(scenario.id))

if (selectedProfiles.length === 0) {
  throw new Error(`No matching profiles for filter: ${process.env.PA1_PROFILES}`)
}

if (selectedScenarios.length === 0) {
  throw new Error(`No matching scenarios for filter: ${process.env.PA1_SCENARIOS}`)
}

const summary = {
  generatedAt: new Date().toISOString(),
  baseUrl: BASE_URL,
  runs: RUNS,
  filters: {
    profiles: selectedProfiles.map((profile) => profile.id),
    scenarios: selectedScenarios.map((scenario) => scenario.id),
  },
  profiles: {},
  routeTransfer: {},
  assetInventory: {
    images: {},
    networkAssets: {},
  },
  errors: [],
}

async function writeSummaryFiles() {
  const serialized = JSON.stringify(toSerializableSummary(summary), null, 2)
  await fs.writeFile(summaryJsonPath, serialized)
  return serialized
}

let browser
let finalSerializedSummary = ""

try {
  browser = await puppeteer.launch({
    headless: true,
    executablePath: CHROME_PATH,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  })

  for (const profile of selectedProfiles) {
    summary.profiles[profile.id] = {}
    for (const scenario of selectedScenarios) {
      const scenarioKey = `${scenario.id}:${profile.id}`
      const runResults = []

      for (let run = RUN_START; run < RUN_START + RUNS; run += 1) {
        let page
        try {
          page = await browser.newPage()
          await page.setViewport(profile.viewport)
          const flow = await startFlow(page, {
            name: scenarioKey,
            configContext: { settingsOverrides: profile.settings },
          })

          await flow.navigate(scenario.url, { stepName: `${scenarioKey}:navigation:${run}` })
          const domSnapshot = await collectDomSnapshot(page)
          await flow.startTimespan({ stepName: `${scenarioKey}:interaction:${run}` })
          await scenario.interact(page)
          await flow.endTimespan()
          const result = await flow.createFlowResult()
          await fs.writeFile(
            path.join(rawDir, `${scenario.id}-${profile.id}-run${run}.json`),
            JSON.stringify(result, null, 2),
          )

          const navigationStep = result.steps.find((step) => step.lhr?.gatherMode === "navigation")
          const timespanStep = result.steps.find((step) => step.lhr?.gatherMode === "timespan")
          if (!navigationStep?.lhr || !timespanStep?.lhr) {
            throw new Error(`Missing lighthouse steps for ${scenarioKey} run ${run}`)
          }

          const navLhr = navigationStep.lhr
          const tsLhr = timespanStep.lhr
          const networkItems = navLhr.audits["network-requests"]?.details?.items ?? []
          const networkSummary = summarizeNetwork(networkItems)
          const imageInventory = extractImageInventory(domSnapshot.images)

          for (const image of imageInventory) {
            summary.assetInventory.images[image.assetPath] ??= {
              assetPath: image.assetPath,
              loading: new Set(),
              fetchPriority: new Set(),
              decoding: new Set(),
              dimensions: new Set(),
              routes: new Set(),
            }
            const entry = summary.assetInventory.images[image.assetPath]
            entry.loading.add(image.loading)
            entry.fetchPriority.add(image.fetchPriority)
            entry.decoding.add(image.decoding)
            entry.dimensions.add(`${image.width}x${image.height}`)
            entry.routes.add(scenario.id)
          }

          for (const item of networkItems) {
            const assetPath = normalizeAssetPath(item.url)
            if (!assetPath) continue
            summary.assetInventory.networkAssets[assetPath] ??= {
              assetPath,
              resourceType: item.resourceType || "other",
              mimeType: item.mimeType || null,
              maxTransferSize: 0,
              maxResourceSize: 0,
              routes: new Set(),
            }
            const entry = summary.assetInventory.networkAssets[assetPath]
            entry.maxTransferSize = Math.max(entry.maxTransferSize, Number(item.transferSize || 0))
            entry.maxResourceSize = Math.max(entry.maxResourceSize, Number(item.resourceSize || 0))
            entry.routes.add(scenario.id)
          }

          runResults.push({
            run,
            routeId: scenario.id,
            targetUrl: scenario.url,
            requestedUrl: navLhr.requestedUrl,
            finalUrl: navLhr.finalDisplayedUrl || navLhr.finalUrl,
            performanceScore: navLhr.categories.performance?.score ?? null,
            lcpMs: navLhr.audits["largest-contentful-paint"]?.numericValue ?? null,
            inpMs: tsLhr.audits["interaction-to-next-paint"]?.numericValue ?? null,
            cls: navLhr.audits["cumulative-layout-shift"]?.numericValue ?? null,
            ttfbMs: navLhr.audits["server-response-time"]?.numericValue ?? null,
            routeTransfer: {
              totalTransferSize: networkSummary.totalTransferSize,
              totalResourceSize: networkSummary.totalResourceSize,
              byType: networkSummary.byType,
            },
          })
        } catch (error) {
          const serializedError = serializeError(error)
          runResults.push({
            run,
            routeId: scenario.id,
            targetUrl: scenario.url,
            error: serializedError,
          })
          summary.errors.push({
            profile: profile.id,
            scenario: scenario.id,
            run,
            error: serializedError,
          })
        } finally {
          if (page) {
            await page.close().catch(() => {})
          }
          finalSerializedSummary = await writeSummaryFiles()
        }
      }

      const successfulRuns = runResults.filter((result) => !result.error)
      const lcpValues = successfulRuns.map((result) => result.lcpMs).filter(Number.isFinite)
      const inpValues = successfulRuns.map((result) => result.inpMs).filter(Number.isFinite)
      const clsValues = successfulRuns.map((result) => result.cls).filter(Number.isFinite)
      const ttfbValues = successfulRuns.map((result) => result.ttfbMs).filter(Number.isFinite)
      const transferValues = successfulRuns
        .map((result) => result.routeTransfer.totalTransferSize)
        .filter(Number.isFinite)
      const transferTypes = [...new Set(successfulRuns.flatMap((result) => Object.keys(result.routeTransfer.byType ?? {})))]

      summary.profiles[profile.id][scenario.id] = {
        scenario: scenario.label,
        routeId: scenario.id,
        targetUrl: scenario.url,
        requestedUrl: successfulRuns[0]?.requestedUrl ?? scenario.url,
        finalUrl: successfulRuns[0]?.finalUrl ?? null,
        sampleCount: successfulRuns.length,
        failedRunCount: runResults.length - successfulRuns.length,
        runs: runResults,
        median: {
          lcpMs: round(median(lcpValues), 1),
          inpMs: round(median(inpValues), 1),
          cls: round(median(clsValues), 3),
          ttfbMs: round(median(ttfbValues), 1),
        },
      }
      summary.routeTransfer[scenarioKey] = {
        scenario: scenario.label,
        routeId: scenario.id,
        targetUrl: scenario.url,
        profile: profile.label,
        medianTotalTransferSize: round(median(transferValues), 0),
        samples: successfulRuns.map((result) => result.routeTransfer.totalTransferSize),
        medianByType: Object.fromEntries(
          transferTypes.map((type) => [
            type,
            round(
              median(
                successfulRuns
                  .map((result) => result.routeTransfer.byType[type]?.transferSize ?? 0)
                  .filter(Number.isFinite),
              ),
              0,
            ),
          ]),
        ),
      }
      finalSerializedSummary = await writeSummaryFiles()
    }
  }
} finally {
  if (browser) {
    await browser.close().catch(() => {})
  }
  finalSerializedSummary = await writeSummaryFiles()
}

console.log(finalSerializedSummary)
