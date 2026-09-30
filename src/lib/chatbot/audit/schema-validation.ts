import { z } from "zod"

type AuditSchemaName =
  | "chatbotAuditUiKindSchema"
  | "chatbotAuditStageTimingsSchema"
  | "chatbotServerAuditEventSchema"
  | "chatbotStoredAuditEventSchema"

type ValidationDiagnostic = {
  schema: AuditSchemaName | "unknown"
  issues: Array<{ path: string; code: string }>
}

const diagnostics = new WeakMap<z.ZodError, ValidationDiagnostic>()

// Paths can contain customer-controlled record keys. Only retain names found in the
// actual schema; never include issue messages, values, or unrecognized-key lists.
function schemaPath(schema: z.ZodType, path: PropertyKey[]): string {
  let current: z.ZodType | undefined = schema
  return path.map((part) => {
    while (current instanceof z.ZodOptional || current instanceof z.ZodNullable) {
      current = current.unwrap() as z.ZodType
    }
    if (current instanceof z.ZodArray && typeof part === "number") {
      current = current.element as z.ZodType
      return "item"
    }
    if (current instanceof z.ZodObject && typeof part === "string" &&
      Object.prototype.hasOwnProperty.call(current.shape, part)) {
      current = current.shape[part] as z.ZodType
      return part
    }
    current = undefined
    return "redacted"
  }).join(".") || "root"
}

export function parseChatbotAuditSchema<T extends z.ZodType>(
  name: AuditSchemaName,
  schema: T,
  input: unknown,
): z.output<T> {
  const result = schema.safeParse(input)
  if (result.success) return result.data
  const diagnostic: ValidationDiagnostic = {
    schema: name,
    issues: result.error.issues.map((issue) => ({
      path: schemaPath(schema, issue.path),
      code: issue.code,
    })),
  }
  diagnostics.set(result.error, diagnostic)
  console.error("[chatbot audit schema validation failed]", diagnostic)
  throw result.error
}

export function describeChatbotSchemaFailure(error: unknown): string | undefined {
  if (!(error instanceof z.ZodError)) return undefined
  const diagnostic = diagnostics.get(error) ?? {
    schema: "unknown",
    issues: error.issues.map((issue) => ({ path: "redacted", code: issue.code })),
  }
  return ["ZodError", diagnostic.schema,
    ...diagnostic.issues.slice(0, 3).map((issue) => `${issue.path}:${issue.code}`),
  ].join(":").slice(0, 120)
}
