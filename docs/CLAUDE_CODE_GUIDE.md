# Claude Code Integration Guide (Automatic Login Bypass)

**Open Gravity** includes a built-in authentication bypass for Anthropic's **Claude Code CLI (`claude`)**, allowing you to run Claude Code completely free of Anthropic login prompts and powered by your **Google Antigravity Pro** subscription.

---

## ⚡ Method 1: Instant 1-Click Launch (Recommended)

From your terminal or by double-clicking `launch-claude.bat`:

```powershell
# Using the Open Gravity binary:
open-gravity claude

# Or via npm/Node:
node dist/index.js claude

# Or in the interactive TUI prompt, just type:
og > claude
```

Open Gravity will automatically:
1. Inject the login bypass into `~/.claude.json`.
2. Configure `ANTHROPIC_BASE_URL` to route requests to your local Open Gravity proxy.
3. Supply the mock authorization key `ANTHROPIC_API_KEY`.
4. Launch the interactive Claude Code CLI directly in your terminal.

---

## 🛠️ Method 2: Auto-Configure Environment (`open-gravity configure`)

Run:
```bash
open-gravity configure
```

This creates a global `claude-og.bat` script in your home directory. You can then launch Claude Code anytime with:

```powershell
claude-og
```

---

## ⌨️ Method 3: Manual Environment Variables

If you want to launch `claude` in an existing shell session:

### Windows PowerShell:
```powershell
$env:ANTHROPIC_BASE_URL = "http://127.0.0.1:8080"
$env:ANTHROPIC_API_KEY = "sk-ant-api03-gravity-bridge-bypass-key-1234567890"
claude
```

### Linux / macOS / Git Bash:
```bash
export ANTHROPIC_BASE_URL="http://127.0.0.1:8080"
export ANTHROPIC_API_KEY="sk-ant-api03-gravity-bridge-bypass-key-1234567890"
claude
```
