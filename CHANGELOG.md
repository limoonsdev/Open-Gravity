# Changelog

## 2.1.0

### Added
- **Automatic tool calling for every model.** Models without native function calling get emulated tools (prompt protocol + streaming parser for `<tool_call>` JSON, Qwen3-Coder `<function=…>` XML, `<invoke>` and fenced blocks), so Claude Code, Codex and other agents work on them. Detected from the model database or from the provider's error, then remembered. Per-provider tool mode: auto / native / always emulate. Verified end to end with the real Claude Code and Codex CLIs.
- **Tool-call repair** on translated streams: broken JSON arguments are repaired and coerced to the tool schema, tool names are fixed (case, `functions.` prefix); `<think>` tags become real reasoning blocks.
- **Self-healing compatibility.** 4xx errors caused by unsupported features (tools, `tool_choice`, `parallel_tool_calls`, `stream_options`, `max_tokens` too large or renamed, context overflow, sampling parameters, unknown fields, system role, images, JSON mode, reasoning) are fixed and retried immediately; fixes are stored per model and listed in the dashboard with a reset button.
- **Model database** of 3,500+ models (context window, max output, tools, vision, reasoning, prices), compiled from the MIT-licensed LiteLLM catalog, bundled and refreshed weekly. Used for output clamping, cost estimates, tool decisions, `/v1/models` context lengths and dashboard capability tags.
- **103 provider presets** (was 28): Azure OpenAI, Bedrock, Vertex AI, Cloudflare, Databricks, Cohere, SambaNova, Nebius, Novita, Scaleway, OVHcloud, gateways (Vercel, Requesty, Portkey, LiteLLM…), Chinese providers (DashScope, Zhipu, Volcengine, Qianfan, Hunyuan, SiliconFlow…) and 17 local engines (llama.cpp, vLLM, SGLang, TGI, LocalAI, Jan, KoboldCpp, Xinference, Docker Model Runner, MLX…). URL variables (resource name, account id, region), `api-key` and custom-header authentication.
- **Ollama API** (`/api/chat`, `/api/generate`, `/api/tags`, `/api/show`, `/api/ps`, `/api/version`, NDJSON streaming): any Ollama app (VS Code Copilot, Open WebUI, Msty…) can use every configured model. Legacy `/v1/completions` too.
- **Combo strategies** `fastest` (measured time to first token), `cheapest` (model prices) and `race` (two targets in parallel, first answer wins).
- Optional **response cache** for identical requests.
- Dashboard: provider catalog grouped by category, URL variable fields, tool-calling and authentication settings, *Compatibility* tab, model capability tags, latency on combo targets, *Compatibility & performance* settings, request badges (tools emulated, auto-fixed, cache).
- Integration snippets for VS Code Copilot and Open WebUI.

### Changed
- Executor rewritten around explicit open / prime / pump phases; single write per streamed chunk.
- The executable for the build host embeds a V8 code cache (faster cold start).
- The Antigravity provider now supports tools through emulation.

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
