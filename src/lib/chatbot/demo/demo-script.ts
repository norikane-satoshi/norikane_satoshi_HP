export type DemoPlacement = "top" | "right" | "bottom" | "left"

export type DemoCursorPoint = {
  xRatio: number
  yRatio: number
}

export type DemoAnnotation = {
  title: string
  body: string
  placement: DemoPlacement
}

type DemoStepBase = {
  id: string
  durationMs?: number
  target?: DemoCursorPoint
  annotation?: DemoAnnotation
}

export type DemoStep =
  | (DemoStepBase & { kind: "move"; target: DemoCursorPoint })
  | (DemoStepBase & { kind: "scroll"; scrollTo: { yRatio: number }; target?: DemoCursorPoint })
  | (DemoStepBase & { kind: "click"; target: DemoCursorPoint })
  | (DemoStepBase & { kind: "annotate"; target: DemoCursorPoint; annotation: DemoAnnotation })
  | (DemoStepBase & { kind: "wait" })
  | (DemoStepBase & { kind: "complete"; target?: DemoCursorPoint })

export type DemoScript = {
  id: string
  title: string
  initialPoint: DemoCursorPoint
  steps: DemoStep[]
}

export const bookingOnboardingDemoScript = {
  id: "booking-onboarding-v1",
  title: "予約オンボーディング",
  initialPoint: { xRatio: 0.82, yRatio: 0.76 },
  steps: [
    {
      id: "move-to-login-card",
      kind: "move",
      target: { xRatio: 0.82, yRatio: 0.76 },
      durationMs: 450,
    },
    {
      id: "annotate-login-card",
      kind: "annotate",
      target: { xRatio: 0.82, yRatio: 0.76 },
      durationMs: 1800,
      annotation: {
        title: "ログインカードへ進む",
        body: "メールリンクまたは外部アカウントでログインし、予約の続きに移ります。",
        placement: "left",
      },
    },
    {
      id: "click-login-card",
      kind: "click",
      target: { xRatio: 0.82, yRatio: 0.76 },
      durationMs: 500,
    },
    {
      id: "scroll-booking-screen",
      kind: "scroll",
      target: { xRatio: 0.68, yRatio: 0.42 },
      scrollTo: { yRatio: 0.42 },
      durationMs: 700,
    },
    {
      id: "annotate-booking-screen",
      kind: "annotate",
      target: { xRatio: 0.68, yRatio: 0.42 },
      durationMs: 1800,
      annotation: {
        title: "予約画面へ進む",
        body: "案件内容を確認しながら、予約に必要な項目へ順番に進みます。",
        placement: "left",
      },
    },
    {
      id: "move-calendar-candidates",
      kind: "move",
      target: { xRatio: 0.55, yRatio: 0.58 },
      durationMs: 550,
    },
    {
      id: "annotate-calendar-candidates",
      kind: "annotate",
      target: { xRatio: 0.55, yRatio: 0.58 },
      durationMs: 1800,
      annotation: {
        title: "カレンダー候補を見る",
        body: "候補日時を確認し、都合に合う枠を選びます。",
        placement: "top",
      },
    },
    {
      id: "click-calendar-candidate",
      kind: "click",
      target: { xRatio: 0.55, yRatio: 0.58 },
      durationMs: 500,
    },
    {
      id: "move-confirm-booking",
      kind: "move",
      target: { xRatio: 0.72, yRatio: 0.82 },
      durationMs: 550,
    },
    {
      id: "annotate-confirm-booking",
      kind: "annotate",
      target: { xRatio: 0.72, yRatio: 0.82 },
      durationMs: 1800,
      annotation: {
        title: "確認して予約する",
        body: "内容を確認して予約操作へ進む流れだけを示します。ここでは実予約は行いません。",
        placement: "left",
      },
    },
    {
      id: "complete-demo",
      kind: "complete",
      target: { xRatio: 0.72, yRatio: 0.82 },
      durationMs: 300,
    },
  ],
} satisfies DemoScript
