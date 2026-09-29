// Console UI shown while the router runs: banner + live log + a few commands.
import readline from 'readline';
import { c, logger } from '../core/logger';
import { VERSION } from '../core/util';
import type { RunningApp } from '../app';
import { openBrowser } from '../app';
import { effectiveDefault, listRoutableModels } from '../router/resolve';
import { launchClaude, launchCodex } from '../integrations/launcher';

export function banner(app: RunningApp) {
  const cfg = app.config.get();
  const url = app.baseUrl;
  const active = cfg.providers.filter((p) => p.enabled).length;
  const line = c.gray('─'.repeat(58));
  const def = effectiveDefault(cfg) || c.yellow('none yet');
  console.log('');
  console.log(`  ${c.magenta('◉')} ${c.bold('Open Gravity')} ${c.gray(`v${VERSION}`)}  ${c.gray('· universal AI router')}`);
  console.log(`  ${line}`);
  console.log(`  ${c.bold('Dashboard')}   ${c.cyan(url)}`);
  console.log(`  ${c.bold('OpenAI')}      ${url}/v1           ${c.gray('(chat, responses)')}`);
  console.log(`  ${c.bold('Anthropic')}   ${url}              ${c.gray('(Claude Code)')}`);
  console.log(`  ${c.bold('Gemini')}      ${url}              ${c.gray('(Gemini CLI)')}`);
  console.log(`  ${line}`);
  console.log(`  Providers ${c.bold(String(active))}  ·  Combos ${c.bold(String(cfg.combos.filter((x) => x.enabled).length))}  ·  Default ${c.bold(def)}`);
  if (!active) console.log(`  ${c.yellow('→ Open the dashboard to add your first provider.')}`);
  if (app.info.host !== '127.0.0.1' && app.info.host !== 'localhost') {
    console.log(`  ${c.yellow(`Listening on ${app.info.host}: remote clients need an API key.`)}`);
  }
  console.log(`  ${c.gray('Commands: open · claude · codex · models · status · help · quit')}`);
  console.log('');
}

const HELP = `
  open            open the dashboard in your browser
  claude [args]   launch Claude Code through the router
  codex [args]    launch Codex CLI through the router
  models          list routable models (combos, provider/model)
  status          request stats for the last 24h
  clear           clear the screen
  quit            stop the router
`;

export function startTui(app: RunningApp, onQuit: () => void) {
  if (!process.stdin.isTTY) return;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: c.magenta('og › ') });
  let busy = false;

  const runChild = async (fn: () => Promise<number>) => {
    busy = true;
    rl.pause();
    logger.quiet = true;
    try {
      await fn();
    } catch (e: any) {
      console.log(c.red(`  ${e.message}`));
    } finally {
      logger.quiet = false;
      busy = false;
      rl.resume();
      rl.prompt();
    }
  };

  rl.on('line', async (line) => {
    if (busy) return;
    const [cmd, ...args] = line.trim().split(/\s+/);
    const cfg = app.config.get();
    const key = cfg.apiKeys.find((k) => k.enabled)?.key || '';
    switch ((cmd || '').toLowerCase()) {
      case '':
        break;
      case 'open':
      case 'o':
        openBrowser(app.baseUrl);
        break;
      case 'claude':
      case 'cl':
        await runChild(() => launchClaude(app.baseUrl, key, args));
        return;
      case 'codex':
      case 'cx':
        await runChild(() => launchCodex(app.baseUrl, key, args, effectiveDefault(cfg) || undefined));
        return;
      case 'models':
      case 'm':
        for (const m of listRoutableModels(cfg)) console.log(`  ${m.kind === 'combo' ? c.magenta('combo') : m.kind === 'alias' ? c.yellow('alias') : c.gray('model')}  ${m.id}`);
        break;
      case 'status':
      case 's': {
        const s = app.usage.summary('24h').totals;
        console.log(`  24h: ${s.requests} requests · ${(s.successRate * 100).toFixed(1)}% ok · ${s.input + s.output} tokens · ~$${s.cost.toFixed(4)} · avg ${s.avgLatencyMs}ms`);
        break;
      }
      case 'clear':
      case 'cls':
        console.clear();
        banner(app);
        break;
      case 'help':
      case 'h':
      case '?':
        console.log(HELP);
        break;
      case 'quit':
      case 'exit':
      case 'q':
        rl.close();
        return;
      default:
        console.log(c.gray(`  Unknown command "${cmd}". Type "help".`));
    }
    rl.prompt();
  });
  rl.on('close', onQuit);
  rl.on('SIGINT', onQuit);
  rl.prompt();
}
