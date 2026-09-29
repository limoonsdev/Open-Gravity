# Changelog

## 2.0.0

Open Gravity is now a universal AI router rather than an Antigravity-only bridge.

### Added
- Protocol translation between OpenAI Chat Completions, Anthropic Messages, OpenAI Responses and Gemini generateContent, with streaming, tool calls, thinking/reasoning, images and JSON mode.
- 28 provider templates (OpenAI, Anthropic, Gemini, OpenRouter, Groq, DeepSeek, xAI, Mistral, Z.ai, Kimi, MiniMax, Qwen, Cerebras, Together, Fireworks, NVIDIA, GitHub Models, Hugging Face, Vercel, DeepInfra, Perplexity, OpenAI Responses, Ollama, LM Studio, Antigravity and custom endpoints).
- Combos (fallback, round-robin, random), aliases with wildcards, default route.
- Multiple keys per provider with rotation and per-key / per-model cooldowns.
- Fallback on errors that happen inside the stream before the first token.
- Web dashboard: overview charts, providers, combos, routing, playground, live request log, integrations, API keys, settings.
- Usage analytics with estimated costs, 30-day local history.
- One-click configuration of Claude Code, Codex, OpenCode, Gemini CLI, Qwen Code and Aider with backup/restore; `open-gravity claude` and `open-gravity codex` launchers.
- Router API keys, dashboard password, CSRF and DNS-rebinding protection.
- Single executables for Windows, Linux and macOS (Node.js SEA), built by CI.

### Changed
- Default port is now 18080 and data lives in `~/.open-gravity/`. Settings from 1.x are imported on first start.
- The Antigravity bridge is now one provider among others; its command execution no longer goes through a shell with unescaped prompts.

### Removed
- The fake `/v1/embeddings` implementation (random vectors); embeddings are now forwarded to a real provider.
