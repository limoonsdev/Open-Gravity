#!/usr/bin/env node

import { Command } from 'commander';
import { startCommand } from './cli/commands/start';
import { statusCommand } from './cli/commands/status';
import { modelsCommand } from './cli/commands/models';
import { setupCommand } from './cli/commands/setup';
import { configureCommand } from './cli/commands/configure';
import { doctorCommand } from './cli/commands/doctor';
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
  .description('Universal local AI Proxy & Bridge connecting Google Antigravity models to Claude Code, Codex, Aider, Cursor, and any AI agent.')
  .version('1.0.0');

program
  .command('start', { isDefault: true })
  .description('Start the Open Gravity proxy server (Default: auto-opens Web Dashboard when double-clicked)')
  .option('-p, --port <number>', 'Local listening port', (val) => parseInt(val, 10))
  .option('-h, --host <string>', 'Local listening host (default: 127.0.0.1)')
  .option('-m, --model <string>', 'Default Antigravity model')
  .option('-o, --open', 'Automatically open Web Dashboard in browser')
  .action((options) => {
    // If double-clicked without arguments, default to opening the dashboard in browser
    const isDoubleClicked = process.argv.length <= 2;
    if (isDoubleClicked && options.open === undefined) {
      options.open = true;
    }
    startCommand(options);
  });

program
  .command('configure [ide]')
  .description('Automatically write config files for Cursor, Continue, Aider, Claude Code, or all')
  .action((ide) => {
    configureCommand(ide);
  });

program
  .command('status')
  .description('Show Google account status, Antigravity connection, and remaining quota')
  .action(() => {
    statusCommand();
  });

program
  .command('models')
  .description('List all models available in Antigravity')
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
