import readline from 'readline';
import chalk from 'chalk';
import { AntigravityDiscovery } from '../engines/discovery';
import { antigravityCore, UserAccountDetails } from '../engines/antigravity-core';
import { requestRouter } from '../engines/router';
import { IdeConfigurator } from '../engines/ide-config';
import { ClaudeLauncher } from '../engines/claude-launcher';
import { ModelSelector } from './model-selector';
import { logger, LogEntry } from '../utils/logger';
import { configManager } from '../utils/config';

export class InteractiveTui {
  private rl: readline.Interface | null = null;
  private port: number;
  private host: string;
  private defaultModel: string;
  private isRunning: boolean = false;
  private isSelectingModel: boolean = false;

  constructor(options: { port: number; host: string; defaultModel: string }) {
    this.port = options.port;
    this.host = options.host;
    this.defaultModel = options.defaultModel;
  }

  public async start(account: UserAccountDetails | null, pid?: number, activePort?: number) {
    this.isRunning = true;
    this.drawHeader(account, pid, activePort);

    this.createReadline();

    // Intercept logs so they don't break current user input line
    logger.on('log', (entry: LogEntry) => {
      if (!this.isRunning || !this.rl || this.isSelectingModel) return;

      const isPolling = entry.message.includes('/status') || entry.message.includes('/health');
      if (isPolling) return;

      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);

      let tag = '';
      if (entry.level === 'request') tag = chalk.magenta('REQ');
      else if (entry.level === 'success') tag = chalk.green('OK ');
      else if (entry.level === 'error') tag = chalk.red('ERR');
      else if (entry.level === 'warn') tag = chalk.yellow('WRN');
      else tag = chalk.blue('INF');

      console.log(`${chalk.gray(`[${entry.timestamp}]`)} ${tag} ${entry.message}`);
      this.rl.prompt(true);
    });
  }

  private createReadline() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: chalk.cyan('og > '),
    });

    this.rl.prompt();

    this.rl.on('line', async (line) => {
      if (this.isSelectingModel) return;

      const input = line.trim();
      if (!input) {
        this.rl?.prompt();
        return;
      }

      await this.handleCommand(input);
      if (this.isRunning && !this.isSelectingModel) {
        this.rl?.prompt();
      }
    });

    this.rl.on('close', () => {
      if (!this.isSelectingModel) {
        this.shutdown();
      }
    });
  }

  public drawHeader(account: UserAccountDetails | null, pid?: number, activePort?: number) {
    const currentDef = configManager.get().defaultModel;
    console.log('');
    console.log(`  ${chalk.bold.cyan('Open Gravity')} ${chalk.gray('v1.0.0')} — ${chalk.white('Universal Antigravity AI Bridge')}`);
    console.log('');
    console.log(`  ${chalk.bold('➜ Endpoints:')}`);
    console.log(`    • Claude Code / Anthropic : ${chalk.magenta.bold(`http://${this.host}:${this.port}`)}`);
    console.log(`    • OpenAI / Codex / Cursor : ${chalk.yellow.bold(`http://${this.host}:${this.port}/v1`)}`);
    console.log('');
    console.log(`  ${chalk.bold('➜ Session:')}`);

    if (account) {
      const quotaPct = account.quotaRemainingPercent;
      let resetStr = '';
      if (account.quotaResetTime) {
        try {
          const d = new Date(account.quotaResetTime);
          resetStr = ` (Resets at ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`;
        } catch {}
      }
      const quotaColor = quotaPct > 50 ? chalk.green : (quotaPct > 10 ? chalk.yellow : chalk.red);

      console.log(`    • Account:      ${chalk.white.bold(account.name)} ${chalk.gray(`(${account.email})`)}`);
      console.log(`    • Plan:         ${chalk.hex('#a855f7')(account.planName)} ${chalk.green('✔')}`);
      console.log(`    • Model Quota:  ${quotaColor(`${quotaPct}% remaining`)}${chalk.gray(resetStr)}`);
    } else {
      console.log(`    • Account:      ${chalk.gray('Detecting Antigravity session...')}`);
    }

    const conn = pid ? chalk.green(`Connected (PID ${pid}, Port ${activePort})`) : chalk.yellow('Offline');
    console.log(`    • Antigravity:  ${conn}`);
    console.log(`    • Default:      ${chalk.cyan(currentDef)}`);
    console.log('');
    console.log(`  ${chalk.gray('Hotkeys/Commands:')} ${chalk.bold.magenta('claude')} (${chalk.bold('cl')})  ${chalk.cyan('models')} (${chalk.bold('m')})  ${chalk.cyan('configure')} (${chalk.bold('c')})  ${chalk.cyan('status')} (${chalk.bold('s')})  ${chalk.cyan('doctor')} (${chalk.bold('d')})  ${chalk.cyan('clear')} (${chalk.bold('cls')})  ${chalk.cyan('quit')} (${chalk.bold('q')})`);
    console.log(chalk.gray('  --------------------------------------------------------------------------------'));
    console.log('');
  }

  private async handleCommand(cmd: string) {
    const parts = cmd.split(' ');
    const main = parts[0].toLowerCase();
    const args = parts.slice(1);

    switch (main) {
      case 'cl':
      case 'claude':
      case 'run-claude':
        this.isSelectingModel = true;
        if (this.rl) {
          this.rl.close();
          this.rl = null;
        }

        await ClaudeLauncher.launchClaude(args);
        this.isSelectingModel = false;
        this.createReadline();
        break;

      case 'm':
      case 'model':
      case 'models':
      case 'use':
        this.isSelectingModel = true;
        if (this.rl) {
          this.rl.close();
          this.rl = null;
        }

        const selector = new ModelSelector(() => {
          this.isSelectingModel = false;
          this.createReadline();
        });
        await selector.start();
        break;

      case 'c':
      case 'config':
      case 'configure':
        console.log(chalk.cyan('\n[TUI] Running automatic IDE configurator & Claude bypass...'));
        const results = IdeConfigurator.configureAll(process.cwd());
        for (const r of results) {
          console.log(`  ${r.success ? chalk.green('✔') : chalk.red('✖')} ${chalk.bold(r.ide.padEnd(12))} ${r.message}`);
        }
        console.log(chalk.green('✔ Configuration updated on disk.\n'));
        break;

      case 's':
      case 'status':
        console.log(chalk.cyan('\n[TUI] Live Status & Quota Refresh:'));
        const instance = await AntigravityDiscovery.discover(true);
        const account = await antigravityCore.getUserAccountDetails();
        const stats = requestRouter.getStats();

        if (account) {
          console.log(`  • User:     ${account.name} (${account.email})`);
          console.log(`  • Plan:     ${account.planName}`);
          console.log(`  • Quota:    ${account.quotaRemainingPercent}% remaining`);
        }
        console.log(`  • Core:     ${instance ? chalk.green(`Online (PID ${instance.pid}, Port ${instance.port})`) : chalk.yellow('Offline')}`);
        console.log(`  • Traffic:  ${stats.totalRequests} total requests (${stats.activeRequests} active), last latency: ${stats.lastLatencyMs}ms\n`);
        break;

      case 'd':
      case 'doc':
      case 'doctor':
        console.log(chalk.cyan('\n[TUI] Quick Diagnostic:'));
        const inst = await AntigravityDiscovery.discover(true);
        console.log(`  • Daemon: ${inst ? chalk.green('✔ Detected') : chalk.red('✖ Not running')}`);
        if (inst) {
          try {
            await antigravityCore.rpcCall('GetCapabilities');
            console.log(`  • RPC:    ${chalk.green('✔ Connected (CSRF validated)')}`);
          } catch (e: any) {
            console.log(`  • RPC:    ${chalk.red('✖ Error: ' + e.message)}`);
          }
        }
        console.log('');
        break;

      case 'cls':
      case 'clear':
        console.clear();
        const instCurrent = await AntigravityDiscovery.discover();
        const accCurrent = await antigravityCore.getUserAccountDetails();
        this.drawHeader(accCurrent, instCurrent?.pid, instCurrent?.port);
        break;

      case 'help':
      case 'h':
      case '?':
        console.log(chalk.cyan('\n[TUI] Available Commands:'));
        console.log(`  • ${chalk.bold('claude')}    (${chalk.bold('cl')}): Launch Claude Code with automatic login bypass`);
        console.log(`  • ${chalk.bold('models')}    (${chalk.bold('m')}): Interactive arrow-key model selector & 1-token health ping`);
        console.log(`  • ${chalk.bold('configure')} (${chalk.bold('c')}): Auto-configure Cursor, Continue, Aider, Claude Code`);
        console.log(`  • ${chalk.bold('status')}    (${chalk.bold('s')}): Refresh live Google account info & model quota`);
        console.log(`  • ${chalk.bold('doctor')}    (${chalk.bold('d')}): Test Antigravity connection & RPC`);
        console.log(`  • ${chalk.bold('clear')}     (${chalk.bold('cls')}): Clear screen and redraw banner`);
        console.log(`  • ${chalk.bold('quit')}      (${chalk.bold('q')}): Stop server and exit\n`);
        break;

      case 'q':
      case 'quit':
      case 'exit':
        this.shutdown();
        break;

      default:
        console.log(chalk.yellow(`Unknown command: '${cmd}'. Type 'help' or 'h' for list of commands.`));
        break;
    }
  }

  private shutdown() {
    this.isRunning = false;
    console.log(chalk.gray('\nStopping Open Gravity server...'));
    if (this.rl) {
      this.rl.close();
    }
    process.exit(0);
  }
}
