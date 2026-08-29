import chalk from 'chalk';
import { UserAccountDetails } from '../engines/antigravity-core';

export function printBanner(options: {
  port: number;
  host: string;
  antigravityConnected: boolean;
  activePort?: number;
  pid?: number;
  defaultModel: string;
  account?: UserAccountDetails | null;
}) {
  console.log('');
  console.log(`  ${chalk.bold.cyan('Open Gravity')} ${chalk.gray('v1.0.0')}`);
  console.log('');
  console.log(`  ${chalk.green('➜')}  ${chalk.bold('Local Proxy:')}     ${chalk.cyan(`http://${options.host}:${options.port}`)}`);
  console.log(`  ${chalk.green('➜')}  ${chalk.bold('Claude Code URL:')} ${chalk.magenta(`http://${options.host}:${options.port}`)}`);
  console.log(`  ${chalk.green('➜')}  ${chalk.bold('OpenAI Base URL:')} ${chalk.yellow(`http://${options.host}:${options.port}/v1`)}`);
  console.log(`  ${chalk.green('➜')}  ${chalk.bold('Web Dashboard:')}   ${chalk.blue(`http://${options.host}:${options.port}/dashboard`)}`);
  console.log('');

  if (options.account) {
    const quotaPct = options.account.quotaRemainingPercent;
    let resetStr = '';
    if (options.account.quotaResetTime) {
      try {
        const d = new Date(options.account.quotaResetTime);
        resetStr = ` (Resets at ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`;
      } catch {}
    }

    const quotaColor = quotaPct > 50 ? chalk.green : (quotaPct > 20 ? chalk.yellow : chalk.red);

    console.log(`  ${chalk.gray('•')} ${chalk.bold('Account:')}      ${options.account.name} ${chalk.gray(`(${options.account.email})`)}`);
    console.log(`  ${chalk.gray('•')} ${chalk.bold('Plan:')}         ${chalk.hex('#a855f7')(options.account.planName)} ${chalk.green('✔')}`);
    console.log(`  ${chalk.gray('•')} ${chalk.bold('Model Quota:')}   ${quotaColor(`${quotaPct}% remaining`)}${chalk.gray(resetStr)}`);
  }

  const connText = options.antigravityConnected
    ? chalk.green(`Connected (PID ${options.pid}, Port ${options.activePort})`)
    : chalk.yellow('Offline (Direct mode fallback)');

  console.log(`  ${chalk.gray('•')} ${chalk.bold('Antigravity:')}   ${connText}`);
  console.log(`  ${chalk.gray('•')} ${chalk.bold('Default Model:')} ${chalk.cyan(options.defaultModel)}`);
  console.log('');
  console.log(chalk.gray('  Ready for incoming requests. Press Ctrl+C to stop.'));
  console.log('');
}
