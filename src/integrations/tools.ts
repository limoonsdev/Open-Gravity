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

export interface ToolInfo {
  id: string;
  name: string;
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
    id: 'claude-code',
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
    name: 'Gemini CLI',
    description: 'Google\'s terminal agent, via the Gemini generateContent endpoint.',
    files: () => [path.join(home(), '.gemini', '.env')],
    detect: () => onPath('gemini'),
    applied: (ctx) => readText(path.join(home(), '.gemini', '.env')).includes(`GOOGLE_GEMINI_BASE_URL=${ctx.baseUrl}`),
    apply: (ctx) => {
      setDotenv(path.join(home(), '.gemini', '.env'), {
        GOOGLE_GEMINI_BASE_URL: ctx.baseUrl,
        GEMINI_API_KEY: ctx.apiKey || 'open-gravity',
        GEMINI_MODEL: ctx.model,
      });
    },
    snippet: (ctx) => ({ lang: 'bash', text: `# ~/.gemini/.env\nGOOGLE_GEMINI_BASE_URL=${ctx.baseUrl}\nGEMINI_API_KEY=${ctx.apiKey || 'open-gravity'}\nGEMINI_MODEL=${ctx.model}` }),
    notes: 'Choose "Use Gemini API key" when Gemini CLI asks how to authenticate.',
  },
  {
    id: 'qwen-code',
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
    id: 'cline',
    name: 'Cline / Roo Code / Kilo Code',
    description: 'VS Code agents. Configure in the extension settings.',
    files: () => [],
    detect: () => false,
    snippet: (ctx) => ({
      lang: 'text',
      text: `API Provider:  OpenAI Compatible\nBase URL:      ${ctx.baseUrl}/v1\nAPI Key:       ${ctx.apiKey || 'open-gravity'}\nModel ID:      ${ctx.model}\n\n(or API Provider: Anthropic, with "Use custom base URL" = ${ctx.baseUrl})`,
    }),
  },
  {
    id: 'continue',
    name: 'Continue',
    description: 'Open-source IDE assistant (config.yaml).',
    files: () => [],
    detect: () => false,
    snippet: (ctx) => ({
      lang: 'yaml',
      text: `models:\n  - name: Open Gravity\n    provider: openai\n    model: ${ctx.model}\n    apiBase: ${ctx.baseUrl}/v1\n    apiKey: ${ctx.apiKey || 'open-gravity'}\n    roles: [chat, edit, apply]`,
    }),
  },
  {
    id: 'cursor',
    name: 'Cursor',
    description: 'Settings → Models → OpenAI API Key → Override OpenAI Base URL.',
    files: () => [],
    detect: () => false,
    snippet: (ctx) => ({ lang: 'text', text: `OpenAI API Key:        ${ctx.apiKey || 'open-gravity'}\nOverride Base URL:     <public URL>/v1\nCustom model name:     ${ctx.model}` }),
    notes: 'Cursor calls custom endpoints from its own servers, so localhost is not reachable: expose the router with a tunnel (e.g. cloudflared) and create an API key first.',
  },
  {
    id: 'zed',
    name: 'Zed',
    description: 'Add an OpenAI-compatible provider in settings.json.',
    files: () => [],
    detect: () => false,
    snippet: (ctx) => ({
      lang: 'json',
      text: JSON.stringify({ language_models: { openai_compatible: { 'Open Gravity': { api_url: `${ctx.baseUrl}/v1`, available_models: [{ name: ctx.model, max_tokens: 200000 }] } } } }, null, 2),
    }),
  },
  {
    id: 'sdk',
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
      id: t.id, name: t.name, description: t.description, detected: t.detect(), canApply: !!t.apply, applied,
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
