# Tier 1 / Tier 2 smoke result

## Tier 1 Notion AI CDP smoke
- status: fail
- cdpBaseUrl: http://127.0.0.1:9223
- targetUrlIncludes: notion.so
- modelSelector: apricot-sorbet-high
- targetUrl: https://www.notion.so/ai
- error: assert failed: DOM does not contain apricot-sorbet-high
- note: 強制更新設定が効いていない可能性

## Tier 2 Ollama TPS
- status: pass
- model: hf.co/mmnga/cyberagent-DeepSeek-R1-Distill-Qwen-14B-Japanese-gguf:Q4_K_M
- baselineAverageTps: 9.58
- baselineP50Tps: 9.65
- baselineP95Tps: 10.08
- tuned: not-run
- finalAverageTps: 9.58
- finalP50Tps: 9.65
- finalP95Tps: 10.08
- baselineDoc: docs/chatbot/tier2-tps-baseline.md
