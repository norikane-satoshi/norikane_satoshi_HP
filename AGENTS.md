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
- Do not kill a dev server you find already running just because you did not start it. Reuse it, probe the port, attach to the existing PID, and only restart it if it is actually broken.
- Start dev servers fully detached, with stdio redirected to a log file, so the cc-notion job exit does not take the server down.
- When you do start or restart one, report URL, PID, and log path so the next session can find it without rediscovery.
- If Satoshi explicitly says "kill the dev server" / "stop the dev server" / "restart the dev server", that is the only condition under which terminating it is allowed.

## Local dev server protection（絶対遵守、違反は重大インシデント扱い）

のーちゃん／さとしさんから明示指示が無い限り、以下を厳守する（cc-notion から起動した backend にも同じ規律で適用される）：

- LISTEN 中のローカル dev server を stop / kill / restart / port 閉鎖しない。
- 検証目的でも実装変更目的でも、LISTEN 中の wrapper / node プロセスに SIGTERM / SIGKILL / pkill / wrapper stop コマンドを送らない。
- セッション終了時・タスク完了時も dev server を kill しない（「片付け」と称した kill 禁止）。
- LISTEN なしの場合のみ wrapper restart 可。restart 時は ttl_sec 上限（現行 `cc_notion_web_server.py` は 3600 にクリップ）を尊重。
- 完了報告送信直前に `/usr/sbin/lsof -nP -iTCP:<対象 port> -sTCP:LISTEN` を実行し、LISTEN 継続を確認して出力を完了報告に貼る。
- 「LISTEN 継続」と報告した後にプロセスを kill しない。報告内容は次セッションまで保持される事実として扱う。
- 該当 port（grading-verify は 41238）は他用途で奪わない。
- 違反が検知された場合、次の発注以降の冒頭に違反履歴として再掲され続ける。
