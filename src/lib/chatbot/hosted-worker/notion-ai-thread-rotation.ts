/**
 * Moves the worker onto a fresh Notion AI thread.
 *
 * Notion mints thread ids server-side, and a client-minted id is rejected by the inference API, so
 * the only way to get a usable thread is to drive the page the way a person would: start a new
 * chat, type one seed message, send it, then read the `?t=` Notion puts in the URL.
 *
 * Each in-page step takes `document` explicitly so the same function can be stringified into the
 * page and called directly from a jsdom test.
 */

export const notionAiNewChatLabels = ["新規チャット", "New chat"] as const
export const notionAiComposerSelector = "[contenteditable='true'][role='textbox']"
export const notionAiSendButtonSelectors = [
  '[aria-label="AIメッセージを送信"]',
  '[aria-label="Send AI message"]',
] as const
export const notionAiClickableSelector = "[role=button],button,a,[tabindex]"

/** Permanent first turn of every rotated thread, so it says nothing about any customer. */
export const notionAiThreadRotationSeedMessage = "セッション開始"

export type NotionAiThreadRotationStage =
  | "read-current-url"
  | "new-chat"
  | "focus-composer"
  | "insert-seed"
  | "verify-seed"
  | "send-seed"
  | "await-thread-url"

export type NotionAiThreadRotationResult =
  | {
      ok: true
      threadUrl: string
      previousThreadUrl?: string
      durationMs: number
    }
  | {
      ok: false
      stage: NotionAiThreadRotationStage
      detail?: string
      previousThreadUrl?: string
      durationMs: number
    }

export function clickNotionAiNewChatInPage(doc: Document): { ok: boolean; matchCount: number } {
  const labels = ["新規チャット", "New chat"]
  const matches: Element[] = []
  // Scoped to the body so the document, head and body themselves cannot match on a sparse page.
  for (const element of Array.from(doc.body ? doc.body.querySelectorAll("*") : [])) {
    // jsdom does not implement innerText, and a real page hides text in collapsed nodes, so read
    // whichever is available.
    const text = ((element as HTMLElement).innerText ?? element.textContent ?? "").trim()
    if (labels.includes(text)) matches.push(element)
  }
  if (matches.length === 0) return { ok: false, matchCount: 0 }

  // Notion nests the label inside several wrappers that all report the same text. The deepest one
  // is the control; the wrappers above it do nothing when clicked.
  let deepest = matches[0]
  let deepestDepth = -1
  for (const element of matches) {
    let depth = 0
    for (let node = element.parentElement; node; node = node.parentElement) depth += 1
    if (depth >= deepestDepth) {
      deepest = element
      deepestDepth = depth
    }
  }

  const clickable = (deepest.closest("[role=button],button,a,[tabindex]") ?? deepest) as HTMLElement
  clickable.click()
  return { ok: true, matchCount: matches.length }
}

export function focusNotionAiComposerInPage(doc: Document): { ok: boolean; focused: boolean } {
  const composer = doc.querySelector("[contenteditable='true'][role='textbox']") as HTMLElement | null
  if (!composer) return { ok: false, focused: false }
  composer.focus()
  return { ok: true, focused: doc.activeElement === composer }
}

export function readNotionAiComposerTextInPage(doc: Document): { text: string } {
  const composer = doc.querySelector("[contenteditable='true'][role='textbox']") as HTMLElement | null
  return { text: ((composer?.innerText ?? composer?.textContent) || "").trim() }
}

export function clickNotionAiSendInPage(doc: Document): { ok: boolean; reason?: string } {
  const selectors = ['[aria-label="AIメッセージを送信"]', '[aria-label="Send AI message"]']
  for (const selector of selectors) {
    const button = doc.querySelector(selector) as HTMLElement | null
    if (!button) continue
    if (button.hasAttribute("disabled") || button.getAttribute("aria-disabled") === "true") {
      return { ok: false, reason: "disabled" }
    }
    button.click()
    return { ok: true }
  }
  return { ok: false, reason: "missing" }
}

function inPageExpression(fn: (doc: Document) => unknown): string {
  // Mirrors buildRunInferenceExpression: the esbuild helper shim has to exist in the page scope.
  return `(() => { const __name = (target) => target; return (${fn.toString()})(document); })()`
}

export const notionAiNewChatExpression = inPageExpression(clickNotionAiNewChatInPage)
export const notionAiFocusComposerExpression = inPageExpression(focusNotionAiComposerInPage)
export const notionAiReadComposerExpression = inPageExpression(readNotionAiComposerTextInPage)
export const notionAiSendExpression = inPageExpression(clickNotionAiSendInPage)
export const notionAiReadLocationExpression = `(() => ({ href: location.href }))()`

export function buildNotionAiNavigateExpression(url: string): string {
  return `(() => { location.assign(${JSON.stringify(url)}); return { href: ${JSON.stringify(url)} } })()`
}

export function readNotionAiThreadIdFromUrl(href: string): string | undefined {
  try {
    const value = new URL(href).searchParams.get("t")
    return value && /^[0-9a-f]{32}$/i.test(value) ? value : undefined
  } catch {
    return undefined
  }
}

export type NotionAiThreadRotationTimeouts = {
  stepMs: number
  insertMs: number
  awaitThreadUrlMs: number
  pollIntervalMs: number
  settleMs: number
}

const defaultTimeouts: NotionAiThreadRotationTimeouts = {
  stepMs: 5000,
  insertMs: 10000,
  awaitThreadUrlMs: 30000,
  pollIntervalMs: 500,
  settleMs: 3000,
}

export type NotionAiThreadRotationDeps = {
  evaluate<T>(expression: string, timeoutMs: number): Promise<T>
  insertText(text: string, timeoutMs: number): Promise<void>
  seedMessage?: string
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  timeouts?: Partial<NotionAiThreadRotationTimeouts>
}

export async function rotateNotionAiThread(
  deps: NotionAiThreadRotationDeps,
): Promise<NotionAiThreadRotationResult> {
  const timeouts = { ...defaultTimeouts, ...deps.timeouts }
  const now = deps.now ?? Date.now
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const seedMessage = deps.seedMessage ?? notionAiThreadRotationSeedMessage
  const startedAt = now()

  let previousThreadUrl: string | undefined
  const fail = (stage: NotionAiThreadRotationStage, detail?: string): NotionAiThreadRotationResult => ({
    ok: false,
    stage,
    detail,
    previousThreadUrl,
    durationMs: now() - startedAt,
  })

  try {
    const before = await deps.evaluate<{ href: string }>(notionAiReadLocationExpression, timeouts.stepMs)
    previousThreadUrl = before?.href
    const previousThreadId = previousThreadUrl ? readNotionAiThreadIdFromUrl(previousThreadUrl) : undefined

    const newChat = await deps.evaluate<{ ok: boolean; matchCount: number }>(
      notionAiNewChatExpression,
      timeouts.stepMs,
    )
    if (!newChat?.ok) return fail("new-chat", `matchCount=${newChat?.matchCount ?? 0}`)

    const focused = await deps.evaluate<{ ok: boolean; focused: boolean }>(
      notionAiFocusComposerExpression,
      timeouts.stepMs,
    )
    if (!focused?.ok) return fail("focus-composer")

    await deps.insertText(seedMessage, timeouts.insertMs)

    const composer = await deps.evaluate<{ text: string }>(notionAiReadComposerExpression, timeouts.stepMs)
    // Guards the regression this whole routine exists to avoid: setting textContent from an
    // evaluate looks like it worked but never reaches Notion's editor state.
    if (!composer?.text.includes(seedMessage)) return fail("verify-seed", `text=${composer?.text ?? ""}`)

    const sent = await deps.evaluate<{ ok: boolean; reason?: string }>(notionAiSendExpression, timeouts.stepMs)
    if (!sent?.ok) return fail("send-seed", sent?.reason)

    const deadline = now() + timeouts.awaitThreadUrlMs
    for (;;) {
      const current = await deps.evaluate<{ href: string }>(notionAiReadLocationExpression, timeouts.stepMs)
      const threadId = current?.href ? readNotionAiThreadIdFromUrl(current.href) : undefined
      if (threadId && threadId !== previousThreadId) {
        await sleep(timeouts.settleMs)
        return { ok: true, threadUrl: current.href, previousThreadUrl, durationMs: now() - startedAt }
      }
      if (now() >= deadline) return fail("await-thread-url")
      await sleep(timeouts.pollIntervalMs)
    }
  } catch (error) {
    return fail("read-current-url", error instanceof Error ? error.message : String(error))
  }
}

/**
 * Best effort return to the thread the worker was using. Without it a half-rotated tab can be left
 * on a blank chat with no `?t=`, which the Chrome health check reports as a permanent mismatch.
 */
export async function restoreNotionAiThreadPage(
  deps: Pick<NotionAiThreadRotationDeps, "evaluate">,
  previousThreadUrl: string | undefined,
  timeoutMs = 5000,
): Promise<void> {
  if (!previousThreadUrl) return
  try {
    await deps.evaluate(buildNotionAiNavigateExpression(previousThreadUrl), timeoutMs)
  } catch {
    // Restoring is a courtesy; the caller is already reporting the rotation failure.
  }
}
