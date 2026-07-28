import fs from "node:fs/promises"
import path from "node:path"
import zlib from "node:zlib"
import vm from "node:vm"
import { execFileSync } from "node:child_process"
import puppeteer from "puppeteer-core"

const BASE_URL = process.env.PA1_BASE_URL ?? "http://127.0.0.1:41238"
const OUTPUT_DIR = path.resolve(process.cwd(), process.env.PA1_OUTPUT_DIR ?? "reports/perf/p-a-1")
const RAW_DIR = path.join(OUTPUT_DIR, "lighthouse-raw")
const CHROME_PATH =
  process.env.PA1_CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

const profiles = [
  {
    id: "mobile",
    label: "mobile",
    viewport: { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  },
  {
    id: "desktop",
    label: "desktop",
    viewport: { width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  },
]

const scenarios = [
  {
    id: "home",
    label: "top",
    reportRoute: "/",
    routeUrl: `${BASE_URL}/`,
    waitSelector: '[aria-label="プロフィール写真を拡大表示"]',
  },
  {
    id: "reservation",
    label: "reservation",
    reportRoute: "/booking",
    routeUrl: `${BASE_URL}/booking`,
    waitSelector: 'input[name="magic-link-email"]',
  },
  {
    id: "chatbot",
    label: "chatbot",
    reportRoute: "/#contact",
    routeUrl: `${BASE_URL}/#contact`,
    waitSelector: 'textarea[aria-label="相談内容"]',
  },
]

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

function routeTransferSummary(networkItems) {
  const byType = {}
  let totalTransferSize = 0
  let totalResourceSize = 0
  for (const item of networkItems) {
    const resourceType = item.resourceType || "other"
    const transferSize = Number(item.transferSize || 0)
    const resourceSize = Number(item.resourceSize || 0)
    totalTransferSize += transferSize
    totalResourceSize += resourceSize
    byType[resourceType] ??= { transferSize: 0, resourceSize: 0, count: 0 }
    byType[resourceType].transferSize += transferSize
    byType[resourceType].resourceSize += resourceSize
    byType[resourceType].count += 1
  }
  return { totalTransferSize, totalResourceSize, byType }
}

function parseRawFileName(fileName) {
  const match = fileName.match(/^(home|reservation|chatbot)-(mobile|desktop)-run(\d+)\.json$/)
  if (!match) return null
  return { scenarioId: match[1], profileId: match[2], run: Number(match[3]) }
}

function toSerializableSetRecord(record) {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, value instanceof Set ? [...value].sort() : value]),
  )
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"))
}

async function collectTargetMetadata() {
  let serverBuildInfo = null
  try {
    const response = await fetch(`${BASE_URL}/api/chatbot/build-info`)
    if (response.ok) serverBuildInfo = await response.json()
  } catch {
    // The report remains usable for build-only analysis when no local server is available.
  }
  return {
    auditCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    serverBuildInfo,
  }
}

async function aggregateRawResults() {
  const files = (await fs.readdir(RAW_DIR)).filter((fileName) => fileName.endsWith(".json")).sort()
  const groupedRuns = {}
  const networkAssets = {}

  for (const fileName of files) {
    const parsed = parseRawFileName(fileName)
    if (!parsed) continue
    const scenario = scenarios.find((entry) => entry.id === parsed.scenarioId)
    const profile = profiles.find((entry) => entry.id === parsed.profileId)
    if (!scenario || !profile) continue

    const result = await readJson(path.join(RAW_DIR, fileName))
    const navigationStep = result.steps.find((step) => step.lhr?.gatherMode === "navigation")
    const timespanStep = result.steps.find((step) => step.lhr?.gatherMode === "timespan")
    if (!navigationStep?.lhr || !timespanStep?.lhr) {
      throw new Error(`Missing lighthouse steps in ${fileName}`)
    }

    const navLhr = navigationStep.lhr
    const tsLhr = timespanStep.lhr
    const networkItems = navLhr.audits["network-requests"]?.details?.items ?? []
    const transfer = routeTransferSummary(networkItems)

    const groupKey = `${parsed.scenarioId}:${parsed.profileId}`
    groupedRuns[groupKey] ??= {
      scenario: scenario.label,
      routeId: scenario.id,
      targetUrl: scenario.routeUrl,
      reportRoute: scenario.reportRoute,
      profile: profile.label,
      profileId: profile.id,
      runs: [],
    }
    groupedRuns[groupKey].runs.push({
      run: parsed.run,
      rawFile: path.join("reports", "perf", "p-a-1", "lighthouse-raw", fileName),
      requestedUrl: navLhr.requestedUrl,
      finalUrl: navLhr.finalDisplayedUrl || navLhr.finalUrl,
      performanceScore: navLhr.categories.performance?.score ?? null,
      lcpMs: navLhr.audits["largest-contentful-paint"]?.numericValue ?? null,
      inpMs: tsLhr.audits["interaction-to-next-paint"]?.numericValue ?? null,
      cls: navLhr.audits["cumulative-layout-shift"]?.numericValue ?? null,
      ttfbMs: navLhr.audits["server-response-time"]?.numericValue ?? null,
      routeTransfer: transfer,
    })

    for (const item of networkItems) {
      const assetPath = normalizeAssetPath(item.url)
      if (!assetPath) continue
      networkAssets[assetPath] ??= {
        assetPath,
        resourceTypes: new Set(),
        mimeTypes: new Set(),
        routes: new Set(),
        profiles: new Set(),
        maxTransferSize: 0,
        maxResourceSize: 0,
      }
      const asset = networkAssets[assetPath]
      asset.resourceTypes.add(item.resourceType || "other")
      if (item.mimeType) asset.mimeTypes.add(item.mimeType)
      asset.routes.add(parsed.scenarioId)
      asset.profiles.add(parsed.profileId)
      asset.maxTransferSize = Math.max(asset.maxTransferSize, Number(item.transferSize || 0))
      asset.maxResourceSize = Math.max(asset.maxResourceSize, Number(item.resourceSize || 0))
    }
  }

  const profileSummary = {}
  const routeTransfer = {}
  for (const { routeId, profileId, scenario, reportRoute, targetUrl, profile, runs } of Object.values(groupedRuns)) {
    profileSummary[profileId] ??= {}
    runs.sort((a, b) => a.run - b.run)
    const lcpValues = runs.map((run) => run.lcpMs).filter(Number.isFinite)
    const inpValues = runs.map((run) => run.inpMs).filter(Number.isFinite)
    const clsValues = runs.map((run) => run.cls).filter(Number.isFinite)
    const ttfbValues = runs.map((run) => run.ttfbMs).filter(Number.isFinite)
    const transferValues = runs.map((run) => run.routeTransfer.totalTransferSize).filter(Number.isFinite)
    const transferTypes = [...new Set(runs.flatMap((run) => Object.keys(run.routeTransfer.byType)))]
    profileSummary[profileId][routeId] = {
      scenario,
      routeId,
      reportRoute,
      targetUrl,
      requestedUrl: runs[0]?.requestedUrl ?? targetUrl,
      finalUrl: runs[0]?.finalUrl ?? null,
      sampleCount: runs.length,
      runs,
      median: {
        lcpMs: round(median(lcpValues), 1),
        inpMs: round(median(inpValues), 1),
        cls: round(median(clsValues), 3),
        ttfbMs: round(median(ttfbValues), 1),
        totalTransferSize: round(median(transferValues), 0),
      },
    }
    routeTransfer[`${routeId}:${profileId}`] = {
      routeId,
      profile,
      reportRoute,
      targetUrl,
      medianTotalTransferSize: round(median(transferValues), 0),
      samples: runs.map((run) => run.routeTransfer.totalTransferSize),
      medianByType: Object.fromEntries(
        transferTypes.map((type) => [
          type,
          round(
            median(runs.map((run) => run.routeTransfer.byType[type]?.transferSize ?? 0).filter(Number.isFinite)),
            0,
          ),
        ]),
      ),
    }
  }

  const assetInventory = {
    networkAssets: Object.values(networkAssets)
      .map((asset) => ({
        ...toSerializableSetRecord(asset),
      }))
      .sort((a, b) => b.maxTransferSize - a.maxTransferSize || a.assetPath.localeCompare(b.assetPath)),
  }

  return {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    runsPerScenarioProfile: 3,
    profiles: profileSummary,
    routeTransfer,
    assetInventory,
  }
}

async function crawlImageInventory() {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: CHROME_PATH,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  })

  const inventory = {}
  try {
    const profile = profiles.find((entry) => entry.id === "desktop")
    for (const scenario of scenarios) {
        const page = await browser.newPage()
        try {
          await page.setViewport(profile.viewport)
          await page.goto(scenario.routeUrl, { waitUntil: "domcontentloaded", timeout: 30000 })
          await page.waitForSelector(scenario.waitSelector, { visible: true, timeout: 15000 })
          const snapshot = await page.evaluate(() => ({
            finalUrl: window.location.href,
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

          for (const image of snapshot.images) {
            const assetPath = normalizeAssetPath(image.currentSrc || image.src)
            if (!assetPath) continue
            inventory[assetPath] ??= {
              assetPath,
              loading: new Set(),
              fetchPriority: new Set(),
              decoding: new Set(),
              naturalDimensions: new Set(),
              routes: new Set(),
              profiles: new Set(),
              finalUrls: new Set(),
            }
            const entry = inventory[assetPath]
            entry.loading.add(image.loading || "auto")
            entry.fetchPriority.add(image.fetchPriority || "auto")
            entry.decoding.add(image.decoding || "auto")
            entry.naturalDimensions.add(`${image.naturalWidth || 0}x${image.naturalHeight || 0}`)
            entry.routes.add(scenario.id)
            entry.profiles.add(profile.id)
            entry.finalUrls.add(snapshot.finalUrl)
          }
        } finally {
          await page.close().catch(() => {})
        }
    }
  } finally {
    await browser.close().catch(() => {})
  }

  return Object.values(inventory)
    .map((image) => ({
      ...toSerializableSetRecord(image),
    }))
    .sort((a, b) => a.assetPath.localeCompare(b.assetPath))
}

function humanBytes(bytes) {
  if (!Number.isFinite(bytes)) return "0 B"
  const units = ["B", "KB", "MB"]
  let value = bytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${round(value, unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}

async function readFileSizes(rootDir, assetFiles) {
  const results = {}
  for (const file of assetFiles) {
    const diskPath = path.join(rootDir, file.replace(/^\//, ""))
    const content = await fs.readFile(diskPath)
    results[file] = {
      rawBytes: content.byteLength,
      gzipBytes: zlib.gzipSync(content).byteLength,
      brotliBytes: zlib.brotliCompressSync(content).byteLength,
    }
  }
  return results
}

async function readClientReferenceManifest(filePath) {
  const source = await fs.readFile(filePath, "utf8")
  const sandbox = { globalThis: {} }
  sandbox.globalThis.globalThis = sandbox.globalThis
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox, { filename: filePath })
  const manifests = sandbox.globalThis.__RSC_MANIFEST
  const manifestKey = Object.keys(manifests)[0]
  return manifests[manifestKey]
}

async function analyzeBuildArtifacts() {
  const nextDir = path.resolve(process.cwd(), ".next")
  const buildManifest = await readJson(path.join(nextDir, "build-manifest.json"))

  const routeToManifestPath = {
    home: path.join(nextDir, "server", "app", "page_client-reference-manifest.js"),
    chatbot: path.join(nextDir, "server", "app", "page_client-reference-manifest.js"),
    reservation: path.join(nextDir, "server", "app", "booking", "page_client-reference-manifest.js"),
  }
  const baseFiles = [...new Set([...(buildManifest.polyfillFiles ?? []), ...(buildManifest.rootMainFiles ?? [])])]
    .filter((file) => file.startsWith("static/"))
    .sort()
  const sharedByFile = {}
  const perScenario = {}
  const fileSet = new Set()

  for (const scenario of scenarios) {
    const manifest = await readClientReferenceManifest(routeToManifestPath[scenario.id])
    const moduleFiles = Object.values(manifest.clientModules ?? {}).flatMap((entry) => entry.chunks ?? [])
    const cssFiles = Object.values(manifest.entryCSSFiles ?? {}).flatMap((entries) => entries.map((entry) => entry.path))
    const files = [...new Set([...baseFiles, ...moduleFiles, ...cssFiles])]
      .filter((file) => file.startsWith("static/"))
      .sort()
    for (const file of files) {
      sharedByFile[file] ??= new Set()
      sharedByFile[file].add(scenario.id)
      fileSet.add(file)
    }
    perScenario[scenario.id] = {
      routeId: scenario.id,
      reportRoute: scenario.reportRoute,
      manifestPath: path.relative(process.cwd(), routeToManifestPath[scenario.id]),
      files,
    }
  }

  const fileSizes = await readFileSizes(nextDir, [...fileSet])

  for (const scenario of Object.values(perScenario)) {
    const jsFiles = scenario.files.filter((file) => file.endsWith(".js"))
    const cssFiles = scenario.files.filter((file) => file.endsWith(".css"))
    scenario.initialAssets = {
      jsFiles,
      cssFiles,
      jsRawBytes: jsFiles.reduce((sum, file) => sum + fileSizes[file].rawBytes, 0),
      jsGzipBytes: jsFiles.reduce((sum, file) => sum + fileSizes[file].gzipBytes, 0),
      cssRawBytes: cssFiles.reduce((sum, file) => sum + fileSizes[file].rawBytes, 0),
      cssGzipBytes: cssFiles.reduce((sum, file) => sum + fileSizes[file].gzipBytes, 0),
    }
    scenario.codeSplitting = {
      sharedFiles: scenario.files.filter((file) => sharedByFile[file].size > 1),
      exclusiveFiles: scenario.files.filter((file) => sharedByFile[file].size === 1),
    }
  }

  const sharedChunks = Object.entries(sharedByFile)
    .map(([file, routes]) => ({
      file,
      routes: [...routes].sort(),
      rawBytes: fileSizes[file].rawBytes,
      gzipBytes: fileSizes[file].gzipBytes,
      brotliBytes: fileSizes[file].brotliBytes,
    }))
    .sort((a, b) => b.gzipBytes - a.gzipBytes || a.file.localeCompare(b.file))

  return {
    generatedAt: new Date().toISOString(),
    scenarios: perScenario,
    sharedChunks,
  }
}

function assetType(relativePath) {
  const extension = path.extname(relativePath).slice(1).toLowerCase()
  if (["avif", "gif", "jpg", "jpeg", "png", "svg", "webp"].includes(extension)) return "image"
  if (["woff", "woff2", "ttf", "otf"].includes(extension)) return "font"
  if (extension === "js") return "js"
  if (extension === "css") return "css"
  return extension || "other"
}

async function listFiles(rootDir) {
  const entries = await fs.readdir(rootDir, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const filePath = path.join(rootDir, entry.name)
      return entry.isDirectory() ? listFiles(filePath) : [filePath]
    }),
  )
  return files.flat()
}

async function inventoryDiskAssets(networkAssets, imageAssets) {
  const observations = new Map()
  for (const asset of networkAssets) {
    observations.set(asset.assetPath.split("?")[0], asset)
    if (asset.assetPath.startsWith("/_next/image?")) {
      const sourcePath = new URL(`http://localhost${asset.assetPath}`).searchParams.get("url")
      if (sourcePath?.startsWith("/")) observations.set(sourcePath, asset)
    }
  }
  const imageObservations = new Map()
  for (const asset of imageAssets) {
    imageObservations.set(asset.assetPath.split("?")[0], asset)
    if (asset.assetPath.startsWith("/_next/image?")) {
      const sourcePath = new URL(`http://localhost${asset.assetPath}`).searchParams.get("url")
      if (sourcePath?.startsWith("/")) imageObservations.set(sourcePath, asset)
    }
  }
  const targets = [
    { root: path.resolve(process.cwd(), "public"), prefix: "/", origin: "public" },
    { root: path.resolve(process.cwd(), ".next", "static"), prefix: "/_next/static/", origin: "next-static" },
  ]
  const assets = []
  for (const target of targets) {
    for (const filePath of await listFiles(target.root)) {
      const relativePath = path.relative(target.root, filePath).split(path.sep).join("/")
      const assetPath = `${target.prefix}${relativePath}`
      const content = await fs.readFile(filePath)
      const network = observations.get(assetPath)
      const image = imageObservations.get(assetPath)
      assets.push({
        assetPath,
        origin: target.origin,
        type: assetType(assetPath),
        format: path.extname(assetPath).slice(1).toLowerCase() || null,
        bytes: content.byteLength,
        observedTransferBytes: network?.maxTransferSize ?? null,
        observedRoutes: network?.routes ?? [],
        auditLoadState: network ? "loaded" : "not-loaded-on-audited-routes",
        loading: image?.loading ?? [],
        fetchPriority: image?.fetchPriority ?? [],
        decoding: image?.decoding ?? [],
        naturalDimensions: image?.naturalDimensions ?? [],
      })
    }
  }
  return assets.sort((a, b) => b.bytes - a.bytes || a.assetPath.localeCompare(b.assetPath))
}

function buildMarkdownReport({ targetMetadata, lighthouseSummary, diskAssets, buildAnalysis }) {
  const lines = []
  lines.push("# P-A-1 frontend audit")
  lines.push("")
  lines.push(`Generated at: ${new Date().toISOString()}`)
  lines.push(`Audit commit: ${targetMetadata.auditCommit}`)
  if (targetMetadata.serverBuildInfo?.commitSha) {
    lines.push(`Measured server commit: ${targetMetadata.serverBuildInfo.commitSha}`)
  }
  lines.push("")
  lines.push("## Lighthouse medians")
  lines.push("")
  lines.push("| Route | Profile | Samples | LCP ms | INP ms | CLS | TTFB ms | Transfer | Final URL |")
  lines.push("| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |")
  for (const profile of profiles) {
    for (const scenario of scenarios) {
      const entry = lighthouseSummary.profiles[profile.id]?.[scenario.id]
      if (!entry) continue
      lines.push(
        `| ${scenario.id} | ${profile.id} | ${entry.sampleCount} | ${entry.median.lcpMs} | ${entry.median.inpMs} | ${entry.median.cls} | ${entry.median.ttfbMs} | ${humanBytes(entry.median.totalTransferSize)} | ${entry.finalUrl ?? ""} |`,
      )
    }
  }
  lines.push("")
  lines.push("## Top heavy assets")
  lines.push("")
  lines.push("| Asset | Type | Format | Transfer | Resource | Routes | Lazy loading |")
  lines.push("| --- | --- | --- | ---: | ---: | --- | --- |")
  for (const asset of diskAssets.slice(0, 30)) {
    lines.push(
      `| ${asset.assetPath} | ${asset.type} | ${asset.format ?? ""} | ${humanBytes(asset.observedTransferBytes)} | ${humanBytes(asset.bytes)} | ${asset.observedRoutes.join(", ")} | ${asset.loading.join(", ") || asset.auditLoadState} |`,
    )
  }
  lines.push("")
  lines.push("## Build bundle analysis")
  lines.push("")
  lines.push("| Route | Next route | JS gzip | CSS gzip | JS files | CSS files | Exclusive chunks |")
  lines.push("| --- | --- | ---: | ---: | ---: | ---: | ---: |")
  for (const scenario of scenarios) {
    const entry = buildAnalysis.scenarios[scenario.id]
    if (!entry) continue
    lines.push(
      `| ${scenario.id} | ${entry.reportRoute} | ${humanBytes(entry.initialAssets.jsGzipBytes)} | ${humanBytes(entry.initialAssets.cssGzipBytes)} | ${entry.initialAssets.jsFiles.length} | ${entry.initialAssets.cssFiles.length} | ${entry.codeSplitting.exclusiveFiles.length} |`,
    )
  }
  return `${lines.join("\n")}\n`
}

const lighthouseSummary = await aggregateRawResults()
const imageAssets = await crawlImageInventory()
const buildAnalysis = await analyzeBuildArtifacts()
const diskAssets = await inventoryDiskAssets(lighthouseSummary.assetInventory.networkAssets, imageAssets)
const targetMetadata = await collectTargetMetadata()

const mergedReport = {
  generatedAt: new Date().toISOString(),
  targetMetadata,
  lighthouseSummary,
  imageAssets,
  diskAssets,
  buildAnalysis,
}

await fs.writeFile(path.join(OUTPUT_DIR, "lighthouse-summary.json"), JSON.stringify(lighthouseSummary, null, 2))
await fs.writeFile(path.join(OUTPUT_DIR, "asset-inventory.json"), JSON.stringify(imageAssets, null, 2))
await fs.writeFile(path.join(OUTPUT_DIR, "disk-asset-inventory.json"), JSON.stringify(diskAssets, null, 2))
await fs.writeFile(path.join(OUTPUT_DIR, "bundle-analysis.json"), JSON.stringify(buildAnalysis, null, 2))
await fs.writeFile(path.join(OUTPUT_DIR, "p-a-1-report.json"), JSON.stringify(mergedReport, null, 2))
await fs.writeFile(
  path.join(OUTPUT_DIR, "p-a-1-report.md"),
  buildMarkdownReport({ targetMetadata, lighthouseSummary, diskAssets, buildAnalysis }),
)

console.log(
  JSON.stringify(
    {
      report: path.join("reports", "perf", "p-a-1", "p-a-1-report.json"),
      markdown: path.join("reports", "perf", "p-a-1", "p-a-1-report.md"),
    },
    null,
    2,
  ),
)
