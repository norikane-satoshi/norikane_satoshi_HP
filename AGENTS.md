<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# Agent instructions for NCS Grading HP

This repository is the Next.js site for Satoshi Norikane / NCS Grading.

## Required reading order

Before changing UI, layout, styling, copy placement, diagrams, or visual assets:

1. Read `DESIGN.md`.
2. Read `src/app/globals.css`.
3. Read the component you are about to modify.

`DESIGN.md` is the design contract. It supersedes older neumorphism notes. If `AGENTS.md` and `DESIGN.md` conflict on visual design, follow `DESIGN.md` and the actual tokens in `src/app/globals.css`.

## Design source of truth

The current site uses a light Glass Design System:

- `--bg-base #F8F6FF`
- `--accent-primary #8B7FFF`
- `--accent-secondary #C4B5FD`
- `--aurora-purple rgba(139, 127, 255, 0.28)`
- `--aurora-pink rgba(255, 143, 171, 0.20)`
- `--aurora-sky rgba(125, 211, 252, 0.20)`
- `--glass-bg rgba(255, 255, 255, 0.55)`
- `--glass-border rgba(139, 127, 255, 0.22)`
- `--glass-shadow 0 8px 32px rgba(139, 127, 255, 0.15)`
- `--text-primary #1C0F6E`
- `--text-muted #6B5FA8`
- `.glass-card`, `.glass-card-sm`, `.glass-bar`, `.glass-btn`, `.glass-input`, `.glass-badge`, `.glass-inset`, `.glass-flat`

Retired `neu-*` / `--neu-*` classes and tokens may remain for compatibility only. Do not use them in new implementation.

## Implementation rules

- Use existing components and utilities before creating new styles.
- Keep page shells consistent: `max-w-[1440px] px-6 md:px-10 xl:px-14`.
- Keep Japanese body text readable; avoid cramped line-height or excessive letter-spacing.
- Do not add dark sections outside the hero without explicit instruction.
- Do not add new color tokens, shadows, or fonts without updating `DESIGN.md` and `globals.css` together.
- Avoid nested blur-heavy glass cards. Inside a glass parent, prefer `bg-white/35`, `bg-white/40`, `border-white/55`, and `rounded-[12px]` without additional blur.
- Booking pages and new booking-adjacent UI use `glass-*` / `text-hp*` as canonical classes. Reservation unavailable states use muted text-derived neutrals, not the primary accent.

## Diagram rules

Note diagrams are governed by `DESIGN.md` and implemented through:

- `src/components/notes/note-diagram.tsx`
- `src/lib/notes/diagrams.ts`
- `public/notes/diagrams/<slug>.webp`

Generated images provide background mood only. All labels, numbers, cards, glyphs, and semantic structure must be rendered in React/CSS.

Never bake Japanese text, English text, numbers, arrows, UI labels, or logos into diagram images.

## Verification

After code changes:

- Run the relevant build/lint/typecheck commands available in `package.json`.
- Check the affected page locally when possible.
- For UI changes, verify desktop and mobile behavior.
- For diagrams, verify `/notes/<slug>` and confirm the figure remains readable in 5 seconds.

## Long-running process lifecycle

Verification dev servers (`pnpm next dev`, etc.) launched during a cc-notion session are owned by Satoshi, not by the session that started them. They are reused across phases for repeated visual verification.

- Do not kill a verification dev server at session end without an explicit instruction from Satoshi. Treat it the same as the launchctl-managed cc-notion daemon: shared infrastructure that outlives any single session.
- Do not kill a dev server you find already running just because you did not start it. Reuse it, probe the port, and attach to the existing PID. The standing HP 41238 refresh authorization below is the only project-level exception; other servers may be restarted only when actually broken or explicitly requested.
- Start dev servers fully detached, with stdio redirected to a log file, so the cc-notion job exit does not take the server down.
- When you do start or restart one, report URL, PID, and log path so the next session can find it without rediscovery.
- If Satoshi explicitly says "kill the dev server" / "stop the dev server" / "restart the dev server", that authorizes the named operation. The HP 41238 refresh flow below is already authorized after each completed HP change and does not require another confirmation.

## 本番反映ルール（チャットボット・予約カレンダー）

AI チャットボットと予約カレンダーの実装は、検証済み変更を `localhost:41238` だけで止めず、`master` / Vercel Production まで反映し、Production URL と顧客導線で確認できる状態を既定の完了条件にする。破壊的変更、secret / env 更新、DB migration、外部サービス設定変更、不可逆または高コストな操作は、master / Production 反映前にさとしさんの明示確認を取る。

## 41238 最新化ルール

今後この HP の修正が lint・typecheck・対象 unit test を通過し、専用作業ブランチへ commit されたら、報告前に次を実行する。

1. `origin` を fetch し、作業 commit を最新 `origin/staging` 上へ競合なく載せられることを確認する。作業ブランチが遅れているだけなら最新 `origin/staging` へ rebase し、競合が起きた場合は rebase を中止して push せず、さとしさんへ判断を戻す。
2. `origin/staging` が統合後 HEAD の祖先であること、保護対象 baseline の祖先関係、diff allowlist を確認し、通常の fast-forward push だけで `origin/staging` を前進させる。force push / reset / staging 直作業は禁止する。
3. launchd `com.norikane.hp41238` が管理する `.codex-worktrees/staging-live-41238` を新しい `origin/staging` HEAD へ fast-forward し、`launchctl kill SIGTERM gui/<uid>/com.norikane.hp41238` で launchd 管理 job を graceful restart する。KeepAlive による再起動だけを使い、`SIGKILL`、`kickstart -k`、別 port、別 server への置換は禁止する。
4. 新 PID の 41238 LISTEN、配信 worktree HEAD、HTTP 200、`/api/chatbot/build-info` の `commitSha == origin/staging` を確認し、「41238で最新の見た目を確認できます」と報告する。

41238 の更新はローカル確認用に限る。HP デザイン変更の master push / Vercel Production deploy は、さとしさんの明示的な目視 GO が出るまで禁止する。

## ポートポリシー

【ポートポリシー（HP チャットボット / norikane_satoshi_HP 限定・恒久）】本プロジェクトでは 41238 以外のポートをどんな状況でも使用しない。別ポートでの起動・回避・並行検証・フォールバックを含め一切禁止。ただし 41238 が他プロセスで塞がっている場合は別ポートへ逃げず、41238 を塞ぐ原因を安全に除去して 41238 を空ける。grading-verify 等の保護プロセス / launch agent は kill しない。dev サーバー起動は raw next dev の foreground long-lived 直接起動ではなく wrapper cc_notion_web_server.py 経由とする。
