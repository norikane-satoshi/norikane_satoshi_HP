"use client"

import type { CandidateWindow, WorkflowEstimate, WorkflowStage } from "@/lib/chatbot/domain/workflow-estimate"

type ScheduleCardProps = {
  estimate: WorkflowEstimate
  candidates: CandidateWindow[]
  onSelectCandidate: (index: number) => void
}

const stageLabels: Record<WorkflowStage, string> = {
  conform: "コンフォーム",
  prep: "準備",
  attended: "立ち会い",
  "final-check": "最終確認",
  delivery: "納品",
}

export function ScheduleCard({ estimate, candidates, onSelectCandidate }: ScheduleCardProps) {
  return (
    <section className="glass-inset space-y-4 p-4" aria-label="工程別スケジュール">
      <div>
        <p className="text-sm font-semibold text-hp">工程別スケジュール</p>
        <p className="mt-1 text-xs text-hp-muted">
          合計 {estimate.totalMinDays}〜{estimate.totalMaxDays} 日目安
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[320px] text-left text-xs text-hp">
          <thead className="text-hp-muted">
            <tr>
              <th className="py-2 pr-3 font-semibold">工程</th>
              <th className="py-2 pr-3 font-semibold">日数</th>
              <th className="py-2 font-semibold">メモ</th>
            </tr>
          </thead>
          <tbody>
            {estimate.stages.map((stage) => (
              <tr key={stage.stage} className="border-t border-[var(--glass-border)]">
                <td className="py-2 pr-3 font-semibold">{stageLabels[stage.stage]}</td>
                <td className="py-2 pr-3">
                  {stage.minDays}〜{stage.maxDays} 日
                </td>
                <td className="py-2 text-hp-muted">{stage.note ?? "調整可"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-2">
        {candidates.slice(0, 3).map((candidate, index) => (
          <button
            key={`${candidate.start}-${candidate.end}`}
            type="button"
            className="glass-btn px-3 py-2 text-left text-xs font-semibold text-hp"
            onClick={() => onSelectCandidate(index)}
          >
            <span className="block">{candidate.label}</span>
            {candidate.note ? <span className="block font-normal text-hp-muted">{candidate.note}</span> : null}
          </button>
        ))}
      </div>
    </section>
  )
}
