<div align="center">

<img src="assets/logo.png" alt="Open Gravity Logo" width="100" height="100" />

# Open Gravity

**Local AI Proxy bridging your Google Antigravity models to Claude Code, Codex, Aider, Cursor, and any agent.**

[![Node.js](https://img.shields.io/badge/Node.js-v18%2B-green.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-MIT-purple.svg)](LICENSE)
[![Google Antigravity](https://img.shields.io/badge/Google-Antigravity-orange.svg)](https://antigravity.google)
[![Claude Code Ready](https://img.shields.io/badge/Anthropic-Claude%20Code-d97706.svg)](https://docs.anthropic.com/en/docs/agents-and-tools/claude-code/overview)
[![OpenAI Compatible](https://img.shields.io/badge/OpenAI-API%20Emulated-412991.svg)](https://platform.openai.com)

</div>

---

## What is Open Gravity?

If you have a **Google AI Pro / Antigravity** subscription, you get access to Google's top reasoning models (**Gemini 3.7 Flash High**, **Gemini Pro Agent**, **Claude Sonnet**, **GPT-OSS 120B**).

However, external tools like Anthropic's **Claude Code CLI (`claude`)**, **Codex**, **Aider**, or **Cursor IDE** usually require separate pay-per-token API keys.

**Open Gravity bridges this gap**: it runs locally on your machine, auto-detects your active Antigravity session, and serves standard Anthropic and OpenAI API endpoints. All requests from your external tools are seamlessly executed through your logged-in Google Pro subscription.

> [!IMPORTANT]
> **Keep Antigravity open in the background.**  
> Open Gravity connects to Antigravity's local language server daemon, using your authenticated Google account and Pro tier quota. Zero extra API keys needed.

---

## Features

- **Automatic IDE Auto-Configuration**: Run `open-gravity configure` to automatically write and update config files for Cursor, Continue.dev, Aider, and Claude Code.
- **Dual API Emulation**: Concurrently serves Anthropic Messages (`/v1/messages`) and OpenAI Chat Completions (`/v1/chat/completions`).
- **Real-Time Token Streaming**: Full Server-Sent Events (SSE) streaming support.
- **28+ Models Available**: Instant access to `gemini-3.7-flash-high`, `gemini-pro-agent`, `claude-sonnet-4-6`, `claude-opus-4-6-thinking`, `gpt-oss-120b-medium`, etc.
- **Account & Quota Visibility**: Detects your authenticated Google account (`name` / `email`), active plan, and remaining model quota with reset times.
- **Web Dashboard (`/dashboard`)**: Minimal dark UI for monitoring requests, latency, token throughput, and testing models.

---

## Quick Start

### 1. Installation

```bash
git clone https://github.com/alexis/open-gravity.git
cd open-gravity
npm install
npm run build
```

### 2. Auto-Configure Your Tools

Run the 1-click configurator to automatically configure all your installed IDEs and CLIs:

```bash
node dist/index.js configure
```

This will automatically configure:
- **Cursor IDE**: sets custom models and points the OpenAI Base URL to Open Gravity.
- **Continue.dev**: adds Antigravity models to `~/.continue/config.json`.
- **Aider**: creates `.aider.conf.yml` with `gemini-3.7-flash-high`.
- **Claude Code**: creates global `claude-og` launcher script with `ANTHROPIC_BASE_URL`.

### 3. Start Open Gravity

```bash
npm start
# Or with options:
node dist/index.js start --port 8080 --open
```

---

## Manual Agent Setup

If you prefer to configure tools manually via environment variables:

### 🟣 Claude Code CLI (`claude`)

**Windows PowerShell:**
```powershell
$env:ANTHROPIC_BASE_URL = "http://127.0.0.1:8080"
$env:ANTHROPIC_API_KEY = "gravity-bridge"
claude
```

**Linux / macOS / Bash:**
```bash
export ANTHROPIC_BASE_URL="http://127.0.0.1:8080"
export ANTHROPIC_API_KEY="gravity-bridge"
claude
```

---

### 🟢 Codex CLI & Python OpenAI SDK

**Windows PowerShell:**
```powershell
$env:OPENAI_BASE_URL = "http://127.0.0.1:8080/v1"
$env:OPENAI_API_KEY = "gravity-bridge"
codex
```

**Python SDK:**
```python
from openai import OpenAI

client = OpenAI(
    base_url="http://127.0.0.1:8080/v1",
    api_key="gravity-bridge"
)

response = client.chat.completions.create(
    model="gemini-3.7-flash-high",
    messages=[{"role": "user", "content": "Write a quicksort in Rust."}],
    stream=True
)

for chunk in response:
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="", flush=True)
```

---

### ⚡ Aider CLI

```bash
aider --openai-api-base http://127.0.0.1:8080/v1 \
      --openai-api-key gravity-bridge \
      --model openai/gemini-3.7-flash-high
```

---

### 💻 Cursor IDE

In **Cursor Settings > Models > OpenAI API Key**:
- **Override OpenAI Base URL**: `http://127.0.0.1:8080/v1`
- **API Key**: `gravity-bridge`
- **Models**: `gemini-3.7-flash-high`, `claude-sonnet-4-6`, `gemini-pro-agent`

---

## CLI Reference

| Command | Description |
|---|---|
| `open-gravity start` | Start the local proxy server |
| `open-gravity configure [ide]` | Automatically write config files for Cursor, Continue, Aider, Claude Code |
| `open-gravity status` | Check Google account session, plan, and quota remaining |
| `open-gravity models` | List all 28+ Antigravity models |
| `open-gravity setup` | Print copy-paste environment variable snippets |
| `open-gravity doctor` | Run system and port diagnostic checks |

---

## Security

- **100% Local Loopback**: All proxy traffic stays on `127.0.0.1`.
- **Local CSRF Validation**: Communicates directly with your local Antigravity Language Server daemon.

---

## License

MIT License © Alexis & Open Gravity Contributors
