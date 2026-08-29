import chalk from 'chalk';
import { IdeConfigurator } from '../../engines/ide-config';

export async function configureCommand(target?: string) {
  console.log(chalk.bold.cyan('\n⚙ Configuring IDEs & Agent Tools for Open Gravity...\n'));

  const cwd = process.cwd();
  const normalized = (target || 'all').toLowerCase();

  if (normalized === 'all') {
    const results = IdeConfigurator.configureAll(cwd);
    for (const r of results) {
      if (r.success) {
        console.log(`  ${chalk.green('✔')} ${chalk.bold(r.ide.padEnd(14))} ${r.message}`);
        console.log(`    ${chalk.gray(r.filePath)}`);
      } else {
        console.log(`  ${chalk.red('✖')} ${chalk.bold(r.ide.padEnd(14))} Failed: ${r.message}`);
      }
    }
  } else if (normalized === 'cursor') {
    const r = IdeConfigurator.configureCursor(cwd);
    console.log(`  ${r.success ? chalk.green('✔') : chalk.red('✖')} ${chalk.bold('Cursor:')} ${r.message}`);
    console.log(`    ${chalk.gray(r.filePath)}`);
  } else if (normalized === 'continue') {
    const r = IdeConfigurator.configureContinue();
    console.log(`  ${r.success ? chalk.green('✔') : chalk.red('✖')} ${chalk.bold('Continue.dev:')} ${r.message}`);
    console.log(`    ${chalk.gray(r.filePath)}`);
  } else if (normalized === 'aider') {
    const r = IdeConfigurator.configureAider(cwd);
    console.log(`  ${r.success ? chalk.green('✔') : chalk.red('✖')} ${chalk.bold('Aider:')} ${r.message}`);
    console.log(`    ${chalk.gray(r.filePath)}`);
  } else if (normalized === 'claude' || normalized === 'claudecode') {
    const r = IdeConfigurator.configureClaudeCode();
    console.log(`  ${r.success ? chalk.green('✔') : chalk.red('✖')} ${chalk.bold('Claude Code:')} ${r.message}`);
    console.log(`    ${chalk.gray(r.filePath)}`);
  } else if (normalized === 'vscode') {
    const r = IdeConfigurator.configureVSCode(cwd);
    console.log(`  ${r.success ? chalk.green('✔') : chalk.red('✖')} ${chalk.bold('VS Code:')} ${r.message}`);
    console.log(`    ${chalk.gray(r.filePath)}`);
  } else {
    console.log(chalk.red(`Unknown IDE target: ${target}. Use 'all', 'cursor', 'continue', 'aider', 'claude', or 'vscode'.`));
    return;
  }

  console.log(chalk.bold.green('\n✔ Automatic configuration complete!'));
  console.log(chalk.gray('  Start Open Gravity with `open-gravity start` and start coding directly in your configured tools.\n'));
}
