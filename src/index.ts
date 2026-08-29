#!/usr/bin/env node

import { Command } from 'commander';
import { startCommand } from './cli/commands/start';
import { statusCommand } from './cli/commands/status';
import { modelsCommand } from './cli/commands/models';
import { setupCommand } from './cli/commands/setup';
import { configureCommand } from './cli/commands/configure';
import { doctorCommand } from './cli/commands/doctor';
import { ClaudeLauncher } from './engines/claude-launcher';
import { ClaudeGuide } from './engines/claude-guide';
import readline from 'readline';

function preventWindowCloseOnError(err: any) {
  console.error('\n[Open Gravity Error]:', err?.message || err);
  console.log('\nPress Enter to exit...');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question('', () => {
    process.exit(1);
  });
}

process.on('uncaughtException', preventWindowCloseOnError);
process.on('unhandledRejection', preventWindowCloseOnError);

const program = new Command();

program
  .name('open-gravity')
  .description('Universal local AI Proxy connecting Google Antigravity models to Claude Code, Codex, Aider, Cursor, and any AI agent.')
  .version('1.0.0');

program
  .command('start', { isDefault: true })
  .description('Start the Open Gravity proxy server & interactive TUI')
  .option('-p, --port <number>', 'Local listening port', (val) => parseInt(val, 10))
  .option('-h, --host <string>', 'Local listening host (default: 127.0.0.1)')
  .option('-m, --model <string>', 'Default Antigravity model')
  .action((options) => {
    startCommand(options);
  });

program
  .command('claude [args...]')
  .description('Launch Claude Code with automatic login bypass')
  .action(async (args) => {
    await ClaudeLauncher.launchClaude(args || []);
  });

program
  .command('guide [tool]')
  .description('Display integrated guide for Claude Code, Cursor, Aider, Codex')
  .action((tool) => {
    ClaudeGuide.printGuide();
  });

program
  .command('configure [ide]')
  .description('Automatically write config files for Cursor, Continue, Aider, Claude Code, and CLAUDE.md')
  .action((ide) => {
    configureCommand(ide);
    ClaudeGuide.generateClaudeMd();
  });

program
  .command('status')
  .description('Show Google account status, Antigravity connection, and remaining quota')
  .action(() => {
    statusCommand();
  });

program
  .command('models')
  .description('Open interactive model selector and test 1-token health ping')
  .action(() => {
    modelsCommand();
  });

program
  .command('setup [agent]')
  .description('Show configuration export snippets for Claude Code, Codex, Aider, Cursor')
  .action((agent) => {
    setupCommand(agent);
  });

program
  .command('doctor')
  .description('Run comprehensive system and Antigravity diagnostics')
  .action(() => {
    doctorCommand();
  });

program.parse(process.argv);
