import { z } from "zod"

import { bookingApiSchema } from "@/lib/booking/domain/api-schema"
import type {
  createBookingFromApiInput as defaultCreateBookingFromApiInput,
  CreateBookingResult,
} from "@/lib/booking/server/create-booking"
import {
  additionalWorkChoices,
  productionOptionChoices,
  type CandidateWindow,
  type JobContext,
  type RoutingDecision,
  type SurveyChoiceSet,
  type WorkflowEstimate,
} from "@/lib/chatbot/domain"
import { estimateWorkflow } from "@/lib/chatbot/server/duration-estimator"

export type ChatbotToolName = "create_booking" | "show_booking_card" | "get_estimate" | "ask_checkbox"

type ToolSafetyDecision =
  | { allowed: true }
  | { allowed: false; reason: string }

export type ChatbotToolExecutionContext = {
  userId?: string
  userEmail?: string
  createBookingFromApiInput?: typeof defaultCreateBookingFromApiInput
}

type ChatbotToolDefinition<TArgs, TResult> = {
  name: ChatbotToolName
  description: string
  executionCondition: string
  inputSchema: z.ZodType<TArgs>
  inputJsonExample: string
  canExecute: (args: TArgs, context: ChatbotToolExecutionContext) => ToolSafetyDecision
  execute: (args: TArgs, context: ChatbotToolExecutionContext) => Promise<TResult> | TResult
}

type ChatbotToolDefinitionBase = {
  name: ChatbotToolName
  description: string
  executionCondition: string
  inputSchema: z.ZodType<unknown>
  inputJsonExample: string
  canExecute: (args: unknown, context: ChatbotToolExecutionContext) => ToolSafetyDecision
  execute: (args: unknown, context: ChatbotToolExecutionContext) => Promise<unknown> | unknown
}

export type ChatbotToolDispatchResult =
  | {
      status: "executed"
      tool: ChatbotToolName
      result: unknown
    }
  | {
      status: "fallback"
      reason: "unknown-tool" | "invalid-args" | "safety-denied" | "handler-error"
      tool?: string
      error?: string
    }

const candidateWindowSchema = z.object({
  start: z.string().datetime(),
  end: z.string().datetime(),
  label: z.string().trim().min(1).max(120),
  note: z.string().trim().max(200).optional(),
  available: z.boolean().optional(),
})

const jobContextSchema = z.custom<JobContext>(
  (value) => Boolean(value && typeof value === "object" && !Array.isArray(value)),
  "jobContext must be an object",
)

const createBookingArgsSchema = z.object({
  input: bookingApiSchema,
})

const showBookingCardArgsSchema = z.object({
  suggestedSlots: z.array(candidateWindowSchema).min(1),
  busyDateKeys: z.array(z.string().trim().min(1)).optional(),
  jobContext: jobContextSchema,
})

const getEstimateArgsSchema = z.object({
  jobContext: jobContextSchema,
})

const askCheckboxArgsSchema = z.object({
  choiceSetId: z.enum(["additional-work", "production-options"]),
})

const createBookingTool: ChatbotToolDefinition<
  z.infer<typeof createBookingArgsSchema>,
  CreateBookingResult
> = {
  name: "create_booking",
  description: "Validated booking submission through the existing booking server path.",
  executionCondition: [
    "Call only after the customer explicitly provided all booking form fields,",
    "selectedSlots, and agreed=true; authenticated user context is required.",
  ].join(" "),
  inputSchema: createBookingArgsSchema,
  inputJsonExample: '{"input":{"projectTitle":"...","dueDate":"...","companyName":"...","contactName":"...","sessionEmail":"...","phone":"","memo":"","agreed":true,"selectedSlots":[{"start":"2026-06-15T01:00:00.000Z","end":"2026-06-15T02:00:00.000Z"}]}}',
  canExecute: (_args, context) =>
    context.userId && context.userEmail
      ? { allowed: true }
      : { allowed: false, reason: "authenticated user context is required" },
  execute: async (args, context) => {
    if (!context.userId || !context.userEmail) {
      throw new Error("authenticated user context is required")
    }

    const handler =
      context.createBookingFromApiInput ??
      (await import("@/lib/booking/server/create-booking")).createBookingFromApiInput

    return handler({
      input: args.input,
      userId: context.userId,
      userEmail: context.userEmail,
    })
  },
}

const showBookingCardTool: ChatbotToolDefinition<
  z.infer<typeof showBookingCardArgsSchema>,
  { routingDecision: Extract<RoutingDecision, { kind: "to-booking-inline" }> }
> = {
  name: "show_booking_card",
  description: "Return the existing booking-card routing decision shape.",
  executionCondition: "Call when the customer is ready to see booking candidates and the deterministic safety route also allows booking-card display.",
  inputSchema: showBookingCardArgsSchema,
  inputJsonExample: '{"suggestedSlots":[{"start":"2026-06-15T01:00:00.000Z","end":"2026-06-15T02:00:00.000Z","label":"6月15日 10:00","available":true}],"jobContext":{"finalMedium":"web","workSite":"remote-grading","documentaryAttachment":{"kind":"none"}}}',
  canExecute: () => ({ allowed: true }),
  execute: (args) => ({
    routingDecision: {
      kind: "to-booking-inline",
      suggestedSlots: args.suggestedSlots satisfies CandidateWindow[],
      ...(args.busyDateKeys ? { busyDateKeys: args.busyDateKeys } : {}),
      jobContext: args.jobContext,
    },
  }),
}

const getEstimateTool: ChatbotToolDefinition<
  z.infer<typeof getEstimateArgsSchema>,
  { workflowEstimate: WorkflowEstimate }
> = {
  name: "get_estimate",
  description: "Calculate the existing workflow estimate for a validated job context.",
  executionCondition: "Call after jobKind is known and the customer needs a workflow duration estimate.",
  inputSchema: getEstimateArgsSchema,
  inputJsonExample: '{"jobContext":{"jobKind":"cm-30s","finalMedium":"web","workSite":"remote-grading","documentaryAttachment":{"kind":"none"}}}',
  canExecute: (args) =>
    args.jobContext.jobKind
      ? { allowed: true }
      : { allowed: false, reason: "jobKind is required" },
  execute: (args) => ({
    workflowEstimate: estimateWorkflow(args.jobContext),
  }),
}

const checkboxChoiceSets = {
  "additional-work": additionalWorkChoices,
  "production-options": productionOptionChoices,
} satisfies Record<z.infer<typeof askCheckboxArgsSchema>["choiceSetId"], SurveyChoiceSet>

const askCheckboxTool: ChatbotToolDefinition<
  z.infer<typeof askCheckboxArgsSchema>,
  { routingDecision: Extract<RoutingDecision, { kind: "continue" }> }
> = {
  name: "ask_checkbox",
  description: "Show an existing multiple-selection checkbox survey panel.",
  executionCondition: "Call when the customer should choose one or more values from an existing multiple-selection survey before the booking flow continues.",
  inputSchema: askCheckboxArgsSchema,
  inputJsonExample: '{"choiceSetId":"additional-work"}',
  canExecute: (args) =>
    checkboxChoiceSets[args.choiceSetId].selectionMode === "multiple"
      ? { allowed: true }
      : { allowed: false, reason: "choiceSetId must point to a multiple-selection survey" },
  execute: (args) => {
    const choiceSet = checkboxChoiceSets[args.choiceSetId]
    return {
      routingDecision: {
        kind: "continue",
        nextQuestion: choiceSet.question,
        presentChoices: choiceSet,
      },
    }
  },
}

export const chatbotToolRegistry = {
  create_booking: defineChatbotTool(createBookingTool),
  show_booking_card: defineChatbotTool(showBookingCardTool),
  get_estimate: defineChatbotTool(getEstimateTool),
  ask_checkbox: defineChatbotTool(askCheckboxTool),
} satisfies Record<ChatbotToolName, ChatbotToolDefinitionBase>

export function formatChatbotToolRegistryForPrompt(
  registry: Record<ChatbotToolName, ChatbotToolDefinitionBase> = chatbotToolRegistry,
  options: { enabledToolNames?: ReadonlyArray<ChatbotToolName> } = {},
): string {
  const enabledToolNames = new Set(
    options.enabledToolNames ?? (Object.keys(registry) as ChatbotToolName[]),
  )

  return Object.values(registry)
    .filter((tool) => enabledToolNames.has(tool.name))
    .map((tool) => [
      `- ${tool.name}: ${tool.description}`,
      `  condition: ${tool.executionCondition}`,
      `  args example: ${tool.inputJsonExample}`,
    ].join("\n"))
    .join("\n")
}

function defineChatbotTool<TArgs, TResult>(
  definition: ChatbotToolDefinition<TArgs, TResult>,
): ChatbotToolDefinitionBase {
  return definition as unknown as ChatbotToolDefinitionBase
}

export async function dispatchChatbotToolCall(input: {
  tool: string
  args: unknown
  context?: ChatbotToolExecutionContext
}): Promise<ChatbotToolDispatchResult> {
  const tool = chatbotToolRegistry[input.tool as ChatbotToolName]
  if (!tool) {
    return { status: "fallback", reason: "unknown-tool", tool: input.tool }
  }

  const parsed = tool.inputSchema.safeParse(input.args)
  if (!parsed.success) {
    return {
      status: "fallback",
      reason: "invalid-args",
      tool: input.tool,
      error: parsed.error.issues.map((issue) => issue.path.join(".") || issue.message).join(", "),
    }
  }

  const context = input.context ?? {}
  const safety = tool.canExecute(parsed.data, context)
  if (!safety.allowed) {
    return {
      status: "fallback",
      reason: "safety-denied",
      tool: input.tool,
      error: safety.reason,
    }
  }

  try {
    return {
      status: "executed",
      tool: tool.name,
      result: await tool.execute(parsed.data, context),
    }
  } catch (error) {
    return {
      status: "fallback",
      reason: "handler-error",
      tool: input.tool,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
