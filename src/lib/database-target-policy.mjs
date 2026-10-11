export const PRODUCTION_DATABASE_ACCESS_DISABLED = "production_database_access_disabled"

/** @typedef {Readonly<Record<string, string | undefined>>} DatabaseEnvironment */
/** @typedef {{ role: "production" | "preview" | "local" | "unknown", identifier: "norikane-studio" | "norikane-studio-preview" | "local-sqlite" | "unknown" }} DatabaseTarget */

/** @param {DatabaseEnvironment} [env] @returns {DatabaseTarget} */
export function getDatabaseTarget(env = process.env) {
  const url = env.TURSO_DATABASE_URL?.trim()
  if (url?.startsWith("file:")) return { role: "local", identifier: "local-sqlite" }
  if (!url) return { role: "unknown", identifier: "unknown" }

  try {
    const hostname = decodeURIComponent(new URL(url).hostname).toLowerCase().replace(/\.$/, "")
    if (hostname.endsWith(".turso.io")) {
      const databaseHost = hostname.split(".")[0]
      if (databaseHost === "norikane-studio-norituku") {
        return { role: "production", identifier: "norikane-studio" }
      }
      if (databaseHost === "norikane-studio-preview-norituku") {
        return { role: "preview", identifier: "norikane-studio-preview" }
      }
    }
  } catch {
    // Invalid URLs must not appear in public diagnostics or policy errors.
  }
  return { role: "unknown", identifier: "unknown" }
}

/** @param {DatabaseEnvironment} [env] */
export function assertDatabaseTargetAllowed(env = process.env) {
  const production = env.NODE_ENV === "production"
    && env.VERCEL === "1"
    && env.VERCEL_ENV === "production"
    && !env.VITEST
  if (getDatabaseTarget(env).role === "production" && !production) {
    throw new Error(PRODUCTION_DATABASE_ACCESS_DISABLED)
  }
}
