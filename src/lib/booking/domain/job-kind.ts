import { jobKindDefinition } from "./project-conditions"

export const canonicalJobKinds = jobKindDefinition.options.map(({ id }) => id)
export type CanonicalJobKind = typeof jobKindDefinition.options[number]["id"]
export const legacyJobKindAliases = {
  "cm-30s": "cm", "mv-5m": "mv", "feature-90m": "feature", "drama-first": "drama", "drama-follow-up": "drama", "vertical-60s": "vertical", "live-60m": "live",
} as const satisfies Record<string, CanonicalJobKind>
export type LegacyJobKind = keyof typeof legacyJobKindAliases
export type JobKind = CanonicalJobKind | LegacyJobKind

export function normalizeJobKind(value: string | undefined): CanonicalJobKind | undefined {
  if (!value) return undefined
  if (canonicalJobKinds.includes(value as CanonicalJobKind)) return value as CanonicalJobKind
  return Object.hasOwn(legacyJobKindAliases, value) ? legacyJobKindAliases[value as LegacyJobKind] : undefined
}
/** Representative workflow presets are lookup keys, never customer duration facts. */
export function workflowPresetJobKind(value: JobKind): LegacyJobKind | undefined {
  if (Object.hasOwn(legacyJobKindAliases, value)) return value as LegacyJobKind
  const presetMap: Partial<Record<CanonicalJobKind, LegacyJobKind>> = {
    cm: "cm-30s", mv: "mv-5m", feature: "feature-90m", drama: "drama-first", vertical: "vertical-60s", live: "live-60m",
  }
  const kind = normalizeJobKind(value)
  return kind ? presetMap[kind] : undefined
}
export function jobKindLabel(value: JobKind): string {
  const kind = normalizeJobKind(value)
  return jobKindDefinition.options.find(({ id }) => id === kind)?.label ?? "未確認"
}
