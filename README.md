<div align="center">

<img src="assets/logo.png" alt="Open Gravity Logo" width="100" height="100" />

# Open Gravity

**Universal local AI Proxy connecting Google Antigravity models to Claude Code, Codex, Aider, Cursor, and any AI agent.**

[![Node.js](https://img.shields.io/badge/Node.js-v18%2B-green.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-MIT-purple.svg)](LICENSE)
[![Google Antigravity](https://img.shields.io/badge/Google-Antigravity-orange.svg)](https://antigravity.google)
[![Claude Code Ready](https://img.shields.io/badge/Anthropic-Claude%20Code-d97706.svg)](https://docs.anthropic.com/en/docs/agents-and-tools/claude-code/overview)
[![OpenAI Compatible](https://img.shields.io/badge/OpenAI-API%20Emulated-412991.svg)](https://platform.openai.com)

</div>

---

## Overview

Open Gravity runs locally on your machine, hooks into your active Google Antigravity session, and serves standard Anthropic Messages and OpenAI Chat Completions API endpoints.

This allows external AI coding tools (**Claude Code**, **Codex**, **Aider**, **Cursor**) to use your logged-in Google Pro subscription and reasoning models (**Gemini 3.7 Flash High**, **Claude Sonnet**, **Gemini Pro Agent**, **GPT-OSS 120B**) without requiring separate third-party API keys.

---

## Features

- **Claude Code Instant Launch & Login Bypass**: Run `open-gravity claude` to launch Anthropic's official Claude Code CLI with zero login prompts.
- **Interactive Terminal TUI**: Fast command interface (`models`, `configure`, `status`, `doctor`, `clear`, `quit`) running alongside the live proxy server.
- **Interactive Model Selector**: Arrow-key navigation (`↑` `↓`), real-time quota indicators, and 1-token health ping probes (`t`).
- **1-Click IDE Auto-Configuration**: Auto-configures settings for Cursor, Continue.dev, Aider, and Claude Code with `open-gravity configure`.
- **Zero Configuration**: Automatically discovers Antigravity daemon process, port, and CSRF token.

---

## Quick Start

### 1. Build and Compile

```bash
git clone https://github.com/limoonsdev/Open-Gravity.git
cd Open-Gravity
npm install
npm run compile
```

### 2. Auto-Configure Your Tools

```bash
open-gravity configure
```

### 3. Start the Server

```bash
open-gravity start
```

---

## Claude Code CLI Usage

To launch Claude Code with automatic login bypass:

```bash
open-gravity claude
```

Or from the interactive TUI prompt while the server is running:
```text
og > claude
```

---

## Runtime TUI Commands

While Open Gravity is running:

| Command | Hotkey | Description |
|---|---|---|
| `claude` | `cl` | Launch Claude Code with automatic login bypass |
| `models` | `m` | Open interactive arrow-key model selector & 1-token health ping |
| `configure` | `c` | Re-run auto-configuration for Cursor, Continue, Aider, Claude Code |
| `status` | `s` | Refresh Google account session, plan, and model quota |
| `doctor` | `d` | Run live Antigravity diagnostics and RPC validation |
| `clear` | `cls` | Clear terminal screen and redraw status header |
| `quit` | `q` | Stop the server and exit |

---

## Manual Environment Configuration

### Anthropic / Claude Code
```powershell
$env:ANTHROPIC_BASE_URL = "http://127.0.0.1:8080"
$env:ANTHROPIC_API_KEY = "sk-ant-api03-open-gravity-bypass"
claude
```

### OpenAI / Codex / Cursor
```powershell
$env:OPENAI_BASE_URL = "http://127.0.0.1:8080/v1"
$env:OPENAI_API_KEY = "open-gravity"
```

---

## License

MIT License © Alexis & Open Gravity Contributors
