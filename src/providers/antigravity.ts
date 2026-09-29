// Bridge to a locally running Google Antigravity desktop app (legacy Open
// Gravity 1.x engine). Discovers the language server process, reads account
// and model info over its local Connect-RPC API and generates text through the
// bundled `agentapi` CLI. Text-only: tool calls are flattened into the prompt.
import https from 'https';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile, spawn } from 'child_process';
import type { IRRequest, IREvent } from '../translate';
import { toolResultText } from '../translate';
import { logger } from '../core/logger';

interface Instance { pid: number; csrfToken: string; port: number }

let cached: { at: number; inst: Instance | null } = { at: 0, inst: null };

function run(file: string, args: string[], timeout = 8000): Promise<string> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => resolve(err ? '' : String(stdout)));
  });
}

function testPort(port: number, csrf: string): Promise<boolean> {
  return new Promise((resolve) => {
    const req = https.request({
      hostname: '127.0.0.1', port, path: '/healthz', method: 'GET', rejectUnauthorized: false, timeout: 1500,
      headers: { 'x-codeium-csrf-token': csrf },
    }, (res) => { res.resume(); resolve(res.statusCode === 200); });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
}

async function discoverUncached(): Promise<Instance | null> {
  const candidates: Array<{ pid: number; cmd: string }> = [];
  if (process.platform === 'win32') {
    const out = await run('powershell.exe', ['-NoProfile', '-Command',
      "Get-CimInstance Win32_Process | Where-Object { $_.Name -like '*language_server*' } | Select-Object ProcessId, CommandLine | ConvertTo-Json"]);
    try {
      const parsed = JSON.parse(out || '[]');
      for (const it of Array.isArray(parsed) ? parsed : [parsed]) if (it?.ProcessId && it.CommandLine) candidates.push({ pid: it.ProcessId, cmd: it.CommandLine });
    } catch { /* none */ }
  } else {
    const out = await run('ps', ['-eo', 'pid=,args=']);
    for (const line of out.split('\n')) {
      if (!line.includes('language_server') || !line.includes('csrf_token')) continue;
      const m = /^\s*(\d+)\s+(.*)$/.exec(line);
      if (m) candidates.push({ pid: parseInt(m[1], 10), cmd: m[2] });
    }
  }

  for (const c of candidates) {
    const csrf = /--csrf_token[= ]([a-zA-Z0-9-]+)/.exec(c.cmd)?.[1];
    if (!csrf) continue;
    let ports: number[] = [];
    if (process.platform === 'win32') {
      const out = await run('powershell.exe', ['-NoProfile', '-Command',
        `Get-NetTCPConnection -OwningProcess ${c.pid} -State Listen | Select-Object LocalPort | ConvertTo-Json`]);
      try {
        const parsed = JSON.parse(out || '[]');
        ports = (Array.isArray(parsed) ? parsed : [parsed]).map((p: any) => p?.LocalPort).filter(Boolean);
      } catch { /* none */ }
    } else {
      const out = await run('lsof', ['-Pan', '-p', String(c.pid), '-iTCP', '-sTCP:LISTEN']);
      ports = [...out.matchAll(/:(\d+)\s+\(LISTEN\)/g)].map((m) => parseInt(m[1], 10));
    }
    for (const port of ports) {
      if (await testPort(port, csrf)) return { pid: c.pid, csrfToken: csrf, port };
    }
  }
  return null;
}

export async function discoverAntigravity(force = false): Promise<Instance | null> {
  if (!force && Date.now() - cached.at < 10_000) return cached.inst;
  try {
    cached = { at: Date.now(), inst: await discoverUncached() };
  } catch (e: any) {
    logger.debug(`Antigravity discovery failed: ${e.message}`);
    cached = { at: Date.now(), inst: null };
  }
  return cached.inst;
}

function rpc(inst: Instance, method: string, body: any = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request({
      hostname: '127.0.0.1', port: inst.port, method: 'POST', rejectUnauthorized: false, timeout: 10_000,
      path: `/exa.language_server_pb.LanguageServerService/${method}`,
      headers: {
        'x-codeium-csrf-token': inst.csrfToken, 'Content-Type': 'application/json',
        'Connect-Protocol-Version': '1', 'Content-Length': Buffer.byteLength(payload),
      },
    }, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => {
        if ((res.statusCode || 500) >= 300) return reject(new Error(`Antigravity RPC ${method} failed (${res.statusCode})`));
        try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Antigravity RPC timeout')); });
    req.end(payload);
  });
}

export async function antigravityStatus(): Promise<{ connected: boolean; pid?: number; email?: string; plan?: string; models: string[] }> {
  const inst = await discoverAntigravity();
  if (!inst) return { connected: false, models: [] };
  try {
    const status = (await rpc(inst, 'GetUserStatus'))?.userStatus || {};
    const configs = status.cascadeModelConfigData?.clientModelConfigs || [];
    const models = configs.map((m: any) => m.modelId).filter((id: string) => id && !/^(chat_|embedding_|code_)/.test(id));
    return { connected: true, pid: inst.pid, email: status.email, plan: status.userTier?.name || status.planStatus?.planInfo?.planName, models };
  } catch {
    return { connected: true, pid: inst.pid, models: [] };
  }
}

function findAgentApi(): string | null {
  if (process.env.ANTIGRAVITY_AGENTAPI_EXE && fs.existsSync(process.env.ANTIGRAVITY_AGENTAPI_EXE)) return process.env.ANTIGRAVITY_AGENTAPI_EXE;
  const home = os.homedir();
  const candidates = [
    path.join(home, 'AppData', 'Local', 'Programs', 'antigravity', 'resources', 'bin', 'language_server.exe'),
    path.join(home, '.gemini', 'antigravity', 'bin', 'agentapi.bat'),
    '/Applications/Antigravity.app/Contents/Resources/bin/language_server',
    '/opt/antigravity/resources/bin/language_server',
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

// cmd.exe quoting for .bat/.cmd targets (same approach as cross-spawn).
const CMD_META = /([()\][%!^"`<>&|;, *?])/g;
function cmdArg(arg: string): string {
  let a = arg.replace(/(?=(\\+?)?)\1"/g, '$1$1\\"').replace(/(?=(\\+?)?)\1$/, '$1$1');
  a = `"${a}"`.replace(CMD_META, '^$1');
  return a.replace(CMD_META, '^$1');
}

function spawnAgentApi(model: string, prompt: string): Promise<string> {
  const exe = findAgentApi();
  const tier = `--model=${modelTier(model)}`;
  return new Promise((resolve, reject) => {
    let child;
    if (exe && /\.(bat|cmd)$/i.test(exe)) {
      // cmd.exe cannot carry newlines and caps the command line at 8191 chars.
      const p = prompt.replace(/[\r\n]+/g, ' ').slice(-7000);
      const line = [exe.replace(CMD_META, '^$1'), cmdArg('new-conversation'), cmdArg(tier), cmdArg(p)].join(' ');
      child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${line}"`], { windowsVerbatimArguments: true, windowsHide: true });
    } else {
      const p = prompt.slice(-30000);
      const args = ['new-conversation', tier, p];
      child = exe ? spawn(exe, exe.includes('language_server') ? ['agentapi', ...args] : args, { windowsHide: true }) : spawn('agentapi', args, { windowsHide: true });
    }
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', () => resolve(out || err));
  });
}

function modelTier(model: string): 'flash_lite' | 'flash' | 'pro' {
  const m = model.toLowerCase();
  if (/pro|opus|120b|sonnet/.test(m)) return 'pro';
  if (/lite|low|haiku|mini/.test(m)) return 'flash_lite';
  return 'flash';
}

function flatten(ir: IRRequest): string {
  let s = '';
  if (ir.system) s += `System instructions:\n${ir.system}\n\n`;
  for (const m of ir.messages) {
    const text = m.parts.map((p) => {
      if (p.type === 'text') return p.text;
      if (p.type === 'tool_call') return `[Tool call ${p.name}: ${p.args}]`;
      if (p.type === 'tool_result') return `[Tool result: ${toolResultText(p)}]`;
      return '';
    }).filter(Boolean).join('\n');
    if (text) s += `[${m.role.toUpperCase()}]\n${text}\n\n`;
  }
  return s.trim();
}

/** Run a request through the local Antigravity app, yielding IR events. */
export async function* antigravityGenerate(ir: IRRequest, model: string, signal: AbortSignal): AsyncGenerator<IREvent> {
  const inst = await discoverAntigravity();
  if (!inst) throw Object.assign(new Error('Antigravity app is not running on this machine'), { status: 503 });
  const stdout = await spawnAgentApi(model, flatten(ir));
  let convId: string | undefined;
  try { convId = JSON.parse(stdout)?.response?.newConversation?.conversationId; } catch { /* fall through */ }
  convId ||= /([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i.exec(stdout)?.[1];
  if (!convId) throw Object.assign(new Error(`Antigravity did not start a conversation: ${stdout.slice(0, 300)}`), { status: 502 });

  const transcript = path.join(os.homedir(), '.gemini', 'antigravity', 'brain', convId, '.system_generated', 'logs', 'transcript.jsonl');
  yield { type: 'start', id: convId, model };
  let sent = 0;
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline && !signal.aborted) {
    await new Promise((r) => setTimeout(r, 250));
    if (!fs.existsSync(transcript)) continue;
    let done = false;
    let full = '';
    for (const line of fs.readFileSync(transcript, 'utf8').split('\n')) {
      try {
        const step = JSON.parse(line);
        if (step.source === 'MODEL' && (step.type === 'PLANNER_RESPONSE' || step.type === 'MODEL_OUTPUT')) {
          full = step.content || '';
          if (step.status === 'DONE') done = true;
        }
      } catch { /* partial line */ }
    }
    if (full.length > sent) {
      yield { type: 'text', text: full.slice(sent) };
      sent = full.length;
    }
    if (done) break;
  }
  yield { type: 'usage', usage: { output: Math.ceil(sent / 4) } };
  yield { type: 'stop', reason: 'end_turn' };
}
