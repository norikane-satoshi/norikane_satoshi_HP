import CDP from "chrome-remote-interface"

import type { ChatbotLlmClient, ChatbotLlmRequest, ChatbotLlmResponse } from "@/lib/chatbot/server/llm-client"
import { ChatbotLlmError } from "@/lib/chatbot/server/llm-client"

type Tier1ChromeClaudeClientConfig = {
  remoteDebuggingPort: number
  modelSelector: string
  requestTimeoutMs: number
  healthCheckTimeoutMs: number
}

type Tier1ChromeClaudeClientOptions = Tier1ChromeClaudeClientConfig & {
  cdpClientFactory?: Tier1ChromeClaudeCdpClientFactory
}

type Tier1ChromeClaudeCdpClientFactory = (
  config: Tier1ChromeClaudeClientConfig,
) => Promise<Tier1ChromeClaudeCdpClient>

type Tier1ChromeClaudeCdpClient = {
  hasClaudeTarget(): Promise<boolean>
  generate(request: ChatbotLlmRequest): Promise<{ rawText: string; authRequired?: boolean }>
  close(): Promise<void>
}

type CdpBrowserClient = {
  Target: {
    getTargets(): Promise<{ targetInfos: ReadonlyArray<CdpTargetInfo> }>
  }
  close(): Promise<void>
}

type CdpPageClient = {
  Runtime: {
    evaluate(input: {
      expression: string
      awaitPromise: boolean
      returnByValue: boolean
    }): Promise<{ result?: { value?: unknown } }>
  }
  close(): Promise<void>
}

type CdpTargetInfo = {
  targetId: string
  type: string
  title: string
  url: string
}

type ClaudeBrowserResult = {
  rawText: string
  authRequired: boolean
}

type TimeoutTag = "timeout"

class CdpConnectionError extends Error {
  constructor(readonly cause: unknown) {
    super("Chrome DevTools connection failed.")
    this.name = "CdpConnectionError"
  }
}

const tier1ChromeClaudeDefaults = {
  remoteDebuggingPort: 9223,
  modelSelector: "apricot-sorbet-high",
  requestTimeoutMs: 60000,
  healthCheckTimeoutMs: 3000,
} as const

const tier = "tier-1-chrome-claude" as const
const cdpHost = "localhost"
const emptyText = ""
const timeoutTag: TimeoutTag = "timeout"
const claudeHostPattern = "claude.ai"
const pageTargetType = "page"
const cdpPollIntervalMs = 250
const authUrlIndicators = ["login", "signin", "sign-in", "challenge", "turnstile"] as const

const promptSectionLabels = {
  system: "System prompt",
  history: "Conversation history",
  latest: "Latest user message",
  context: "Job context",
} as const

const browserScriptConfig = {
  inputSelectors: [
    "textarea",
    "[contenteditable='true']",
    "[role='textbox']",
    "[data-testid='chat-input']",
  ],
  sendButtonSelectors: [
    "button[type='submit']",
    "button[aria-label*='Send']",
    "button[aria-label*='送信']",
    "[data-testid='send-button']",
  ],
  responseSelectors: [
    "[data-testid='message-content']",
    "[data-testid='assistant-message']",
    "[class*='assistant']",
    "main article",
  ],
  authTextIndicators: ["cloudflare", "turnstile", "sign in", "log in", "ログイン"],
} as const

export class Tier1ChromeClaudeClient implements ChatbotLlmClient {
  readonly tier = tier
  private readonly config: Tier1ChromeClaudeClientConfig
  private readonly cdpClientFactory: Tier1ChromeClaudeCdpClientFactory

  constructor(options: Tier1ChromeClaudeClientOptions) {
    this.config = {
      remoteDebuggingPort: options.remoteDebuggingPort,
      modelSelector: options.modelSelector,
      requestTimeoutMs: options.requestTimeoutMs,
      healthCheckTimeoutMs: options.healthCheckTimeoutMs,
    }
    this.cdpClientFactory = options.cdpClientFactory ?? createChromeClaudeCdpClient
  }

  async generate(request: ChatbotLlmRequest): Promise<ChatbotLlmResponse> {
    const startedAt = Date.now()
    let cdpClient: Tier1ChromeClaudeCdpClient | undefined

    try {
      cdpClient = await this.createCdpClient(this.config.requestTimeoutMs)
      const result = await withTimeout(
        cdpClient.generate(request),
        this.config.requestTimeoutMs,
        timeoutTag,
      )

      if (result.authRequired) {
        throw this.toLlmError({
          message: "Claude browser session requires login or challenge resolution.",
          code: "auth",
          isRetryable: false,
        })
      }

      const rawText = result.rawText.trim()
      if (rawText === emptyText) {
        throw this.toLlmError({
          message: "Claude browser tier returned an empty response.",
          code: "invalid-output",
          isRetryable: false,
        })
      }

      return {
        rawText,
        tier: this.tier,
        latencyMs: Date.now() - startedAt,
      }
    } catch (error) {
      throw this.mapGenerateError(error)
    } finally {
      await cdpClient?.close()
    }
  }

  async isHealthy(): Promise<boolean> {
    let cdpClient: Tier1ChromeClaudeCdpClient | undefined

    try {
      cdpClient = await this.createCdpClient(this.config.healthCheckTimeoutMs)
      return await withTimeout(
        cdpClient.hasClaudeTarget(),
        this.config.healthCheckTimeoutMs,
        timeoutTag,
      )
    } catch {
      return false
    } finally {
      await cdpClient?.close()
    }
  }

  private async createCdpClient(timeoutMs: number): Promise<Tier1ChromeClaudeCdpClient> {
    try {
      return await withTimeout(this.cdpClientFactory(this.config), timeoutMs, timeoutTag)
    } catch (error) {
      if (error === timeoutTag) throw error
      throw this.toLlmError({
        message: "Unable to connect to the Claude Chrome DevTools endpoint.",
        code: "connection",
        isRetryable: true,
        cause: error,
      })
    }
  }

  private mapGenerateError(error: unknown): ChatbotLlmError {
    if (error instanceof ChatbotLlmError) return error

    if (error === timeoutTag) {
      return this.toLlmError({
        message: "Claude browser tier request timed out.",
        code: "timeout",
        isRetryable: true,
      })
    }

    if (error instanceof CdpConnectionError) {
      return this.toLlmError({
        message: "Unable to connect to the Claude Chrome DevTools endpoint.",
        code: "connection",
        isRetryable: true,
        cause: error.cause,
      })
    }

    return this.toLlmError({
      message: "Claude browser tier failed with an unknown error.",
      code: "unknown",
      isRetryable: false,
      cause: error,
    })
  }

  private toLlmError(input: {
    message: string
    code: ConstructorParameters<typeof ChatbotLlmError>[0]["code"]
    isRetryable: boolean
    cause?: unknown
  }): ChatbotLlmError {
    return new ChatbotLlmError({
      message: input.message,
      code: input.code,
      tier: this.tier,
      isRetryable: input.isRetryable,
      cause: input.cause,
    })
  }
}

export function createTier1ChromeClaudeClient(
  overrides: Partial<Tier1ChromeClaudeClientConfig> = {},
): Tier1ChromeClaudeClient {
  return new Tier1ChromeClaudeClient({
    ...tier1ChromeClaudeDefaults,
    ...overrides,
  })
}

async function createChromeClaudeCdpClient(
  config: Tier1ChromeClaudeClientConfig,
): Promise<Tier1ChromeClaudeCdpClient> {
  const browserClient = (await CDP({
    host: cdpHost,
    port: config.remoteDebuggingPort,
  })) as CdpBrowserClient

  return new ChromeClaudeCdpClient(browserClient, config)
}

class ChromeClaudeCdpClient implements Tier1ChromeClaudeCdpClient {
  constructor(
    private readonly browserClient: CdpBrowserClient,
    private readonly config: Tier1ChromeClaudeClientConfig,
  ) {}

  async hasClaudeTarget(): Promise<boolean> {
    const targets = await this.getTargets()

    return targets.some(isClaudeTarget)
  }

  async generate(request: ChatbotLlmRequest): Promise<ClaudeBrowserResult> {
    const targets = await this.getTargets()
    const claudeTarget = targets.find(isClaudeTarget)

    if (!claudeTarget) {
      return { rawText: emptyText, authRequired: hasAuthRedirectTarget(targets) }
    }

    const pageClient = await this.connectPage(claudeTarget.targetId)

    try {
      const result = await pageClient.Runtime.evaluate({
        expression: buildClaudeInteractionScript(
          renderPrompt(request),
          this.config.modelSelector,
          this.config.requestTimeoutMs,
        ),
        awaitPromise: true,
        returnByValue: true,
      })

      return parseBrowserResult(result.result?.value)
    } finally {
      await pageClient.close()
    }
  }

  async close(): Promise<void> {
    await this.browserClient.close()
  }

  private async getTargets(): Promise<ReadonlyArray<CdpTargetInfo>> {
    const { targetInfos } = await this.browserClient.Target.getTargets()

    return targetInfos
  }

  private async connectPage(targetId: string): Promise<CdpPageClient> {
    try {
      return (await CDP({
        host: cdpHost,
        port: this.config.remoteDebuggingPort,
        target: targetId,
      })) as CdpPageClient
    } catch (error) {
      throw new CdpConnectionError(error)
    }
  }
}

function renderPrompt(request: ChatbotLlmRequest): string {
  const history = request.messages.map((message) => `${message.role}: ${message.content}`).join("\n")

  return [
    `${promptSectionLabels.system}\n${request.systemPrompt}`,
    `${promptSectionLabels.history}\n${history}`,
    request.latestUserMessage
      ? `${promptSectionLabels.latest}\n${request.latestUserMessage}`
      : undefined,
    `${promptSectionLabels.context}\n${JSON.stringify({
      conversationState: request.conversationState,
      jobContext: request.jobContext,
    })}`,
  ]
    .filter((section): section is string => Boolean(section))
    .join("\n\n")
}

function buildClaudeInteractionScript(
  prompt: string,
  modelSelector: string,
  requestTimeoutMs: number,
): string {
  return `
    (async () => {
      const prompt = ${JSON.stringify(prompt)};
      const modelSelector = ${JSON.stringify(modelSelector)};
      const config = ${JSON.stringify(browserScriptConfig)};
      const pollIntervalMs = ${JSON.stringify(cdpPollIntervalMs)};
      const timeoutMs = ${JSON.stringify(requestTimeoutMs)};
      const startedAt = Date.now();

      const textOf = (element) => (element?.innerText || element?.textContent || "").trim();
      const bodyText = () => (document.body?.innerText || "").toLowerCase();
      const hasAuthBlock = () => config.authTextIndicators.some((item) => bodyText().includes(item));
      if (hasAuthBlock()) return { rawText: "", authRequired: true };

      const modelControl = document.querySelector(
        '[data-testid="' + modelSelector + '"], [data-value="' + modelSelector + '"], [value="' + modelSelector + '"]'
      );
      modelControl?.click?.();

      const input = config.inputSelectors.map((selector) => document.querySelector(selector)).find(Boolean);
      if (!input) return { rawText: "", authRequired: false };

      if ("value" in input) {
        input.value = prompt;
      } else {
        input.textContent = prompt;
      }
      input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: prompt }));

      const sendButton = config.sendButtonSelectors
        .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
        .find((element) => !element.disabled && element.getAttribute("aria-disabled") !== "true");
      sendButton?.click?.();

      while (Date.now() - startedAt < timeoutMs) {
        if (hasAuthBlock()) return { rawText: "", authRequired: true };

        const responses = config.responseSelectors
          .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
          .map(textOf)
          .filter(Boolean);
        const rawText = responses.at(-1) || "";
        if (rawText && rawText !== prompt) return { rawText, authRequired: false };

        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }

      return { rawText: "", authRequired: false };
    })()
  `
}

function parseBrowserResult(value: unknown): ClaudeBrowserResult {
  if (!isClaudeBrowserResult(value)) return { rawText: emptyText, authRequired: false }

  return value
}

function isClaudeBrowserResult(value: unknown): value is ClaudeBrowserResult {
  if (!value || typeof value !== "object") return false

  const candidate = value as Partial<ClaudeBrowserResult>

  return typeof candidate.rawText === "string" && typeof candidate.authRequired === "boolean"
}

function isClaudeTarget(target: CdpTargetInfo): boolean {
  return target.type === pageTargetType && target.url.includes(claudeHostPattern)
}

function hasAuthRedirectTarget(targets: ReadonlyArray<CdpTargetInfo>): boolean {
  return targets.some((target) => {
    const url = target.url.toLowerCase()
    const title = target.title.toLowerCase()

    return authUrlIndicators.some((indicator) => url.includes(indicator) || title.includes(indicator))
  })
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, tag: TimeoutTag): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(tag), timeoutMs)

    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}
