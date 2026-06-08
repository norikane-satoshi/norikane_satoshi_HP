# Chatbot On-Demand Knowledge Design

## Target Pages To Grant

- `AIチャットボット 相談窓口の設計`: workflow duration table, schedule wording, candidate granularity, tight-deadline policy.
- `カラーグレーディングの因数分解`: grading-level explanation for customer-facing knowledge.
- `フィルムルックについてわかっていること`: film-look explanation for customer-facing knowledge.
- `カラーコレクションの因数分解`: correction/workflow explanation already published at `/notes/correction`.

## Access Policy

TIA1 and TIA2 use Notion AI inside the Notion workspace. They receive only the lightweight source index plus selected page pointers, and should rely on granted Notion page access when detail is needed. Page body text is not copied into the fixed prompt.

TIA3 cannot access Notion. It reads local mirror files from `CHATBOT_NOTION_MIRROR_ROOT`, defaulting to `/Users/norikene_satoshi/notion-mirror/chatbot-knowledge`. Mirror paths are listed in `src/lib/chatbot/knowledge/on-demand-sources.ts`.

## Mirror Policy

Keep one Markdown file per source page, preserving title, Notion page URL/id, last edited time, and body. Update hourly for normal staging verification and on demand before acceptance tests that depend on fresh wording. The code falls back to existing curated snapshots only when a mirror file is missing.

## Flow

1. The fixed system prompt includes only `title + summary + source + mirror path`.
2. `buildChatbotKnowledgeContext` classifies the latest message into `schedule`, `workflow`, `color-grading`, `color-correction`, or `film-look`.
3. Tier1/Tier2 attach selected Notion page references to the current turn.
4. Tier3 attaches only selected local mirror excerpts, capped to keep prompt size bounded.
