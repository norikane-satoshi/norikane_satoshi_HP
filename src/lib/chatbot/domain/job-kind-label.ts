import type { JobKind } from "./workflow-estimate"

/**
 * Job kinds are stored with a representative length in their id ("cm-30s"), but the customer picks
 * the length separately; these names leave the length out so they cannot contradict it.
 */
export const jobKindLabels: Record<JobKind, string> = {
  "cm-30s": "Web CM / CM",
  "mv-5m": "MV",
  "feature-90m": "長編",
  "drama-first": "ドラマ初回",
  "drama-follow-up": "ドラマ2話目以降",
  "vertical-60s": "縦型動画",
  "live-60m": "ライブ",
}
