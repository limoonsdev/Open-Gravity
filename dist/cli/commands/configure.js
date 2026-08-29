"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.configureCommand = configureCommand;
const chalk_1 = __importDefault(require("chalk"));
const ide_config_1 = require("../../engines/ide-config");
async function configureCommand(target) {
    console.log(chalk_1.default.bold.cyan('\n⚙ Configuring IDEs & Agent Tools for Open Gravity...\n'));
    const cwd = process.cwd();
    const normalized = (target || 'all').toLowerCase();
    if (normalized === 'all') {
        const results = ide_config_1.IdeConfigurator.configureAll(cwd);
        for (const r of results) {
            if (r.success) {
                console.log(`  ${chalk_1.default.green('✔')} ${chalk_1.default.bold(r.ide.padEnd(14))} ${r.message}`);
                console.log(`    ${chalk_1.default.gray(r.filePath)}`);
            }
            else {
                console.log(`  ${chalk_1.default.red('✖')} ${chalk_1.default.bold(r.ide.padEnd(14))} Failed: ${r.message}`);
            }
        }
    }
    else if (normalized === 'cursor') {
        const r = ide_config_1.IdeConfigurator.configureCursor(cwd);
        console.log(`  ${r.success ? chalk_1.default.green('✔') : chalk_1.default.red('✖')} ${chalk_1.default.bold('Cursor:')} ${r.message}`);
        console.log(`    ${chalk_1.default.gray(r.filePath)}`);
    }
    else if (normalized === 'continue') {
        const r = ide_config_1.IdeConfigurator.configureContinue();
        console.log(`  ${r.success ? chalk_1.default.green('✔') : chalk_1.default.red('✖')} ${chalk_1.default.bold('Continue.dev:')} ${r.message}`);
        console.log(`    ${chalk_1.default.gray(r.filePath)}`);
    }
    else if (normalized === 'aider') {
        const r = ide_config_1.IdeConfigurator.configureAider(cwd);
        console.log(`  ${r.success ? chalk_1.default.green('✔') : chalk_1.default.red('✖')} ${chalk_1.default.bold('Aider:')} ${r.message}`);
        console.log(`    ${chalk_1.default.gray(r.filePath)}`);
    }
    else if (normalized === 'claude' || normalized === 'claudecode') {
        const r = ide_config_1.IdeConfigurator.configureClaudeCode();
        console.log(`  ${r.success ? chalk_1.default.green('✔') : chalk_1.default.red('✖')} ${chalk_1.default.bold('Claude Code:')} ${r.message}`);
        console.log(`    ${chalk_1.default.gray(r.filePath)}`);
    }
    else if (normalized === 'vscode') {
        const r = ide_config_1.IdeConfigurator.configureVSCode(cwd);
        console.log(`  ${r.success ? chalk_1.default.green('✔') : chalk_1.default.red('✖')} ${chalk_1.default.bold('VS Code:')} ${r.message}`);
        console.log(`    ${chalk_1.default.gray(r.filePath)}`);
    }
    else {
        console.log(chalk_1.default.red(`Unknown IDE target: ${target}. Use 'all', 'cursor', 'continue', 'aider', 'claude', or 'vscode'.`));
        return;
    }
    console.log(chalk_1.default.bold.green('\n✔ Automatic configuration complete!'));
    console.log(chalk_1.default.gray('  Start Open Gravity with `open-gravity start` and start coding directly in your configured tools.\n'));
}
//# sourceMappingURL=configure.js.map