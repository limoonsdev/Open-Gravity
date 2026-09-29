<div align="center">

<img src="assets/logo.svg" alt="Open Gravity" width="96" height="96" />

# Open Gravity

**One local endpoint for every AI model you use.**
A universal AI router with 100+ provider presets, automatic tool calling for any model, self-healing compatibility, fallback combos, multi-key rotation, usage analytics and a built-in web dashboard, shipped as a single executable.

[![Build](https://github.com/limoonsdev/Open-Gravity/actions/workflows/build.yml/badge.svg)](https://github.com/limoonsdev/Open-Gravity/actions/workflows/build.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-purple.svg)](LICENSE)
![Platforms](https://img.shields.io/badge/Windows%20%C2%B7%20macOS%20%C2%B7%20Linux-single%20executable-blue)

[🇫🇷 Guide en français](docs/GUIDE-FR.md) · [Architecture](docs/ARCHITECTURE.md) · [Changelog](CHANGELOG.md)

<img src="docs/images/overview.png" alt="Open Gravity dashboard" width="900" />

</div>

---

Point **Claude Code, Codex, Gemini CLI, OpenCode, Cursor, Cline, Aider, VS Code Copilot, Open WebUI** or any OpenAI / Anthropic / Gemini / Ollama SDK at `http://127.0.0.1:18080` and route every request to **OpenAI, Anthropic, Google Gemini, Azure, Bedrock, Vertex, OpenRouter, Groq, DeepSeek, xAI, Mistral, Z.ai GLM, Kimi, MiniMax, Qwen, Cerebras, SambaNova, Together, Fireworks, NVIDIA, Cloudflare, Hugging Face, SiliconFlow, Volcengine, Ollama, LM Studio, vLLM, llama.cpp** and many more: **103 built-in presets** (cloud APIs, gateways, Chinese providers, 17 local engines), a **database of 3,500+ models** (context windows, tool support, prices), and any OpenAI-, Anthropic-, Gemini- or Responses-compatible endpoint.

Each client keeps speaking its own protocol. Open Gravity translates **OpenAI Chat Completions ⇄ Anthropic Messages ⇄ OpenAI Responses ⇄ Gemini generateContent ⇄ Ollama ⇄ legacy Completions** on the fly, including streaming, tool calls, reasoning/thinking and images. So Claude Code can run on Gemini, Codex on Claude, and Gemini CLI on a local Ollama model.

**Models without function calling still get tools.** When a model has no native tool calling (many local and open models, custom endpoints, the Antigravity bridge), Open Gravity emulates it: tools are described in the prompt, the model's `<tool_call>` blocks (and other common dialects) are parsed back into real tool calls while streaming. Claude Code and Codex then work normally on that model.

## Features

| | |
|---|---|
| **Universal translation** | 6 client protocols × 4 upstream protocols, streaming, tool calls, thinking, images, JSON mode. Same-protocol requests are passed through untouched for perfect fidelity. |
| **Automatic tool calling** | Models without function calling get emulated tools, detected automatically (model database, or the provider's error) and remembered. Tool arguments from any model are repaired (broken JSON, wrong types, wrong tool-name casing) and `<think>` tags become real reasoning blocks. |
| **Self-healing compatibility** | When a provider rejects a request because of a feature it doesn't support (tools, `tool_choice`, `stream_options`, `max_tokens` too large or renamed, sampling parameters, system role, images, JSON mode, reasoning, unknown fields…), the request is fixed and retried at once, and the fix is remembered for that model. |
| **Model database** | 3,500+ models with context window, max output, tool/vision/reasoning support and prices (compiled from the MIT-licensed LiteLLM catalog, refreshed weekly). Output limits are clamped automatically; `/v1/models` and `/api/show` report real context windows. |
| **Combos** | Virtual models that chain several targets: `coding = claude-sonnet → qwen3-coder → gemini-2.5-pro`. Fallback, round-robin, random, **fastest** (measured time to first token), **cheapest** (model prices) or **race** (two targets at once, first answer wins). |
| **Performance** | Streaming with no buffering after the first token, keep-alive connection pools, optional response cache for identical requests, V8 code cache for a ~0.1 s cold start. |
| **Resilience** | Automatic fallback on 429/5xx/auth errors/timeouts, even when the provider fails *inside* the stream (the response is committed to the client only after the first token arrives). |
| **Multi-account** | Several API keys per provider with round-robin or fill-first rotation. Rate-limited keys are paused per model (honouring `Retry-After`), bad keys are paused as a whole. |
| **Aliases** | Rename or redirect any model name, with wildcards: `claude-*haiku*` → `fast`. Unknown names can fall back to your default route. |
| **Dashboard** | Overview charts, provider health, key testing, model discovery, combo editor, route tester, playground, live request log with per-attempt details, API keys, settings. Light and dark themes. |
| **Usage & cost** | Tokens (incl. cached and reasoning), latency, time-to-first-token and estimated cost per request, model and provider. Kept locally for 30 days. |
| **One-click integrations** | Configures Claude Code, Codex, OpenCode, Gemini CLI, Qwen Code and Aider (with backup/restore), plus copy-paste snippets for Cline, Roo, Kilo, Continue, Cursor, Zed, VS Code Copilot, Open WebUI and SDKs. |
| **Ollama-compatible** | Speaks the Ollama API (`/api/chat`, `/api/generate`, `/api/tags`, `/api/show`), so every app that supports Ollama can use any cloud model through Open Gravity. |
| **Launchers** | `open-gravity claude` / `open-gravity codex` start those tools already wired to the router, with no config changes. |
| **Secure by default** | Listens on localhost; remote clients and web pages need a router API key; optional dashboard password; CSRF and DNS-rebinding protection. |
| **Single executable** | A ~85 MB `open-gravity.exe` with the Node.js runtime, the router and the dashboard inside. Nothing to install. |
| **Antigravity bridge** | The original Open Gravity feature lives on as a provider: use the Google Antigravity desktop app running on your machine. |

## Quick start

### 1. Get it

**Windows / macOS / Linux executable**: download `open-gravity-win-x64.exe` (or the build for your platform) from the [Releases](https://github.com/limoonsdev/Open-Gravity/releases) page, or from the artifacts of the latest [Build workflow run](https://github.com/limoonsdev/Open-Gravity/actions/workflows/build.yml). Double-click it: the router starts and the dashboard opens in your browser.

> Windows SmartScreen may warn about an unsigned app: *More info → Run anyway*.
> macOS: `xattr -d com.apple.quarantine open-gravity-macos-arm64 && chmod +x open-gravity-macos-arm64`.

**From source** (Node.js 20.12+):

```bash
git clone https://github.com/limoonsdev/Open-Gravity.git
cd Open-Gravity
npm install
npm start            # builds and starts the router + dashboard
```

### 2. Add a provider

Open **http://127.0.0.1:18080** → *Providers* → *Add provider* → paste an API key. Gemini, OpenRouter, Groq, Cerebras, NVIDIA and GitHub Models have free tiers; Ollama and LM Studio run locally without a key. The model list is fetched automatically.

### 3. (Optional) create a combo

*Combos* → *New combo*, e.g. `coding`: `anthropic/claude-sonnet-4-5` → `openrouter/qwen/qwen3-coder` → `gemini/gemini-2.5-pro`. Make it the default route in *Models & routing*.

### 4. Connect your tools

*Integrations* → *Configure automatically*, or:

```bash
open-gravity claude          # Claude Code through the router
open-gravity codex           # Codex CLI through the router
```

<img src="docs/images/providers.png" alt="Providers" width="49%" /> <img src="docs/images/combos.png" alt="Combos" width="49%" />

<img src="docs/images/compatibility.png" alt="Learned compatibility fixes: tools emulated for models without function calling" width="49%" />

## Connecting clients

| Client | Base URL | Notes |
|---|---|---|
| **Claude Code** | `http://127.0.0.1:18080` | `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN`, or `open-gravity claude` |
| **Codex CLI** | `http://127.0.0.1:18080/v1` | `wire_api = "responses"`, or `open-gravity codex` |
| **Gemini CLI** | `http://127.0.0.1:18080` | `GOOGLE_GEMINI_BASE_URL` + `GEMINI_API_KEY` in `~/.gemini/.env` |
| **OpenCode** | `http://127.0.0.1:18080/v1` | `@ai-sdk/openai-compatible` provider |
| **Cline / Roo / Kilo** | `http://127.0.0.1:18080/v1` | "OpenAI Compatible" provider (or Anthropic with a custom base URL) |
| **Aider, Continue, Zed, Qwen Code** | `http://127.0.0.1:18080/v1` | OpenAI-compatible settings |
| **Cursor** | public URL + `/v1` | Cursor calls custom endpoints from its servers: expose the router through a tunnel and use an API key |
| **VS Code Copilot Chat** | `http://127.0.0.1:18080` | "Manage Models" → Ollama; the router answers as an Ollama server |
| **Open WebUI, Msty, any Ollama app** | `http://127.0.0.1:18080` | Ollama API URL |
| **OpenAI SDK** | `http://127.0.0.1:18080/v1` | any language |
| **Anthropic SDK** | `http://127.0.0.1:18080` | any language |
| **Google GenAI SDK** | `http://127.0.0.1:18080` | `http_options={"base_url": ...}` |

When no router API key is required (the default for local use), any key value is accepted.

<details>
<summary>Claude Code: manual setup</summary>

```bash
export ANTHROPIC_BASE_URL=http://127.0.0.1:18080
export ANTHROPIC_AUTH_TOKEN=open-gravity           # or a router key
export ANTHROPIC_MODEL=coding                      # a combo, provider/model, or alias
export ANTHROPIC_DEFAULT_HAIKU_MODEL=fast          # used for background tasks
claude
```

Claude Code warns that it doesn't know the context window of custom model names; set `CLAUDE_CODE_MAX_CONTEXT_TOKENS` if your model has a larger window than 200k.
</details>

<details>
<summary>Codex CLI: ~/.codex/config.toml</summary>

```toml
model = "coding"
model_provider = "open-gravity"

[model_providers.open-gravity]
name = "Open Gravity"
base_url = "http://127.0.0.1:18080/v1"
wire_api = "responses"
```
</details>

## Model names and routing

A request's `model` is resolved in this order:

1. **Alias**: exact or wildcard (`claude-*haiku*`), pointing to anything below.
2. **Combo**: a named list of targets tried according to its strategy.
3. **`provider/model`**: explicit, e.g. `openrouter/qwen/qwen3-coder`, `gemini/gemini-2.5-pro`, `ollama/llama3.1:8b`.
4. **Bare model id**: every enabled provider that lists this exact model.
5. **Default route**: for empty names, `auto`, or (if enabled) unknown names.

The *Route tester* in the dashboard shows exactly which targets a name resolves to.

### Fallback rules

| Upstream result | What happens |
|---|---|
| 429 rate limit | That key + model is paused (`Retry-After`, or 60 s); next key, then next target |
| 401 / 402 / 403 | The key is paused for 10 min; next key |
| 5xx, timeout, network error | Key + model paused for 20 s; next key |
| 400 / 422 caused by an unsupported feature | Request fixed (e.g. tools emulated, parameter dropped, output capped) and retried on the same target; the fix is remembered |
| 400 / 404 / 413 / 422 (other) | Next target (the request may suit another model better) |
| Error inside the stream before any content | Treated like a 5xx: falls back transparently |
| Error after content was streamed | Reported to the client in its own protocol |

Up to 6 attempts per request by default (configurable), across keys and targets. Learned fixes are listed (and can be reset) in *Settings* and in each provider's *Compatibility* tab.

## API endpoints

| Protocol | Endpoints |
|---|---|
| OpenAI | `POST /v1/chat/completions`, `POST /v1/responses`, `GET /v1/models`, `POST /v1/embeddings` |
| Anthropic | `POST /v1/messages`, `POST /v1/messages/count_tokens`, `GET /v1/models` (with `anthropic-version`) |
| Gemini | `POST /v1beta/models/{model}:generateContent`, `:streamGenerateContent`, `:countTokens`, `GET /v1beta/models` |
| Ollama | `POST /api/chat`, `POST /api/generate`, `POST /api/show`, `GET /api/tags`, `GET /api/ps`, `GET /api/version` |
| Legacy | `POST /v1/completions` |
| Misc | `GET /health` |

Paths without `/v1` (and with `/openai/v1`, `/anthropic/v1`, `/api/v1` prefixes) are accepted too. Responses carry `x-og-provider`, `x-og-model` and `x-og-request-id` headers (plus `x-og-emulated-tools` and `x-og-cache` when relevant).

## Providers

| Category | Built-in presets (103) |
|---|---|
| Popular | OpenAI, Anthropic, Google Gemini, OpenRouter, Groq, DeepSeek, xAI Grok, Mistral |
| Cloud & API | Azure OpenAI / AI Foundry, Amazon Bedrock, Google Vertex AI (express), Cloudflare Workers AI, Databricks, Cohere, AI21, Cerebras, SambaNova, Together, Fireworks, DeepInfra, NVIDIA NIM, GitHub Models, Hugging Face, Perplexity, Nebius, Novita, Hyperbolic, Featherless, Baseten, Friendli, Parasail, Nscale, Scaleway, OVHcloud, IONOS, Upstage, Reka, Inception, Nous, Morph, Kluster, Inference.net, Chutes, Venice, W&B Inference, GMI Cloud, Ollama Cloud, Sarvam, Codestral, Z.ai (+ Coding Plan), Moonshot Kimi, MiniMax, Qwen, OpenAI Responses… |
| Gateways | Vercel AI Gateway, Requesty, AIHubMix, AI/ML API, Poe, OpenCode Zen, Portkey, LiteLLM proxy |
| China | Qwen (DashScope), Zhipu GLM, Kimi, Volcengine Ark (Doubao), Baidu Qianfan, Tencent Hunyuan, iFlytek Spark, StepFun, Baichuan, 01.AI Yi, SiliconFlow, ModelScope |
| Local engines | Ollama, LM Studio, llama.cpp, vLLM, SGLang, TGI, LocalAI, Jan, KoboldCpp, text-generation-webui, Xinference, GPT4All, Lemonade, Docker Model Runner, MLX, llamafile, Msty, Antigravity desktop app |
| Custom | Any OpenAI-, Anthropic-, Gemini- or Responses-compatible endpoint |

Each provider supports several keys, custom headers, a per-provider HTTP proxy and timeout, a tool-calling mode (auto / native / always emulate) and any authentication style (`Authorization: Bearer`, `x-api-key`, `api-key`, `x-goog-api-key`, a custom header with prefix, or none). Presets with URL variables (Azure resource, Cloudflare account, Bedrock region…) ask for them when you add the provider.

## Security

- The router listens on `127.0.0.1` by default. On `0.0.0.0`, requests from other machines must carry a router API key.
- Browser requests from other websites always need a key (a random web page can't spend your quota), and the Host header is checked against DNS rebinding.
- The dashboard API requires a same-origin custom header (CSRF-proof). Set a dashboard password to protect it, which is required for remote dashboard access.
- Provider keys are stored in `~/.open-gravity/config.json` (file mode 600) and are never sent back to the browser.

## CLI

```
open-gravity [start] [--port 18080] [--host 127.0.0.1] [--no-open]
open-gravity claude [args...]          launch Claude Code through the router
open-gravity codex [args...]           launch Codex CLI through the router
open-gravity setup [tool] [--model m]  configure claude-code | codex | opencode | gemini-cli | qwen-code | aider
open-gravity models                    list routable models
open-gravity key create [name]         create a router API key
open-gravity doctor                    check config and test every provider
open-gravity status                    is the router running?
```

While running, the console accepts `open`, `claude`, `codex`, `models`, `status`, `quit`. Starting a second instance just opens the dashboard of the running one.

Environment variables: `OPEN_GRAVITY_HOME` (data folder), `OG_PORT`, `OG_HOST`, `OG_NO_OPEN=1`, `OG_DEBUG=1`.

## Building

```bash
npm run check          # typecheck + tests + bundle
npm run exe            # executable for this machine          -> release/
npm run exe:win        # Windows .exe (works from Linux/macOS too)
npm run exe:all        # win-x64, linux-x64, macos-arm64, macos-x64
npm run smoke -- release/open-gravity-win-x64.exe
```

Executables are built with [Node.js Single Executable Applications](https://nodejs.org/api/single-executable-applications.html): the app is bundled by esbuild into one file, embedded in the official Node.js binary of the same version (downloaded and SHA-256-verified for other platforms). On Windows hosts the icon and version info are applied too. CI builds every platform on each push, and a `v*` tag publishes a GitHub release.

## Data

Everything lives in `~/.open-gravity/` (`%USERPROFILE%\.open-gravity` on Windows):

- `config.json`: providers, keys, combos, aliases, settings (edits are hot-reloaded)
- `usage/*.jsonl`: request history (retention configurable)
- `backups/`: previous tool configuration files, for *Restore*
- `cache/modeldb.json`: the latest model database (the executable also carries a built-in copy)

Open Gravity 1.x settings (`~/.gemini/gravity-bridge.json`, `GEMINI_API_KEY`) are imported on first start.

## FAQ

**Can I use my Claude Pro/Max, ChatGPT or Gemini subscription instead of API keys?**
Not directly. Open Gravity works with official API keys and compatible endpoints. The Antigravity provider bridges the Antigravity desktop app you are signed into on your own computer.

**Is anything sent to a third party?**
No. Requests go straight from your machine to the providers you configured. There is no telemetry.

**Does it really support "1000+ providers"?**
There are about a hundred distinct AI API services, and Open Gravity ships a preset for 103 of them. Everything else that speaks the OpenAI, Anthropic, Gemini, Responses or Ollama protocol (most inference servers, gateways and self-hosted engines do) works through a *Custom endpoint*, with the same fallback, key rotation, tool emulation and self-healing.

**My model has no tool calling. Can I use it with Claude Code or Codex?**
Yes. Leave *Tool calling* on *Auto*: if the model database says the model has no function calling, or if the provider rejects the `tools` field, Open Gravity switches to emulated tools and remembers it. You can also force *Always emulate* per provider. How well it works depends on the model following instructions; recent open models (Qwen, Llama 3.x, Mistral, DeepSeek, GLM…) handle it well.

**Where do the cost figures come from?**
From the model database (public list prices per provider), with a fallback table. They are estimates: free tiers, discounts and very new models may not be reflected. Local models count as free.

## License

MIT © Alexis & Open Gravity contributors

The model database (`src/data/models.json`) is derived from LiteLLM's `model_prices_and_context_window.json`, MIT License, Copyright (c) 2023 Berri AI.
