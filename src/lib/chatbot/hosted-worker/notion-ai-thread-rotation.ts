/**
 * Moves the worker onto a fresh Notion AI thread.
 *
 * Notion mints thread ids server-side, and a client-minted id is rejected by the inference API, so
 * the only way to get a usable thread is to drive the page the way a person would: open a blank
 * chat, type one seed message, send it, then read the `?t=` Notion puts in the URL.
 *
 * The blank chat is reached by navigating to `/ai` rather than by clicking Notion's new-chat
 * control. The control carries no text node and its accessible name is not stable across locales —
 * the live page labels it "New chat" while labelling the send button "AIメッセージを送信" in the
 * same session — whereas `/ai` is the address the worker already boots against. Navigating also
 * recovers from a tab left on a half-rotated blank page, which a new-chat click cannot do because
 * no such control exists there.
 *
 * Each in-page step takes `document` explicitly so the same function can be stringified into the
 * page and called directly from a jsdom test.
 */

export const notionAiComposerSelector = "[contenteditable='true'][role='textbox']"
/** Matches the send control in either locale; exact labels have already drifted once. */
export const notionAiSendLabelPattern = /送信|send/i
export const notionAiBlankChatUrl = "https://app.notion.com/ai"

/** Permanent first turn of every rotated thread, so it says nothing about any customer. */
export const notionAiThreadRotationSeedMessage = "セッション開始"

export type NotionAiThreadRotationStage =
  | "read-current-url"
  | "open-blank-chat"
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
  // The send control is only rendered once the composer holds text, so "missing" is a normal
  // intermediate state here rather than a broken selector.
  for (const element of Array.from(doc.querySelectorAll("[aria-label]"))) {
    const label = element.getAttribute("aria-label") ?? ""
    if (!/送信|send/i.test(label)) continue
    if (element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true") {
      return { ok: false, reason: "disabled" }
    }
    ;(element as HTMLElement).click()
    return { ok: true }
  }
  return { ok: false, reason: "missing" }
}

/**
 * Notion replaces the send control with a stop control while a reply streams, so its presence is
 * the page's own "this thread is idle" signal.
 */
export function readNotionAiSendPresenceInPage(doc: Document): { present: boolean } {
  for (const element of Array.from(doc.querySelectorAll("[aria-label]"))) {
    const label = element.getAttribute("aria-label") ?? ""
    if (/送信|send/i.test(label)) return { present: true }
  }
  return { present: false }
}

/** Keeps rotation on whichever Notion host the tab is already authenticated against. */
export function buildNotionAiBlankChatUrl(currentHref: string | undefined): string {
  if (!currentHref) return notionAiBlankChatUrl
  try {
    return `${new URL(currentHref).origin}/ai`
  } catch {
    return notionAiBlankChatUrl
  }
}

function inPageExpression(fn: (doc: Document) => unknown): string {
  // Mirrors buildRunInferenceExpression: the esbuild helper shim has to exist in the page scope.
  return `(() => { const __name = (target) => target; return (${fn.toString()})(document); })()`
}

export const notionAiFocusComposerExpression = inPageExpression(focusNotionAiComposerInPage)
export const notionAiReadComposerExpression = inPageExpression(readNotionAiComposerTextInPage)
export const notionAiSendExpression = inPageExpression(clickNotionAiSendInPage)
export const notionAiReadSendPresenceExpression = inPageExpression(readNotionAiSendPresenceInPage)
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
  /** The blank chat is a full page load, so the composer takes seconds to mount. */
  awaitComposerMs: number
  awaitThreadUrlMs: number
  /** Notion answers the seed on the new thread; an inference posted during that stream comes back empty. */
  awaitIdleMs: number
  pollIntervalMs: number
  /** Notion re-renders around the composer, so the steps after it get a few tries. */
  stepRetries: number
  stepRetryDelayMs: number
}

const defaultTimeouts: NotionAiThreadRotationTimeouts = {
  stepMs: 5000,
  insertMs: 10000,
  awaitComposerMs: 45000,
  awaitThreadUrlMs: 30000,
  awaitIdleMs: 30000,
  pollIntervalMs: 500,
  stepRetries: 8,
  stepRetryDelayMs: 500,
}

export type NotionAiThreadRotationDeps = {
  evaluate<T>(expression: string, timeoutMs: number): Promise<T>
  insertText(text: string, timeoutMs: number): Promise<void>
  seedMessage?: string
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  timeouts?: Partial<NotionAiThreadRotationTimeouts>
}

async function retryStep<T>(
  run: () => Promise<T>,
  accept: (value: T | undefined) => boolean,
  timeouts: NotionAiThreadRotationTimeouts,
  sleep: (ms: number) => Promise<void>,
): Promise<T | undefined> {
  let value: T | undefined
  for (let attempt = 0; attempt <= timeouts.stepRetries; attempt += 1) {
    value = await run()
    if (accept(value)) return value
    if (attempt < timeouts.stepRetries) await sleep(timeouts.stepRetryDelayMs)
  }
  return value
}

/**
 * Waits out the seed message's own reply. Measured at 8.9s on the live page; returning early only
 * costs the triggering request, since the thread itself is already usable by the next one.
 */
async function waitForNotionAiThreadIdle(
  deps: Pick<NotionAiThreadRotationDeps, "evaluate">,
  timeouts: NotionAiThreadRotationTimeouts,
  now: () => number,
  sleep: (ms: number) => Promise<void>,
): Promise<void> {
  const deadline = now() + timeouts.awaitIdleMs
  for (;;) {
    const presence = await deps
      .evaluate<{ present: boolean }>(notionAiReadSendPresenceExpression, timeouts.stepMs)
      .catch(() => undefined)
    if (presence?.present) return
    if (now() >= deadline) return
    await sleep(timeouts.pollIntervalMs)
  }
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

    try {
      await deps.evaluate(
        buildNotionAiNavigateExpression(buildNotionAiBlankChatUrl(previousThreadUrl)),
        timeouts.stepMs,
      )
    } catch (error) {
      return fail("open-blank-chat", error instanceof Error ? error.message : String(error))
    }

    // The composer only mounts once the blank chat has rendered, which is why this polls instead of
    // reading straight after the navigation.
    const composerDeadline = now() + timeouts.awaitComposerMs
    let focused: { ok: boolean; focused: boolean } | undefined
    for (;;) {
      focused = await deps
        .evaluate<{ ok: boolean; focused: boolean }>(notionAiFocusComposerExpression, timeouts.stepMs)
        // A navigating page tears down the execution context, so an evaluate can fail mid-load.
        .catch(() => undefined)
      if (focused?.ok) break
      if (now() >= composerDeadline) return fail("focus-composer")
      await sleep(timeouts.pollIntervalMs)
    }

    await deps.insertText(seedMessage, timeouts.insertMs)

    // Guards the regression this whole routine exists to avoid: setting textContent from an
    // evaluate looks like it worked but never reaches Notion's editor state.
    const composer = await retryStep(
      () => deps.evaluate<{ text: string }>(notionAiReadComposerExpression, timeouts.stepMs),
      (value) => Boolean(value?.text.includes(seedMessage)),
      timeouts,
      sleep,
    )
    if (!composer?.text.includes(seedMessage)) return fail("verify-seed", `text=${composer?.text ?? ""}`)

    // The send button stays disabled until Notion registers the text.
    const sent = await retryStep(
      () => deps.evaluate<{ ok: boolean; reason?: string }>(notionAiSendExpression, timeouts.stepMs),
      (value) => Boolean(value?.ok),
      timeouts,
      sleep,
    )
    if (!sent?.ok) return fail("send-seed", sent?.reason)

    const deadline = now() + timeouts.awaitThreadUrlMs
    for (;;) {
      const current = await deps.evaluate<{ href: string }>(notionAiReadLocationExpression, timeouts.stepMs)
      const threadId = current?.href ? readNotionAiThreadIdFromUrl(current.href) : undefined
      if (threadId && threadId !== previousThreadId) {
        await waitForNotionAiThreadIdle(deps, timeouts, now, sleep)
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
