# Opening panel production verification — 2026-09-25

- staging: `2c36f25bbd25b983010bdbbdedcc3dad48218705`
- master / Production: `18192b6c967928b392bdca1bb7b9015901f29d94`
- deployment: `dpl_7pqR4J75Vc2RdxfvTZNUA1JcbZBM` (Ready)
- canonical build-info and message API: `https://norikane.studio`
- message responses: `x-vercel-id` begins `hnd1::hnd1::`
- no staging-to-master merge, force push, environment change, or booking submission.

## Public API measurements

Milliseconds. Server timings are persisted audit `stageTimings`; network duration
is measured from this Mac, not browser-perceived rendering latency. The table
follows one synthetic new customer session. No conversation content is recorded.
All rows used `tier-0-deterministic-intake`; `notionInference=0` and
`tierHealthCheck=0`. Normalization was 0–1 ms.

| Answer step | Server total | API elapsed | Load | Context | Persist | Notification |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Opening project kind | 456 | 1282 | 40 | 21 | 143 | 247 |
| Length | 616 | 1058 | 45 | 14 | 313 | 234 |
| Final medium, free text via Jev | 1065 | 1649 | 50 | 542 | 228 | 237 |
| Additional work | 491 | 1365 | 39 | 8 | 193 | 243 |
| Documentary attachment | 495 | 785 | 36 | 13 | 187 | 251 |
| Work site | 554 | 1224 | 51 | 10 | 247 | 234 |
| Material contents | 482 | 794 | 36 | 14 | 195 | 230 |
| Material timing | 1077 | 1725 | 54 | 15 | 698 | 297 |
| Handoff method | 354 | 764 | 24 | 9 | 98 | 217 |
| Reference URL panel | 545 | 1089 | 39 | 10 | 266 | 220 |
| Email | 590 | 1062 | 88 | 47 | 218 | 231 |
| Final confirmation | 520 | 1202 | 42 | 15 | 215 | 235 |

Jev log: `chatbot_choice_interpreter`, `decision=adopted`,
`reason=confident-choice`, `latencyMs=532`, `choiceSetId=final-medium`,
matching Production SHA.

Free-text initial turn: Tier1 succeeded, server 41878 ms, API 42979 ms.
Stages: conversationLoad 52, contextPreparation 50, tierHealthCheck 107,
workerQueueWait 0, cdpTargetSession 2, runtimeContextPreparation 39881,
promptToFirstChunk 979, responseStreaming 7425, outputValidation 5,
notionInference 41117, responseNormalization 1, conversationPersist 284,
slackNotification 255. Nested spans overlap; do not sum them.

Previous supplied baseline: Tier0 server 3349 ms / browser 7706 ms;
Tier1 server 51830 ms / browser 56664 ms; runtime preparation 44980 ms.
Current Tier0 server 354–1077 ms is lower; API and old browser durations are
different measurement surfaces, not a controlled causal comparison.

## Passed / outstanding

- Both source snapshots passed lint, full Vitest and production build on Mac.
  Typecheck reports only the nine existing TS2345 errors in repository.test.ts.
  Clean master generation removed the stale staging-generated-type issue.
- Fallback live command passed Tier2, Tier3, customer display contract, and
  the synthetic inquiry accepted/delivered checks.
- Booking-card arrival **failed**: final confirmation returns the same panel,
  including after repeated confirmation. Stored state has email present,
  `additionalConcernStatus=none`, `bookingFinalConfirmation.status=confirmed`.
  No booking was submitted. This is not full customer-path acceptance.
- Fresh browser click-through and perceived timings remain unverified. The
  canonical browser retains an older session; the unique deployment origin
  requires Vercel login. No authentication or browser storage was changed.
- VPS inventory deployment and real hidden/Canary/latency verification remain
  pending SSH access; the existing Tier1 worker itself responded successfully.
