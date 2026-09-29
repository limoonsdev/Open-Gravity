// Open Gravity CLI entry point.
import readline from 'readline';
import { c, logger } from './core/logger';
import { ConfigStore } from './core/config';
import { VERSION, randomId, randomKey, maskKey } from './core/util';
import { startApp, openBrowser, probeExisting, baseUrlFor, RunningApp } from './app';
import { banner, startTui } from './cli/tui';
import { effectiveDefault, listRoutableModels } from './router/resolve';
import { probeProvider } from './router/probe';
import { launchClaude, launchCodex } from './integrations/launcher';
import { applyTool, listTools } from './integrations/tools';

interface Parsed {
  cmd: string;
  args: string[];
  flags: Record<string, string | boolean>;
}

const PASSTHROUGH_CMDS = new Set(['claude', 'codex']);

function parseArgs(argv: string[]): Parsed {
  const flags: Record<string, string | boolean> = {};
  const args: string[] = [];
  let cmd = '';
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (cmd && PASSTHROUGH_CMDS.has(cmd)) {
      // Everything after `claude`/`codex` goes to the launched tool, except our own --model.
      if (a === '--og-model') flags.model = argv[++i];
      else args.push(a);
      continue;
    }
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=', 2);
      if (v !== undefined) flags[k] = v;
      else if (argv[i + 1] && !argv[i + 1].startsWith('-') && !['no-open', 'help', 'version', 'json', 'desktop'].includes(k)) flags[k] = argv[++i];
      else flags[k] = true;
    } else if (a === '-p') flags.port = argv[++i];
    else if (a === '-h') flags.help = true;
    else if (a === '-v') flags.version = true;
    else if (!cmd) cmd = a;
    else args.push(a);
  }
  return { cmd: cmd || 'start', args, flags };
}

const HELP = `
${c.bold('Open Gravity')} v${VERSION} — universal local AI router with a web dashboard

${c.bold('Usage')}
  open-gravity [start] [--port 18080] [--host 127.0.0.1] [--no-open]
  open-gravity claude [claude args...]     launch Claude Code through the router
  open-gravity codex [codex args...]       launch Codex CLI through the router
  open-gravity setup <tool> [--model m]    configure claude-code | codex | opencode | gemini-cli | qwen-code | aider
  open-gravity models                      list routable models
  open-gravity key create [name]           create a router API key
  open-gravity doctor                      check configuration and test every provider
  open-gravity status                      show whether the router is running

${c.bold('Endpoints')} (default http://127.0.0.1:18080)
  OpenAI      /v1/chat/completions, /v1/responses, /v1/models, /v1/embeddings
  Anthropic   /v1/messages, /v1/messages/count_tokens
  Gemini      /v1beta/models/{model}:generateContent | :streamGenerateContent

${c.bold('Model names')}
  <combo>                 a combo (fallback chain) defined in the dashboard
  <provider>/<model>      e.g. openrouter/qwen/qwen3-coder, gemini/gemini-2.5-pro
  <model>                 any provider listing that model; unknown names use the default

Data directory: ~/.open-gravity (override with OPEN_GRAVITY_HOME)
`;

function pauseBeforeExit(code: number) {
  // When double-clicked on Windows the console closes immediately; keep errors readable.
  if (process.platform === 'win32' && process.stdin.isTTY && !process.env.OG_NO_PAUSE) {
    console.log(c.gray('\nPress Enter to close...'));
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('', () => process.exit(code));
    return;
  }
  process.exit(code);
}

async function ensureRunning(): Promise<{ baseUrl: string; app?: RunningApp; key: string; config: ConfigStore }> {
  const config = new ConfigStore();
  const s = config.settings;
  const key = config.get().apiKeys.find((k) => k.enabled)?.key || '';
  if (await probeExisting(s.host, s.port)) return { baseUrl: baseUrlFor(s.host, s.port), key, config };
  logger.quiet = true;
  const app = await startApp({ config });
  return { baseUrl: app.baseUrl, app, key, config };
}

/** Exit when the process that launched us (the desktop app) goes away. */
function watchParent(pid: number) {
  if (!Number.isInteger(pid) || pid <= 0) return;
  const timer = setInterval(() => {
    try {
      process.kill(pid, 0);
    } catch (e: any) {
      if (e?.code === 'ESRCH') process.exit(0);
    }
  }, 2000);
  timer.unref();
}

async function cmdStart(p: Parsed) {
  const config = new ConfigStore();
  // Desktop mode: launched by the desktop app, which reads the "OG_READY <url>"
  // line from stdout and shows the dashboard in its own window.
  const desktop = !!p.flags.desktop;
  if (desktop) watchParent(Number(p.flags['parent-pid']));
  let app: RunningApp;
  try {
    app = await startApp({
      config,
      port: p.flags.port ? Number(p.flags.port) : undefined,
      host: typeof p.flags.host === 'string' ? p.flags.host : undefined,
    });
  } catch (e: any) {
    if (e.code === 'ALREADY_RUNNING') {
      const url = baseUrlFor(e.host, e.port);
      if (desktop) {
        console.log(`OG_READY ${url}`);
        return;
      }
      console.log(`${c.green('✔')} Open Gravity is already running at ${c.cyan(url)} — opening the dashboard.`);
      if (!p.flags['no-open']) openBrowser(url);
      return;
    }
    throw e;
  }
  if (desktop) {
    logger.success(`Router listening on ${app.baseUrl}`);
    console.log(`OG_READY ${app.baseUrl}`);
    const stopDesktop = async () => {
      await app.stop();
      process.exit(0);
    };
    process.on('SIGINT', stopDesktop);
    process.on('SIGTERM', stopDesktop);
    return;
  }
  banner(app);
  logger.success(`Router listening on ${app.baseUrl}`);
  if (!p.flags['no-open'] && config.settings.openBrowser && !process.env.OG_NO_OPEN) openBrowser(app.baseUrl);

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    console.log(c.gray('\nStopping Open Gravity...'));
    await app.stop();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  startTui(app, stop);
}

async function cmdLaunch(tool: 'claude' | 'codex', p: Parsed) {
  const { baseUrl, app, key, config } = await ensureRunning();
  const model = typeof p.flags.model === 'string' ? p.flags.model : undefined;
  if (!config.get().providers.some((x) => x.enabled)) {
    console.log(c.yellow(`No provider configured yet. Open ${baseUrl} and add one first.`));
  }
  const code = tool === 'claude'
    ? await launchClaude(baseUrl, key, p.args, model)
    : await launchCodex(baseUrl, key, p.args, model || effectiveDefault(config.get()) || undefined);
  await app?.stop();
  process.exit(code);
}

async function cmdSetup(p: Parsed) {
  const config = new ConfigStore();
  const cfg = config.get();
  const tool = p.args[0];
  const model = String(p.flags.model || effectiveDefault(cfg) || '');
  const ctx = {
    baseUrl: baseUrlFor(cfg.settings.host, cfg.settings.port),
    apiKey: cfg.apiKeys.find((k) => k.enabled)?.key || '',
    model,
    smallModel: String(p.flags['small-model'] || model),
    models: listRoutableModels(cfg).map((m) => m.id),
  };
  if (!tool) {
    for (const t of listTools(ctx)) {
      console.log(`  ${t.canApply ? c.green('●') : c.gray('○')} ${c.bold(t.id.padEnd(14))} ${t.name}${t.detected ? c.gray(' (detected)') : ''}${t.applied ? c.green(' ✔ configured') : ''}`);
    }
    console.log(c.gray('\n  open-gravity setup <tool> [--model <model>]'));
    return;
  }
  if (!model) throw new Error('No model available: add a provider first or pass --model.');
  const r = applyTool(tool, ctx);
  console.log(`${c.green('✔')} ${tool} now uses Open Gravity (${model}). Updated: ${r.files.join(', ')}`);
  console.log(c.gray('  A backup was saved; restore it from the dashboard (Integrations).'));
}

async function cmdDoctor() {
  const config = new ConfigStore();
  const cfg = config.get();
  const s = cfg.settings;
  console.log(`${c.bold('Open Gravity doctor')} v${VERSION} on ${process.platform}-${process.arch}, Node ${process.version}`);
  console.log(`  config: ${config.file}`);
  const running = await probeExisting(s.host, s.port);
  console.log(`  router: ${running ? c.green(`running at ${baseUrlFor(s.host, s.port)}`) : c.yellow('not running')}`);
  console.log(`  default model: ${effectiveDefault(cfg) || c.yellow('none')}`);
  if (!cfg.providers.length) console.log(c.yellow('  No providers configured.'));
  for (const p of cfg.providers) {
    if (!p.enabled) {
      console.log(`  ${c.gray('○')} ${p.id} ${c.gray('(disabled)')}`);
      continue;
    }
    const r = await probeProvider(p, s);
    const mark = r.ok ? c.green('✔') : c.red('✖');
    console.log(`  ${mark} ${c.bold(p.id)} ${c.gray(`${p.models.length} models, ${p.keys.length} keys`)} → ${r.model} ${c.gray(`${r.latencyMs}ms`)} ${r.ok ? '' : c.red(r.error || `HTTP ${r.status}`)}`);
  }
}

async function main() {
  const p = parseArgs(process.argv.slice(2));
  if (p.flags.version) {
    console.log(VERSION);
    return;
  }
  if (p.flags.help || p.cmd === 'help') {
    console.log(HELP);
    return;
  }
  switch (p.cmd) {
    case 'start':
    case 'serve':
      return cmdStart(p);
    case 'claude':
    case 'codex':
      return cmdLaunch(p.cmd, p);
    case 'setup':
    case 'configure':
      return cmdSetup(p);
    case 'doctor':
      return cmdDoctor();
    case 'models': {
      const cfg = new ConfigStore().get();
      for (const m of listRoutableModels(cfg)) console.log(`${m.kind.padEnd(6)} ${m.id}`);
      return;
    }
    case 'status': {
      const s = new ConfigStore().settings;
      const up = await probeExisting(s.host, s.port);
      console.log(up ? `${c.green('●')} running at ${baseUrlFor(s.host, s.port)}` : `${c.gray('○')} not running (default ${baseUrlFor(s.host, s.port)})`);
      return;
    }
    case 'key':
    case 'keys': {
      const config = new ConfigStore();
      if (p.args[0] === 'create') {
        const key = { id: randomId(8), name: p.args[1] || 'cli', key: randomKey(), enabled: true, createdAt: Date.now() };
        config.update((cfg) => cfg.apiKeys.push(key));
        config.saveNow();
        console.log(key.key);
      } else {
        for (const k of config.get().apiKeys) console.log(`${k.enabled ? c.green('●') : c.gray('○')} ${k.name.padEnd(16)} ${maskKey(k.key)}`);
        if (!config.get().apiKeys.length) console.log(c.gray('No keys. Create one: open-gravity key create <name>'));
      }
      return;
    }
    default:
      console.log(c.red(`Unknown command "${p.cmd}".`));
      console.log(HELP);
      process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(`\n${c.red('✖')} ${e?.message || e}`);
  if (process.env.OG_DEBUG) console.error(e?.stack);
  pauseBeforeExit(1);
});
