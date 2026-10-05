import { canonicalJobKinds, legacyJobKindAliases, jobKindLabel, type JobKind } from "@/lib/booking/domain/job-kind"

export const jobKindLabels = Object.fromEntries([...canonicalJobKinds, ...Object.keys(legacyJobKindAliases)].map((kind) => [kind, jobKindLabel(kind as JobKind)])) as Record<JobKind, string>
