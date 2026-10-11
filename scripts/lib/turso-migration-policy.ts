import { assertDatabaseTargetAllowed } from "../../src/lib/database-target-policy.mjs"

export type TursoMigrationDecision =
  | { action: "run"; reason: "local-or-production" }
  | { action: "skip"; reason: "vercel-non-production" }

export function decideTursoMigrationExecution(
  env: Readonly<Record<string, string | undefined>>
): TursoMigrationDecision {
  assertDatabaseTargetAllowed(env)

  if (env.VERCEL === "1" && env.VERCEL_ENV !== "production") {
    return { action: "skip", reason: "vercel-non-production" }
  }

  return { action: "run", reason: "local-or-production" }
}
