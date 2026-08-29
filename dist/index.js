#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const start_1 = require("./cli/commands/start");
const status_1 = require("./cli/commands/status");
const models_1 = require("./cli/commands/models");
const setup_1 = require("./cli/commands/setup");
const configure_1 = require("./cli/commands/configure");
const doctor_1 = require("./cli/commands/doctor");
const claude_launcher_1 = require("./engines/claude-launcher");
const claude_guide_1 = require("./engines/claude-guide");
const readline_1 = __importDefault(require("readline"));
function preventWindowCloseOnError(err) {
    console.error('\n[Open Gravity Error]:', err?.message || err);
    console.log('\nPress Enter to exit...');
    const rl = readline_1.default.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('', () => {
        process.exit(1);
    });
}
process.on('uncaughtException', preventWindowCloseOnError);
process.on('unhandledRejection', preventWindowCloseOnError);
const program = new commander_1.Command();
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
    (0, start_1.startCommand)(options);
});
program
    .command('claude [args...]')
    .description('Launch Claude Code with automatic login bypass')
    .action(async (args) => {
    await claude_launcher_1.ClaudeLauncher.launchClaude(args || []);
});
program
    .command('guide [tool]')
    .description('Display integrated guide for Claude Code, Cursor, Aider, Codex')
    .action((tool) => {
    claude_guide_1.ClaudeGuide.printGuide();
});
program
    .command('configure [ide]')
    .description('Automatically write config files for Cursor, Continue, Aider, Claude Code, and CLAUDE.md')
    .action((ide) => {
    (0, configure_1.configureCommand)(ide);
    claude_guide_1.ClaudeGuide.generateClaudeMd();
});
program
    .command('status')
    .description('Show Google account status, Antigravity connection, and remaining quota')
    .action(() => {
    (0, status_1.statusCommand)();
});
program
    .command('models')
    .description('Open interactive model selector and test 1-token health ping')
    .action(() => {
    (0, models_1.modelsCommand)();
});
program
    .command('setup [agent]')
    .description('Show configuration export snippets for Claude Code, Codex, Aider, Cursor')
    .action((agent) => {
    (0, setup_1.setupCommand)(agent);
});
program
    .command('doctor')
    .description('Run comprehensive system and Antigravity diagnostics')
    .action(() => {
    (0, doctor_1.doctorCommand)();
});
program.parse(process.argv);
//# sourceMappingURL=index.js.map