export type WorkflowStage = "conform" | "prep" | "attended" | "final-check" | "delivery"

export type FinalMedium = "ott" | "cinema" | "tv-broadcast" | "live" | "web" | "vertical-sns" | "other"

export type WorkSite = "satoshi-studio" | "remote-grading" | "on-site"

export type DocumentaryAttachment =
  | { kind: "none" }
  | { kind: "digest"; count: number }
  | { kind: "interview"; count: number }
  | { kind: "bonus"; count: number }
  | { kind: "making"; count: number }
  | { kind: "other"; count: number; note: string }

export type WorkflowEstimate = {
  stages: Array<{
    stage: WorkflowStage
    minDays: number
    maxDays: number
    note?: string
  }>
  totalMinDays: number
  totalMaxDays: number
  riskFlags: Array<"tight-deadline" | "heavy-retouch" | "strict-delivery" | "on-site-transfer">
}

export type CandidateWindow = {
  start: string
  end: string
  label: string
  note?: string
}

export type JobContext = {
  finalMedium: FinalMedium
  workSite: WorkSite
  documentaryAttachment: DocumentaryAttachment
  projectLengthMinutes?: number
  publicReleaseDate?: string
  preferredStartDate?: string
  preferredAttendanceDates?: string[]
  referenceUrls?: string[]
  additionalWork?: Array<"retouch" | "background-cleanup" | "other">
  workflowEstimate?: WorkflowEstimate
}

export type ConversationSummary = {
  subject: string
  customerEmail: string
  customerName?: string
  companyName?: string
  jobContext: JobContext
  summaryText: string
  openQuestions: string[]
}
