import chalk from 'chalk';
import boxen from 'boxen';
import { AntigravityDiscovery } from '../../engines/discovery';
import { antigravityCore } from '../../engines/antigravity-core';
import { configManager } from '../../utils/config';

export async function statusCommand() {
  console.log(chalk.bold.cyan('\n🔍 Checking Open Gravity & Google Antigravity status...\n'));

  const instance = await AntigravityDiscovery.discover(true);
  const config = configManager.get();

  let details = '';
  if (instance) {
    const account = await antigravityCore.getUserAccountDetails();

    details += `${chalk.bold.green('✔ Google Antigravity : ACTIVE & CONNECTED')}\n\n`;
    if (account) {
      const quotaPct = account.quotaRemainingPercent;
      const barTotal = 15;
      const filled = Math.round((quotaPct / 100) * barTotal);
      const bar = '█'.repeat(Math.max(0, filled)) + '░'.repeat(Math.max(0, barTotal - filled));
      const quotaColor = quotaPct > 50 ? chalk.green : (quotaPct > 20 ? chalk.yellow : chalk.red);

      let resetStr = '';
      if (account.quotaResetTime) {
        try {
          const d = new Date(account.quotaResetTime);
          resetStr = ` (Reset at ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`;
        } catch {}
      }

      details += `  ${chalk.gray('•')} ${chalk.bold('Google Account   :')} ${chalk.white.bold(account.name)} ${chalk.gray(`(${account.email})`)}\n`;
      details += `  ${chalk.gray('•')} ${chalk.bold('Subscription Plan:')} ${chalk.hex('#a855f7').bold(account.planName)} ${chalk.green('✔')}\n`;
      details += `  ${chalk.gray('•')} ${chalk.bold('Quota Remaining  :')} ${quotaColor.bold(`${quotaPct}%`)} ${chalk.gray(`[${quotaColor(bar)}]`)}${chalk.gray(resetStr)}\n`;
    }

    details += `  ${chalk.gray('•')} ${chalk.bold('Process ID (PID) :')} ${chalk.yellow(instance.pid)}\n`;
    details += `  ${chalk.gray('•')} ${chalk.bold('Active Port      :')} ${chalk.cyan(instance.port)}\n`;
    details += `  ${chalk.gray('•')} ${chalk.bold('CSRF Token       :')} ${chalk.gray(instance.csrfToken.substring(0, 8) + '...')}\n`;
  } else {
    details += `${chalk.bold.yellow('⚠ Antigravity Language Server : OFFLINE')}\n\n`;
    details += `  Google Antigravity is not detected running.\n`;
    details += `  👉 ${chalk.bold.white('Tip:')} Keep Google Antigravity open in the background\n`;
    details += `     to automatically leverage your subscription and all 28+ models with zero API keys!\n`;
  }

  details += `\n${chalk.bold.blue('⚙ Open Gravity Configuration :')}\n`;
  details += `  ${chalk.gray('•')} ${chalk.bold('Local Port       :')} ${config.port}\n`;
  details += `  ${chalk.gray('•')} ${chalk.bold('Default Model    :')} ${chalk.green(config.defaultModel)}\n`;
  details += `  ${chalk.gray('•')} ${chalk.bold('Claude Code URL  :')} ${chalk.magenta(`http://${config.host}:${config.port}`)}\n`;
  details += `  ${chalk.gray('•')} ${chalk.bold('OpenAI/Codex URL :')} ${chalk.yellow(`http://${config.host}:${config.port}/v1`)}\n`;
  details += `  ${chalk.gray('•')} ${chalk.bold('Web Dashboard    :')} ${chalk.cyan(`http://${config.host}:${config.port}/dashboard`)}\n`;

  console.log(boxen(details, {
    padding: 1,
    margin: 0,
    borderStyle: 'round',
    borderColor: instance ? 'green' : 'yellow',
  }));
}
