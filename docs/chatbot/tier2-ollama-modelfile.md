当初想定の cyberagent/DeepSeek-R1-Distill-Qwen-Japanese-14B-gguf は HF 上に存在せず、公式寄りの mmnga ミラー mmnga/cyberagent-DeepSeek-R1-Distill-Qwen-14B-Japanese-gguf:Q4_K_M を採用した。
`ollama show --modelfile hf.co/mmnga/cyberagent-DeepSeek-R1-Distill-Qwen-14B-Japanese-gguf:Q4_K_M` の FROM はローカル blob を指す pull 済みモデルで、再 build は不要。
Modelfile 書き換えは起きていない。
