import readline from 'readline';
import chalk from 'chalk';
import { antigravityCore, AntigravityModelInfo } from '../engines/antigravity-core';
import { configManager } from '../utils/config';

export class ModelSelector {
  private models: AntigravityModelInfo[] = [];
  private selectedIndex: number = 0;
  private isRunning: boolean = false;
  private onCloseCallback: () => void;

  constructor(onClose: () => void) {
    this.onCloseCallback = onClose;
  }

  public async start() {
    this.isRunning = true;
    console.log(chalk.cyan('\n[TUI] Loading models & checking quotas...'));
    this.models = await antigravityCore.getCleanModels();

    const currentDefault = configManager.get().defaultModel;
    const foundIdx = this.models.findIndex(m => m.id === currentDefault);
    if (foundIdx !== -1) {
      this.selectedIndex = foundIdx;
    }

    this.render();
    this.setupKeypress();
  }

  private render() {
    console.clear();
    console.log('');
    console.log(`  ${chalk.bold.cyan('Open Gravity')} — ${chalk.bold('Interactive Model Selector & Health Check')}`);
    console.log(`  ${chalk.gray('Use ↑ / ↓ arrows to navigate • Enter to select • [t] to test 1-token ping • [q/Esc] to exit')}`);
    console.log(chalk.gray('  -----------------------------------------------------------------------------------------'));

    const currentDefault = configManager.get().defaultModel;

    this.models.forEach((m, idx) => {
      const isCursor = idx === this.selectedIndex;
      const isDefault = m.id === currentDefault;

      const cursorChar = isCursor ? chalk.cyan.bold('➜ ') : '  ';
      const defaultBadge = isDefault ? chalk.green.bold(' [ACTIVE]') : '';

      // Quota styling
      let quotaStr = '';
      if (m.quotaRemainingPercent !== undefined) {
        const qColor = m.quotaRemainingPercent > 50 ? chalk.green : (m.quotaRemainingPercent > 10 ? chalk.yellow : chalk.red);
        quotaStr = qColor(`${m.quotaRemainingPercent}% quota`.padEnd(11));
      } else {
        quotaStr = chalk.gray('unlimited  ');
      }

      // Ping status
      let pingStr = '';
      if (m.status === 'online') {
        pingStr = chalk.green(`✔ ${m.latencyMs}ms`);
      } else if (m.status === 'offline') {
        pingStr = chalk.red('✖ Offline');
      } else if (m.status === 'quota_exceeded') {
        pingStr = chalk.yellow('⚠ Quota Exceeded');
      } else {
        pingStr = chalk.gray('○ Untested');
      }

      const idDisplay = isCursor ? chalk.bold.cyan(m.id.padEnd(28)) : m.id.padEnd(28);
      const nameDisplay = chalk.gray(m.displayName.padEnd(26));
      const provider = chalk.hex(m.modelProvider === 'Anthropic' ? '#a855f7' : '#38bdf8')(m.modelProvider?.padEnd(10) || 'Google    ');

      console.log(`${cursorChar}${idDisplay} ${provider} ${nameDisplay} ${quotaStr} ${pingStr}${defaultBadge}`);
    });

    console.log(chalk.gray('  -----------------------------------------------------------------------------------------'));
    const selected = this.models[this.selectedIndex];
    if (selected) {
      console.log(`  ${chalk.bold('Selected:')} ${chalk.cyan(selected.id)} | Max Tokens: ${selected.maxTokens.toLocaleString()} | Provider: ${selected.modelProvider}`);
    }
    console.log('');
  }

  private setupKeypress() {
    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }

    const onKey = async (str: string, key: any) => {
      if (!this.isRunning) return;

      if (key.name === 'up' || str === 'k') {
        this.selectedIndex = (this.selectedIndex - 1 + this.models.length) % this.models.length;
        this.render();
      } else if (key.name === 'down' || str === 'j') {
        this.selectedIndex = (this.selectedIndex + 1) % this.models.length;
        this.render();
      } else if (key.name === 'return') {
        const chosen = this.models[this.selectedIndex];
        if (chosen) {
          configManager.update({ defaultModel: chosen.id });
          this.cleanup(onKey);
          console.log(chalk.green(`\n✔ Switched active default model to: ${chalk.bold(chosen.id)}`));
          this.onCloseCallback();
        }
      } else if (str === 't') {
        const chosen = this.models[this.selectedIndex];
        if (chosen) {
          chosen.status = 'untested';
          this.render();
          console.log(chalk.yellow(`  Sending 1-token probe request to ${chosen.id}...`));
          
          const probe = await antigravityCore.pingModel(chosen.id);
          if (probe.success) {
            chosen.status = 'online';
            chosen.latencyMs = probe.latencyMs;
          } else {
            chosen.status = 'offline';
          }
          this.render();
        }
      } else if (key.name === 'escape' || str === 'q' || (key.ctrl && key.name === 'c')) {
        this.cleanup(onKey);
        this.onCloseCallback();
      }
    };

    process.stdin.on('keypress', onKey);
  }

  private cleanup(onKey: (str: string, key: any) => void) {
    this.isRunning = false;
    process.stdin.removeListener('keypress', onKey);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
  }
}
