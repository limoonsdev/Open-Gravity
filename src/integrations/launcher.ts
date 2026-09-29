// Launch Claude Code / Codex pre-wired to the router, without editing their config files.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';

const isWin = process.platform === 'win32';

/** Resolve a command on PATH (honours PATHEXT on Windows) plus a few known install dirs. */
export function resolveCommand(name: string, extraDirs: string[] = []): string | null {
  const dirs = [...extraDirs, ...(process.env.PATH || '').split(path.delimiter)].filter(Boolean);
  const exts = isWin ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';').map((e) => e.toLowerCase()) : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const p = path.join(dir, name + ext);
      try {
        if (fs.statSync(p).isFile()) return p;
      } catch { /* next */ }
    }
  }
  return null;
}

const CMD_META = /([()\][%!^"`<>&|;, *?])/g;
function cmdArg(arg: string): string {
  let a = arg.replace(/(?=(\\+?)?)\1"/g, '$1$1\\"').replace(/(?=(\\+?)?)\1$/, '$1$1');
  a = `"${a}"`.replace(CMD_META, '^$1');
  return a.replace(CMD_META, '^$1');
}

export function runInteractive(file: string, args: string[], env: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = isWin && /\.(cmd|bat)$/i.test(file)
      ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${[file.replace(CMD_META, '^$1'), ...args.map(cmdArg)].join(' ')}"`], { env, stdio: 'inherit', windowsVerbatimArguments: true })
      : spawn(file, args, { env, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => resolve(code ?? 0));
  });
}

function claudeDirs(): string[] {
  const home = os.homedir();
  return [path.join(home, '.local', 'bin'), path.join(home, '.claude', 'local'), path.join(home, '.claude', 'bin')];
}

export function markClaudeOnboarded() {
  const file = path.join(os.homedir(), '.claude.json');
  try {
    const data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
    if (data.hasCompletedOnboarding) return;
    data.hasCompletedOnboarding = true;
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  } catch { /* leave the file alone if it is not valid JSON */ }
}

export async function launchClaude(baseUrl: string, apiKey: string, args: string[], model?: string): Promise<number> {
  const exe = resolveCommand('claude', claudeDirs());
  if (!exe) throw new Error('Claude Code is not installed. Install it with: npm install -g @anthropic-ai/claude-code');
  markClaudeOnboarded();
  const env: NodeJS.ProcessEnv = { ...process.env, ANTHROPIC_BASE_URL: baseUrl, ANTHROPIC_AUTH_TOKEN: apiKey || 'open-gravity', API_TIMEOUT_MS: '3000000' };
  delete env.ANTHROPIC_API_KEY;
  if (model) {
    env.ANTHROPIC_MODEL = model;
    env.ANTHROPIC_DEFAULT_OPUS_MODEL = model;
    env.ANTHROPIC_DEFAULT_SONNET_MODEL = model;
  }
  return runInteractive(exe, args, env);
}

export async function launchCodex(baseUrl: string, apiKey: string, args: string[], model?: string): Promise<number> {
  const exe = resolveCommand('codex');
  if (!exe) throw new Error('Codex CLI is not installed. Install it with: npm install -g @openai/codex');
  const provider = `model_providers.open-gravity={name="Open Gravity",base_url=${JSON.stringify(`${baseUrl}/v1`)},wire_api="responses"${apiKey ? `,experimental_bearer_token=${JSON.stringify(apiKey)}` : ''}}`;
  const pre = ['-c', provider, '-c', 'model_provider="open-gravity"'];
  if (model) pre.push('-c', `model=${JSON.stringify(model)}`);
  return runInteractive(exe, [...pre, ...args], { ...process.env });
}
