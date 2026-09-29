// One-click configuration of AI coding tools to use the router.
// Every write is preceded by a backup so "Restore" can undo it.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { dataDir, writeFileAtomic } from '../core/util';

export interface ToolContext {
  baseUrl: string;
  apiKey: string;
  model: string;
  smallModel: string;
  models: string[];
}

export type ToolCategory = 'cli' | 'ide' | 'chat' | 'framework' | 'universal';

export interface ToolInfo {
  id: string;
  name: string;
  category: ToolCategory;
  docs?: string;
  description: string;
  detected: boolean;
  canApply: boolean;
  applied: boolean;
  files: string[];
  snippet: string;
  snippetLang: string;
  notes?: string;
  hasBackup: boolean;
}

interface ToolDef {
  id: string;
  name: string;
  category: ToolCategory;
  docs?: string;
  description: string;
  files: () => string[];
  detect: () => boolean;
  applied?: (ctx: ToolContext) => boolean;
  apply?: (ctx: ToolContext) => void;
  snippet: (ctx: ToolContext) => { text: string; lang: string };
  notes?: string;
}

const home = () => os.homedir();
const isWin = process.platform === 'win32';

function onPath(bin: string): boolean {
  try {
    execFileSync(isWin ? 'where' : 'which', [bin], { stdio: 'ignore', timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

/** Is a VS Code-family extension installed (VS Code, Insiders, Cursor, Windsurf, VSCodium)? */
function hasExtension(...prefixes: string[]): boolean {
  const dirs = ['.vscode', '.vscode-insiders', '.cursor', '.windsurf', '.vscode-oss'].map((d) => path.join(home(), d, 'extensions'));
  for (const dir of dirs) {
    try {
      const names = fs.readdirSync(dir).map((n) => n.toLowerCase());
      if (prefixes.some((p) => names.some((n) => n.startsWith(p.toLowerCase())))) return true;
    } catch { /* not installed */ }
  }
  return false;
}

function anyExists(...paths: string[]): boolean {
  return paths.some((p) => {
    try {
      return fs.existsSync(p);
    } catch {
      return false;
    }
  });
}

const appData = () => process.env.APPDATA || path.join(home(), 'AppData', 'Roaming');
const xdgConfig = () => process.env.XDG_CONFIG_HOME || path.join(home(), '.config');
const key = (ctx: ToolContext) => ctx.apiKey || 'open-gravity';

function readJson(file: string): any {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

function writeJson(file: string, data: any) {
  writeFileAtomic(file, JSON.stringify(data, null, 2) + '\n');
}

function readText(file: string): string {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

/** Set KEY=value lines in a dotenv file, preserving everything else. */
function setDotenv(file: string, values: Record<string, string>) {
  const lines = readText(file).split(/\r?\n/);
  const seen = new Set<string>();
  const out = lines.map((line) => {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (m && m[1] in values) {
      seen.add(m[1]);
      return `${m[1]}=${values[m[1]]}`;
    }
    return line;
  });
  for (const [k, v] of Object.entries(values)) if (!seen.has(k)) out.push(`${k}=${v}`);
  writeFileAtomic(file, out.join('\n').replace(/\n*$/, '\n'));
}

/** Set top-level `key: value` lines in a simple YAML file. */
function setYamlKeys(file: string, values: Record<string, string>) {
  const lines = readText(file).split(/\r?\n/);
  const seen = new Set<string>();
  const out = lines.map((line) => {
    const m = /^([A-Za-z0-9_-]+)\s*:/.exec(line);
    if (m && m[1] in values) {
      seen.add(m[1]);
      return `${m[1]}: ${values[m[1]]}`;
    }
    return line;
  });
  for (const [k, v] of Object.entries(values)) if (!seen.has(k)) out.push(`${k}: ${v}`);
  writeFileAtomic(file, out.join('\n').replace(/\n*$/, '\n'));
}

const tomlStr = (s: string) => JSON.stringify(s);

/** Update Codex config.toml: top-level model keys + our [model_providers.open-gravity] table. */
export function updateCodexToml(src: string, ctx: ToolContext): string {
  const lines = src ? src.split(/\r?\n/) : [];
  const firstTable = lines.findIndex((l) => /^\s*\[/.test(l));
  const top = firstTable < 0 ? lines : lines.slice(0, firstTable);
  let rest = firstTable < 0 ? [] : lines.slice(firstTable);

  const cleanedTop = top.filter((l) => !/^\s*(model|model_provider)\s*=/.test(l));
  while (cleanedTop.length && !cleanedTop[cleanedTop.length - 1].trim()) cleanedTop.pop();

  // Drop any previous open-gravity provider table.
  const kept: string[] = [];
  let skipping = false;
  for (const l of rest) {
    if (/^\s*\[/.test(l)) skipping = /^\s*\[model_providers\.(open-gravity|"open-gravity")\]\s*$/.test(l);
    if (!skipping) kept.push(l);
  }
  rest = kept;
  while (rest.length && !rest[rest.length - 1].trim()) rest.pop();

  const header = [`model = ${tomlStr(ctx.model)}`, 'model_provider = "open-gravity"'];
  const table = [
    '[model_providers.open-gravity]',
    'name = "Open Gravity"',
    `base_url = ${tomlStr(`${ctx.baseUrl}/v1`)}`,
    'wire_api = "responses"',
    ...(ctx.apiKey ? [`experimental_bearer_token = ${tomlStr(ctx.apiKey)}`] : []),
    'stream_idle_timeout_ms = 600000',
  ];
  return [...header, ...(cleanedTop.length ? ['', ...cleanedTop] : []), '', ...(rest.length ? [...rest, ''] : []), ...table, ''].join('\n');
}

function codexHome() {
  return process.env.CODEX_HOME || path.join(home(), '.codex');
}

const TOOLS: ToolDef[] = [
  {
    id: 'universal',
    name: 'Any other tool',
    category: 'universal',
    description: 'Every app that lets you set an OpenAI, Anthropic, Gemini, Ollama or Azure endpoint works: pick the matching URL.',
    files: () => [],
    detect: () => true,
    snippet: (ctx) => ({
      lang: 'text',
      text: [
        `OpenAI-compatible (chat, responses, embeddings, images, audio):  ${ctx.baseUrl}/v1`,
        `Anthropic-compatible (Messages API):                            ${ctx.baseUrl}`,
        `Google Gemini (generateContent):                                ${ctx.baseUrl}`,
        `Ollama (/api/chat, /api/generate, /api/tags):                   ${ctx.baseUrl}`,
        `Azure OpenAI (deployment = model name):                         ${ctx.baseUrl}`,
        `Mistral FIM / Codestral autocomplete:                           ${ctx.baseUrl}/v1`,
        `LM Studio API:                                                  ${ctx.baseUrl}/api/v0`,
        `Unknown format? POST any request body to:                       ${ctx.baseUrl}/`,
        '',
        `API key:  ${key(ctx)}   (any value works when no router key is required)`,
        `Model:    ${ctx.model}   (a combo, provider/model, or an alias)`,
      ].join('\n'),
    }),
    notes: 'Unknown model names fall back to your default route, so tools that insist on names like "gpt-4o" or "claude-sonnet-4" still work.',
  },
  {
    id: 'claude-code',
    category: 'cli',
    docs: 'https://docs.claude.com/en/docs/claude-code/settings#environment-variables',
    name: 'Claude Code',
    description: 'Anthropic\'s agentic CLI. Routed through the Anthropic Messages endpoint.',
    files: () => [path.join(home(), '.claude', 'settings.json'), path.join(home(), '.claude.json')],
    detect: () => onPath('claude') || fs.existsSync(path.join(home(), '.claude')),
    applied: (ctx) => readJson(path.join(home(), '.claude', 'settings.json'))?.env?.ANTHROPIC_BASE_URL === ctx.baseUrl,
    apply: (ctx) => {
      const file = path.join(home(), '.claude', 'settings.json');
      const s = readJson(file);
      s.env = { ...(s.env || {}) };
      delete s.env.ANTHROPIC_API_KEY;
      Object.assign(s.env, {
        ANTHROPIC_BASE_URL: ctx.baseUrl,
        ANTHROPIC_AUTH_TOKEN: ctx.apiKey || 'open-gravity',
        ANTHROPIC_MODEL: ctx.model,
        ANTHROPIC_DEFAULT_OPUS_MODEL: ctx.model,
        ANTHROPIC_DEFAULT_SONNET_MODEL: ctx.model,
        ANTHROPIC_DEFAULT_HAIKU_MODEL: ctx.smallModel,
        CLAUDE_CODE_SUBAGENT_MODEL: ctx.model,
        API_TIMEOUT_MS: '3000000',
      });
      writeJson(file, s);
      const stateFile = path.join(home(), '.claude.json');
      const state = readJson(stateFile);
      state.hasCompletedOnboarding = true;
      writeJson(stateFile, state);
    },
    snippet: (ctx) => ({
      lang: isWin ? 'powershell' : 'bash',
      text: isWin
        ? `$env:ANTHROPIC_BASE_URL = "${ctx.baseUrl}"\n$env:ANTHROPIC_AUTH_TOKEN = "${ctx.apiKey || 'open-gravity'}"\n$env:ANTHROPIC_MODEL = "${ctx.model}"\n$env:ANTHROPIC_DEFAULT_HAIKU_MODEL = "${ctx.smallModel}"\nclaude`
        : `export ANTHROPIC_BASE_URL="${ctx.baseUrl}"\nexport ANTHROPIC_AUTH_TOKEN="${ctx.apiKey || 'open-gravity'}"\nexport ANTHROPIC_MODEL="${ctx.model}"\nexport ANTHROPIC_DEFAULT_HAIKU_MODEL="${ctx.smallModel}"\nclaude`,
    }),
    notes: 'Or simply run "open-gravity claude" to launch Claude Code pre-configured, without touching any file.',
  },
  {
    id: 'codex',
    category: 'cli',
    docs: 'https://github.com/openai/codex/blob/main/docs/config.md',
    name: 'Codex CLI',
    description: 'OpenAI\'s coding agent. Uses the Responses API endpoint.',
    files: () => [path.join(codexHome(), 'config.toml')],
    detect: () => onPath('codex') || fs.existsSync(codexHome()),
    applied: () => /model_provider\s*=\s*"open-gravity"/.test(readText(path.join(codexHome(), 'config.toml'))),
    apply: (ctx) => {
      const file = path.join(codexHome(), 'config.toml');
      writeFileAtomic(file, updateCodexToml(readText(file), ctx));
    },
    snippet: (ctx) => ({ lang: 'toml', text: updateCodexToml('', ctx) }),
    notes: 'Or run "open-gravity codex" to launch Codex pre-configured.',
  },
  {
    id: 'opencode',
    category: 'cli',
    docs: 'https://opencode.ai/docs/providers/',
    name: 'OpenCode',
    description: 'Open-source terminal coding agent.',
    files: () => [path.join(home(), '.config', 'opencode', 'opencode.json')],
    detect: () => onPath('opencode') || fs.existsSync(path.join(home(), '.config', 'opencode')),
    applied: () => !!readJson(path.join(home(), '.config', 'opencode', 'opencode.json'))?.provider?.['open-gravity'],
    apply: (ctx) => {
      const file = path.join(home(), '.config', 'opencode', 'opencode.json');
      const cfg = readJson(file);
      cfg.$schema ||= 'https://opencode.ai/config.json';
      cfg.provider = { ...(cfg.provider || {}), 'open-gravity': opencodeProvider(ctx) };
      cfg.model = `open-gravity/${ctx.model}`;
      cfg.small_model = `open-gravity/${ctx.smallModel}`;
      writeJson(file, cfg);
    },
    snippet: (ctx) => ({
      lang: 'json',
      text: JSON.stringify({ $schema: 'https://opencode.ai/config.json', provider: { 'open-gravity': opencodeProvider(ctx) }, model: `open-gravity/${ctx.model}` }, null, 2),
    }),
  },
  {
    id: 'gemini-cli',
    category: 'cli',
    docs: 'https://github.com/google-gemini/gemini-cli',
    name: 'Gemini CLI',
    description: 'Google\'s terminal agent, via the Gemini generateContent endpoint.',
    files: () => [path.join(home(), '.gemini', '.env'), path.join(home(), '.gemini', 'settings.json')],
    detect: () => onPath('gemini'),
    applied: (ctx) => readText(path.join(home(), '.gemini', '.env')).includes(`GOOGLE_GEMINI_BASE_URL=${ctx.baseUrl}`),
    apply: (ctx) => {
      setDotenv(path.join(home(), '.gemini', '.env'), {
        GOOGLE_GEMINI_BASE_URL: ctx.baseUrl,
        GEMINI_API_KEY: ctx.apiKey || 'open-gravity',
        GEMINI_MODEL: ctx.model,
      });
      // Select API-key auth so Gemini CLI doesn't ask for a Google login.
      const settingsFile = path.join(home(), '.gemini', 'settings.json');
      const raw = readText(settingsFile);
      const settings = raw ? readJson(settingsFile) : {};
      if (!raw || Object.keys(settings).length) {
        settings.security = { ...(settings.security || {}), auth: { ...(settings.security?.auth || {}), selectedType: 'gemini-api-key' } };
        writeJson(settingsFile, settings);
      }
    },
    snippet: (ctx) => ({ lang: 'bash', text: `# ~/.gemini/.env\nGOOGLE_GEMINI_BASE_URL=${ctx.baseUrl}\nGEMINI_API_KEY=${ctx.apiKey || 'open-gravity'}\nGEMINI_MODEL=${ctx.model}` }),
    notes: 'The automatic setup also selects API-key authentication. For manual setup, choose "Use Gemini API key" when Gemini CLI asks how to authenticate.',
  },
  {
    id: 'qwen-code',
    category: 'cli',
    docs: 'https://github.com/QwenLM/qwen-code',
    name: 'Qwen Code',
    description: 'Qwen\'s terminal agent (OpenAI-compatible mode).',
    files: () => [path.join(home(), '.qwen', '.env')],
    detect: () => onPath('qwen'),
    applied: (ctx) => readText(path.join(home(), '.qwen', '.env')).includes(`OPENAI_BASE_URL=${ctx.baseUrl}/v1`),
    apply: (ctx) => setDotenv(path.join(home(), '.qwen', '.env'), { OPENAI_BASE_URL: `${ctx.baseUrl}/v1`, OPENAI_API_KEY: ctx.apiKey || 'open-gravity', OPENAI_MODEL: ctx.model }),
    snippet: (ctx) => ({ lang: 'bash', text: `# ~/.qwen/.env\nOPENAI_BASE_URL=${ctx.baseUrl}/v1\nOPENAI_API_KEY=${ctx.apiKey || 'open-gravity'}\nOPENAI_MODEL=${ctx.model}` }),
  },
  {
    id: 'aider',
    category: 'cli',
    docs: 'https://aider.chat/docs/config/aider_conf.html',
    name: 'Aider',
    description: 'AI pair programming in your terminal.',
    files: () => [path.join(home(), '.aider.conf.yml')],
    detect: () => onPath('aider'),
    applied: (ctx) => readText(path.join(home(), '.aider.conf.yml')).includes(`openai-api-base: ${ctx.baseUrl}/v1`),
    apply: (ctx) => setYamlKeys(path.join(home(), '.aider.conf.yml'), {
      'openai-api-base': `${ctx.baseUrl}/v1`,
      'openai-api-key': ctx.apiKey || 'open-gravity',
      model: `openai/${ctx.model}`,
      'weak-model': `openai/${ctx.smallModel}`,
    }),
    snippet: (ctx) => ({ lang: 'yaml', text: `# ~/.aider.conf.yml\nopenai-api-base: ${ctx.baseUrl}/v1\nopenai-api-key: ${ctx.apiKey || 'open-gravity'}\nmodel: openai/${ctx.model}\nweak-model: openai/${ctx.smallModel}` }),
  },
  {
    id: 'vscode-copilot',
    category: 'ide',
    docs: 'https://code.visualstudio.com/docs/copilot/language-models',
    name: 'VS Code (GitHub Copilot Chat)',
    description: 'Copilot Chat → Manage Models → Ollama, served by the router\'s Ollama-compatible API.',
    files: () => [],
    detect: () => hasExtension('github.copilot-chat'),
    snippet: (ctx) => ({ lang: 'json', text: JSON.stringify({ 'github.copilot.chat.byok.ollamaEndpoint': ctx.baseUrl }, null, 2) }),
    notes: 'Add this to your VS Code user settings, then Copilot Chat → Manage Models → Ollama and pick any combo or provider/model. Tool calling works with every model (emulated when the model has none).',
  },
  {
    id: 'open-webui',
    category: 'chat',
    docs: 'https://docs.openwebui.com/',
    name: 'Open WebUI',
    description: 'Admin Settings → Connections: use the router as an Ollama or OpenAI connection.',
    files: () => [],
    detect: () => false,
    snippet: (ctx) => ({
      lang: 'text',
      text: `Ollama API:   ${ctx.baseUrl.replace('127.0.0.1', 'host.docker.internal')}\nOpenAI API:   ${ctx.baseUrl.replace('127.0.0.1', 'host.docker.internal')}/v1   (key: ${ctx.apiKey || 'open-gravity'})`,
    }),
    notes: 'When Open WebUI runs in Docker, start Open Gravity with --host 0.0.0.0 and create an API key.',
  },
  {
    id: 'cline',
    name: 'Cline',
    category: 'ide',
    docs: 'https://docs.cline.bot/provider-config/openai-compatible',
    description: 'Autonomous coding agent for VS Code. Settings → API Provider.',
    files: () => [],
    detect: () => hasExtension('saoudrizwan.claude-dev'),
    snippet: (ctx) => ({ lang: 'text', text: `API Provider:  OpenAI Compatible\nBase URL:      ${ctx.baseUrl}/v1\nAPI Key:       ${key(ctx)}\nModel ID:      ${ctx.model}\n\nor API Provider: Anthropic, "Use custom base URL" = ${ctx.baseUrl}` }),
  },
  {
    id: 'roo-code',
    name: 'Roo Code',
    category: 'ide',
    docs: 'https://docs.roocode.com/providers/openai-compatible',
    description: 'Agentic coding in VS Code. Settings → Providers.',
    files: () => [],
    detect: () => hasExtension('rooveterinaryinc.roo-cline'),
    snippet: (ctx) => ({ lang: 'text', text: `API Provider:  OpenAI Compatible\nBase URL:      ${ctx.baseUrl}/v1\nAPI Key:       ${key(ctx)}\nModel:         ${ctx.model}` }),
  },
  {
    id: 'kilo-code',
    name: 'Kilo Code',
    category: 'ide',
    docs: 'https://kilocode.ai/docs/providers/openai-compatible',
    description: 'Open-source coding agent for VS Code and JetBrains.',
    files: () => [],
    detect: () => hasExtension('kilocode.kilo-code'),
    snippet: (ctx) => ({ lang: 'text', text: `API Provider:  OpenAI Compatible\nBase URL:      ${ctx.baseUrl}/v1\nAPI Key:       ${key(ctx)}\nModel:         ${ctx.model}` }),
  },
  {
    id: 'twinny',
    name: 'Twinny (autocomplete)',
    category: 'ide',
    docs: 'https://twinny.dev/',
    description: 'Tab autocomplete (FIM) and chat for VS Code.',
    files: () => [],
    detect: () => hasExtension('rjmacarthy.twinny'),
    snippet: (ctx) => {
      const u = new URL(ctx.baseUrl);
      return { lang: 'text', text: `FIM provider (autocomplete)\n  Type:      openai-compatible\n  Hostname:  ${u.hostname}\n  Port:      ${u.port || 80}\n  Path:      /v1/completions\n  Model:     ${ctx.model}\n  API key:   ${key(ctx)}\n\nChat provider\n  Type:      openai-compatible\n  Path:      /v1/chat/completions` };
    },
    notes: 'Autocomplete uses the native completion endpoint of Mistral/Codestral, DeepSeek, Ollama and llama.cpp when available, otherwise any chat model.',
  },
  {
    id: 'jetbrains',
    name: 'JetBrains AI Assistant',
    category: 'ide',
    docs: 'https://www.jetbrains.com/help/ai-assistant/use-custom-models.html',
    description: 'IntelliJ IDEA, PyCharm, WebStorm, GoLand, Rider… Settings → Tools → AI Assistant → Models.',
    files: () => [],
    detect: () => anyExists(path.join(xdgConfig(), 'JetBrains'), path.join(appData(), 'JetBrains'), path.join(home(), 'Library', 'Application Support', 'JetBrains')),
    snippet: (ctx) => ({ lang: 'text', text: `Third-party AI providers\n  Ollama:              ${ctx.baseUrl}\n  or OpenAI-compatible: ${ctx.baseUrl}/v1   (API key: ${key(ctx)})\n\nThen pick "${ctx.model}" (or any combo) for chat and code completion.` }),
    notes: 'The router answers as an Ollama server, so every configured model shows up in the model list.',
  },
  {
    id: 'xcode',
    name: 'Xcode (Intelligence)',
    category: 'ide',
    docs: 'https://developer.apple.com/documentation/xcode/setting-up-coding-intelligence',
    description: 'Xcode 26: Settings → Intelligence → Add a Model Provider.',
    files: () => [],
    detect: () => anyExists('/Applications/Xcode.app', '/Applications/Xcode-beta.app'),
    snippet: (ctx) => ({ lang: 'text', text: `Locally hosted\n  Port:   ${new URL(ctx.baseUrl).port || 18080}\n\nor Internet hosted\n  URL:          ${ctx.baseUrl}\n  API key:      Bearer ${key(ctx)}\n  Header:       Authorization` }),
  },
  {
    id: 'android-studio',
    name: 'Android Studio (Gemini)',
    category: 'ide',
    docs: 'https://developer.android.com/studio/gemini/use-a-local-model',
    description: 'Settings → Tools → AI → Model Providers → add a local provider.',
    files: () => [],
    detect: () => anyExists('/Applications/Android Studio.app', path.join(xdgConfig(), 'Google'), path.join(appData(), 'Google')),
    snippet: (ctx) => ({ lang: 'text', text: `Provider:  Ollama (or OpenAI-compatible)\nURL:       ${ctx.baseUrl}\nModel:     ${ctx.model}` }),
  },
  {
    id: 'void',
    name: 'Void',
    category: 'ide',
    docs: 'https://voideditor.com/',
    description: 'Open-source AI editor. Void Settings → Models → OpenAI-Compatible.',
    files: () => [],
    detect: () => anyExists(path.join(home(), '.void-editor'), path.join(appData(), 'Void')),
    snippet: (ctx) => ({ lang: 'text', text: `OpenAI-Compatible\n  Endpoint:  ${ctx.baseUrl}/v1\n  API key:   ${key(ctx)}\n  Models:    ${ctx.model}` }),
  },
  {
    id: 'avante',
    name: 'Neovim (avante.nvim)',
    category: 'ide',
    docs: 'https://github.com/yetone/avante.nvim',
    description: 'Cursor-like AI in Neovim.',
    files: () => [],
    detect: () => anyExists(path.join(xdgConfig(), 'nvim')),
    snippet: (ctx) => ({
      lang: 'lua',
      text: `require('avante').setup({\n  provider = 'opengravity',\n  providers = {\n    opengravity = {\n      __inherited_from = 'openai',\n      endpoint = '${ctx.baseUrl}/v1',\n      api_key_name = 'OPEN_GRAVITY_API_KEY', -- export OPEN_GRAVITY_API_KEY=${key(ctx)}\n      model = '${ctx.model}',\n    },\n  },\n})`,
    }),
  },
  {
    id: 'codecompanion',
    name: 'Neovim (CodeCompanion)',
    category: 'ide',
    docs: 'https://codecompanion.olimorris.dev/',
    description: 'AI coding plugin for Neovim.',
    files: () => [],
    detect: () => false,
    snippet: (ctx) => ({
      lang: 'lua',
      text: `require('codecompanion').setup({\n  adapters = {\n    opengravity = function()\n      return require('codecompanion.adapters').extend('openai_compatible', {\n        env = { url = '${ctx.baseUrl}', api_key = '${key(ctx)}' },\n        schema = { model = { default = '${ctx.model}' } },\n      })\n    end,\n  },\n  strategies = { chat = { adapter = 'opengravity' }, inline = { adapter = 'opengravity' } },\n})`,
    }),
  },
  {
    id: 'gptel',
    name: 'Emacs (gptel)',
    category: 'ide',
    docs: 'https://github.com/karthink/gptel',
    description: 'LLM client for Emacs.',
    files: () => [],
    detect: () => anyExists(path.join(home(), '.emacs.d'), path.join(xdgConfig(), 'emacs')),
    snippet: (ctx) => {
      const u = new URL(ctx.baseUrl);
      return { lang: 'lisp', text: `(setq gptel-backend\n      (gptel-make-openai "Open Gravity"\n        :host "${u.host}"\n        :protocol "${u.protocol.replace(':', '')}"\n        :endpoint "/v1/chat/completions"\n        :stream t\n        :key "${key(ctx)}"\n        :models '(${ctx.model})))` };
    },
  },
  {
    id: 'crush',
    name: 'Crush',
    category: 'cli',
    docs: 'https://github.com/charmbracelet/crush',
    description: 'Charm\'s terminal coding agent (~/.config/crush/crush.json).',
    files: () => [],
    detect: () => onPath('crush'),
    snippet: (ctx) => ({
      lang: 'json',
      text: JSON.stringify({
        $schema: 'https://charm.land/crush.json',
        providers: { 'open-gravity': { type: 'openai', base_url: `${ctx.baseUrl}/v1`, api_key: key(ctx), models: [{ id: ctx.model, name: ctx.model, context_window: 200000, default_max_tokens: 32000 }] } },
      }, null, 2),
    }),
  },
  {
    id: 'goose',
    name: 'Goose',
    category: 'cli',
    docs: 'https://block.github.io/goose/docs/getting-started/providers',
    description: 'Block\'s open-source agent (OpenAI provider with a custom host).',
    files: () => [],
    detect: () => onPath('goose'),
    snippet: (ctx) => ({ lang: 'bash', text: `export GOOSE_PROVIDER=openai\nexport OPENAI_HOST=${ctx.baseUrl}\nexport OPENAI_BASE_PATH=v1/chat/completions\nexport OPENAI_API_KEY=${key(ctx)}\nexport GOOSE_MODEL=${ctx.model}\ngoose session` }),
  },
  {
    id: 'droid',
    name: 'Factory Droid',
    category: 'cli',
    docs: 'https://docs.factory.ai/cli/byok/overview',
    description: 'Factory\'s CLI agent: bring your own model in ~/.factory/config.json.',
    files: () => [],
    detect: () => onPath('droid') || anyExists(path.join(home(), '.factory')),
    snippet: (ctx) => ({
      lang: 'json',
      text: JSON.stringify({ custom_models: [{ model_display_name: `Open Gravity ${ctx.model}`, model: ctx.model, base_url: `${ctx.baseUrl}/v1`, api_key: key(ctx), provider: 'generic-chat-completion-api', max_tokens: 16384 }] }, null, 2),
    }),
  },
  {
    id: 'openhands',
    name: 'OpenHands',
    category: 'cli',
    docs: 'https://docs.all-hands.dev/usage/llms/openai-llms',
    description: 'Settings → LLM → Advanced.',
    files: () => [],
    detect: () => false,
    snippet: (ctx) => ({ lang: 'text', text: `Custom Model:  openai/${ctx.model}\nBase URL:      ${ctx.baseUrl.replace('127.0.0.1', 'host.docker.internal')}/v1\nAPI Key:       ${key(ctx)}` }),
    notes: 'OpenHands runs in Docker: start Open Gravity with --host 0.0.0.0 and create an API key.',
  },
  {
    id: 'llm-cli',
    name: 'llm (Simon Willison)',
    category: 'cli',
    docs: 'https://llm.datasette.io/en/stable/other-models.html#openai-compatible-models',
    description: 'Add the router to extra-openai-models.yaml.',
    files: () => [],
    detect: () => onPath('llm'),
    snippet: (ctx) => ({ lang: 'yaml', text: `# $(dirname "$(llm logs path)")/extra-openai-models.yaml\n- model_id: og\n  model_name: ${ctx.model}\n  api_base: "${ctx.baseUrl}/v1"\n  api_key_name: open-gravity   # llm keys set open-gravity` }),
  },
  {
    id: 'lobechat',
    name: 'LobeChat',
    category: 'chat',
    docs: 'https://lobehub.com/docs/usage/providers/openai',
    description: 'Settings → AI Service Provider → OpenAI → API proxy address.',
    files: () => [],
    detect: () => false,
    snippet: (ctx) => ({ lang: 'text', text: `API Key:              ${key(ctx)}\nAPI proxy address:    ${ctx.baseUrl}/v1\nModel list:           fetch, or type ${ctx.model}` }),
  },
  {
    id: 'cherry-studio',
    name: 'Cherry Studio',
    category: 'chat',
    docs: 'https://docs.cherry-ai.com/',
    description: 'Settings → Model Provider → Add (type OpenAI).',
    files: () => [],
    detect: () => anyExists(path.join(appData(), 'CherryStudio'), path.join(home(), 'Library', 'Application Support', 'CherryStudio')),
    snippet: (ctx) => ({ lang: 'text', text: `Provider type:  OpenAI\nAPI Host:       ${ctx.baseUrl}\nAPI Key:        ${key(ctx)}\nModels:         Manage → fetch` }),
  },
  {
    id: 'chatbox',
    name: 'Chatbox',
    category: 'chat',
    docs: 'https://chatboxai.app/',
    description: 'Settings → Model Provider → Add custom provider (OpenAI API compatible).',
    files: () => [],
    detect: () => false,
    snippet: (ctx) => ({ lang: 'text', text: `API Mode:   OpenAI API Compatible\nAPI Host:   ${ctx.baseUrl}\nAPI Path:   /v1/chat/completions\nAPI Key:    ${key(ctx)}\nModel:      ${ctx.model}` }),
  },
  {
    id: 'anythingllm',
    name: 'AnythingLLM',
    category: 'chat',
    docs: 'https://docs.anythingllm.com/',
    description: 'Settings → LLM Preference → Generic OpenAI.',
    files: () => [],
    detect: () => false,
    snippet: (ctx) => ({ lang: 'text', text: `Base URL:        ${ctx.baseUrl}/v1\nAPI Key:         ${key(ctx)}\nChat Model:      ${ctx.model}\nContext window:  128000` }),
  },
  {
    id: 'librechat',
    name: 'LibreChat',
    category: 'chat',
    docs: 'https://www.librechat.ai/docs/configuration/librechat_yaml/object_structure/custom_endpoint',
    description: 'Add a custom endpoint in librechat.yaml.',
    files: () => [],
    detect: () => false,
    snippet: (ctx) => ({ lang: 'yaml', text: `endpoints:\n  custom:\n    - name: "Open Gravity"\n      apiKey: "${key(ctx)}"\n      baseURL: "${ctx.baseUrl.replace('127.0.0.1', 'host.docker.internal')}/v1"\n      models:\n        default: ["${ctx.model}"]\n        fetch: true\n      titleConvo: true\n      modelDisplayLabel: "Open Gravity"` }),
  },
  {
    id: 'sillytavern',
    name: 'SillyTavern',
    category: 'chat',
    docs: 'https://docs.sillytavern.app/',
    description: 'API Connections → Chat Completion → Custom (OpenAI-compatible).',
    files: () => [],
    detect: () => false,
    snippet: (ctx) => ({ lang: 'text', text: `Chat Completion Source:  Custom (OpenAI-compatible)\nCustom Endpoint:         ${ctx.baseUrl}/v1\nAPI Key:                 ${key(ctx)}\nModel:                   ${ctx.model}` }),
  },
  {
    id: 'msty-jan',
    name: 'Msty / Jan / other desktop chat apps',
    category: 'chat',
    description: 'Add a remote provider of type "OpenAI compatible" (or "Ollama").',
    files: () => [],
    detect: () => false,
    snippet: (ctx) => ({ lang: 'text', text: `OpenAI compatible:  ${ctx.baseUrl}/v1   key: ${key(ctx)}\nOllama:             ${ctx.baseUrl}` }),
  },
  {
    id: 'n8n',
    name: 'n8n',
    category: 'framework',
    docs: 'https://docs.n8n.io/integrations/builtin/credentials/openai/',
    description: 'OpenAI credentials with a custom Base URL, then any OpenAI / AI Agent node.',
    files: () => [],
    detect: () => false,
    snippet: (ctx) => ({ lang: 'text', text: `Credential type:  OpenAI\nAPI Key:          ${key(ctx)}\nBase URL:         ${ctx.baseUrl.replace('127.0.0.1', 'host.docker.internal')}/v1\nModel:            ${ctx.model} (By ID)` }),
  },
  {
    id: 'langchain',
    name: 'LangChain / LangGraph',
    category: 'framework',
    docs: 'https://python.langchain.com/docs/integrations/chat/openai/',
    description: 'ChatOpenAI or ChatAnthropic with a base URL.',
    files: () => [],
    detect: () => false,
    snippet: (ctx) => ({ lang: 'python', text: `from langchain_openai import ChatOpenAI\n\nllm = ChatOpenAI(model="${ctx.model}", base_url="${ctx.baseUrl}/v1", api_key="${key(ctx)}")\n\n# or: from langchain_anthropic import ChatAnthropic\n# ChatAnthropic(model="${ctx.model}", base_url="${ctx.baseUrl}", api_key="${key(ctx)}")` }),
  },
  {
    id: 'llamaindex',
    name: 'LlamaIndex',
    category: 'framework',
    docs: 'https://docs.llamaindex.ai/en/stable/api_reference/llms/openai_like/',
    description: 'OpenAILike LLM pointed at the router.',
    files: () => [],
    detect: () => false,
    snippet: (ctx) => ({ lang: 'python', text: `from llama_index.llms.openai_like import OpenAILike\n\nllm = OpenAILike(model="${ctx.model}", api_base="${ctx.baseUrl}/v1", api_key="${key(ctx)}", is_chat_model=True, is_function_calling_model=True)` }),
  },
  {
    id: 'ai-sdk',
    name: 'Vercel AI SDK',
    category: 'framework',
    docs: 'https://ai-sdk.dev/providers/openai-compatible-providers',
    description: 'createOpenAICompatible (or the Anthropic provider with a baseURL).',
    files: () => [],
    detect: () => false,
    snippet: (ctx) => ({ lang: 'ts', text: `import { createOpenAICompatible } from '@ai-sdk/openai-compatible';\nimport { generateText } from 'ai';\n\nconst og = createOpenAICompatible({ name: 'open-gravity', baseURL: '${ctx.baseUrl}/v1', apiKey: '${key(ctx)}' });\nconst { text } = await generateText({ model: og('${ctx.model}'), prompt: 'Hello' });` }),
  },
  {
    id: 'litellm-sdk',
    name: 'LiteLLM (SDK)',
    category: 'framework',
    docs: 'https://docs.litellm.ai/docs/providers/openai_compatible',
    description: 'Use the openai/ prefix with api_base.',
    files: () => [],
    detect: () => false,
    snippet: (ctx) => ({ lang: 'python', text: `import litellm\n\nresp = litellm.completion(model="openai/${ctx.model}", api_base="${ctx.baseUrl}/v1", api_key="${key(ctx)}",\n                          messages=[{"role": "user", "content": "Hello"}])` }),
  },
  {
    id: 'continue',
    category: 'ide',
    docs: 'https://docs.continue.dev/reference',
    name: 'Continue',
    description: 'Open-source IDE assistant for VS Code and JetBrains (chat, edit and tab autocomplete).',
    files: () => [],
    detect: () => hasExtension('continue.continue') || anyExists(path.join(home(), '.continue')),
    snippet: (ctx) => ({
      lang: 'yaml',
      text: `# ~/.continue/config.yaml\nmodels:\n  - name: Open Gravity\n    provider: openai\n    model: ${ctx.model}\n    apiBase: ${ctx.baseUrl}/v1\n    apiKey: ${key(ctx)}\n    roles: [chat, edit, apply]\n  - name: Open Gravity autocomplete\n    provider: openai\n    model: ${ctx.smallModel}\n    apiBase: ${ctx.baseUrl}/v1\n    apiKey: ${key(ctx)}\n    roles: [autocomplete]`,
    }),
  },
  {
    id: 'cursor',
    category: 'ide',
    docs: 'https://docs.cursor.com/settings/api-keys',
    name: 'Cursor',
    description: 'Settings → Models → OpenAI API Key → Override OpenAI Base URL.',
    files: () => [],
    detect: () => anyExists(path.join(home(), '.cursor')),
    snippet: (ctx) => ({ lang: 'text', text: `OpenAI API Key:        ${ctx.apiKey || 'open-gravity'}\nOverride Base URL:     <public URL>/v1\nCustom model name:     ${ctx.model}` }),
    notes: 'Cursor calls custom endpoints from its own servers, so localhost is not reachable: expose the router with a tunnel (e.g. cloudflared) and create an API key first.',
  },
  {
    id: 'zed',
    category: 'ide',
    docs: 'https://zed.dev/docs/ai/llm-providers',
    name: 'Zed',
    description: 'Add an OpenAI-compatible provider in settings.json.',
    files: () => [],
    detect: () => anyExists(path.join(xdgConfig(), 'zed'), path.join(appData(), 'Zed'), path.join(home(), 'Library', 'Application Support', 'Zed')),
    snippet: (ctx) => ({
      lang: 'json',
      text: JSON.stringify({ language_models: { openai_compatible: { 'Open Gravity': { api_url: `${ctx.baseUrl}/v1`, available_models: [{ name: ctx.model, max_tokens: 200000 }] } } } }, null, 2),
    }),
  },
  {
    id: 'sdk',
    category: 'framework',
    name: 'Any OpenAI / Anthropic SDK',
    description: 'Point any client library at the router.',
    files: () => [],
    detect: () => false,
    snippet: (ctx) => ({
      lang: 'bash',
      text: `curl ${ctx.baseUrl}/v1/chat/completions \\\n  -H "Authorization: Bearer ${ctx.apiKey || 'open-gravity'}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"model": "${ctx.model}", "messages": [{"role": "user", "content": "Hello"}]}'\n\n# OpenAI SDK:    base_url="${ctx.baseUrl}/v1"\n# Anthropic SDK: base_url="${ctx.baseUrl}"\n# Gemini SDK:    http_options={"base_url": "${ctx.baseUrl}"}`,
    }),
  },
];

function opencodeProvider(ctx: ToolContext) {
  const models: Record<string, { name: string }> = {};
  for (const m of [ctx.model, ctx.smallModel, ...ctx.models].slice(0, 60)) if (m) models[m] = { name: m };
  return { npm: '@ai-sdk/openai-compatible', name: 'Open Gravity', options: { baseURL: `${ctx.baseUrl}/v1`, apiKey: ctx.apiKey || 'open-gravity' }, models };
}

// ---- backups

function backupRoot(toolId: string) {
  return path.join(dataDir(), 'backups', toolId);
}

function latestBackup(toolId: string): string | null {
  const root = backupRoot(toolId);
  if (!fs.existsSync(root)) return null;
  const dirs = fs.readdirSync(root).filter((d) => fs.existsSync(path.join(root, d, 'manifest.json'))).sort();
  return dirs.length ? path.join(root, dirs[dirs.length - 1]) : null;
}

function backup(tool: ToolDef) {
  const dir = path.join(backupRoot(tool.id), new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(dir, { recursive: true });
  const manifest = tool.files().map((file, i) => {
    const existed = fs.existsSync(file);
    if (existed) fs.copyFileSync(file, path.join(dir, `file-${i}`));
    return { file, existed, copy: `file-${i}` };
  });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
}

export function listTools(ctx: ToolContext): ToolInfo[] {
  return TOOLS.map((t) => {
    const s = t.snippet(ctx);
    let applied = false;
    try { applied = !!t.applied?.(ctx); } catch { /* ignore */ }
    return {
      id: t.id, name: t.name, category: t.category, docs: t.docs, description: t.description, detected: t.detect(), canApply: !!t.apply, applied,
      files: t.files(), snippet: s.text, snippetLang: s.lang, notes: t.notes, hasBackup: !!latestBackup(t.id),
    };
  });
}

export function applyTool(id: string, ctx: ToolContext): { files: string[] } {
  const tool = TOOLS.find((t) => t.id === id);
  if (!tool?.apply) throw new Error(`Tool "${id}" cannot be configured automatically`);
  backup(tool);
  tool.apply(ctx);
  return { files: tool.files() };
}

export function restoreTool(id: string): { files: string[] } {
  const dir = latestBackup(id);
  if (!dir) throw new Error('No backup found for this tool');
  const manifest: Array<{ file: string; existed: boolean; copy: string }> = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  for (const m of manifest) {
    if (m.existed) {
      fs.mkdirSync(path.dirname(m.file), { recursive: true });
      fs.copyFileSync(path.join(dir, m.copy), m.file);
    } else if (fs.existsSync(m.file)) fs.unlinkSync(m.file);
  }
  fs.rmSync(dir, { recursive: true, force: true });
  return { files: manifest.map((m) => m.file) };
}
