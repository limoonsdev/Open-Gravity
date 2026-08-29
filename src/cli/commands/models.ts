import chalk from 'chalk';
import { antigravityCore } from '../../engines/antigravity-core';
import { configManager } from '../../utils/config';

export async function modelsCommand() {
  console.log(chalk.bold.cyan('\n📦 Available Antigravity & Open Gravity Models:\n'));

  const models = await antigravityCore.getAvailableModels();
  const config = configManager.get();

  if (Object.keys(models).length === 0) {
    console.log(chalk.yellow('Antigravity is not connected. Here are the standard default models:'));
    const defaultModels = [
      { id: 'gemini-3.7-flash-high', name: 'Gemini 3.7 Flash High (Recommended)', tier: 'flash', max: '1,000,000' },
      { id: 'gemini-3.7-flash-medium', name: 'Gemini 3.7 Flash Medium', tier: 'flash', max: '1,000,000' },
      { id: 'gemini-3.7-flash-low', name: 'Gemini 3.7 Flash Low', tier: 'flash_lite', max: '1,000,000' },
      { id: 'gemini-pro-agent', name: 'Gemini Pro Agent (Deep Reasoning)', tier: 'pro', max: '2,000,000' },
      { id: 'claude-sonnet-4-6', name: 'Claude Sonnet (Via Antigravity Bridge)', tier: 'pro', max: '200,000' },
      { id: 'claude-opus-4-6-thinking', name: 'Claude Opus Thinking', tier: 'pro', max: '200,000' },
      { id: 'gpt-oss-120b-medium', name: 'GPT-OSS 120B Medium', tier: 'pro', max: '131,072' },
    ];

    console.log(chalk.gray('-----------------------------------------------------------------------------------'));
    console.log(`${chalk.bold('MODEL ID'.padEnd(30))} ${chalk.bold('DISPLAY NAME'.padEnd(35))} ${chalk.bold('TIER')}`);
    console.log(chalk.gray('-----------------------------------------------------------------------------------'));

    for (const m of defaultModels) {
      const isDef = m.id === config.defaultModel ? chalk.green(' (DEFAULT)') : '';
      console.log(`${chalk.cyan(m.id.padEnd(30))} ${m.name.padEnd(35)} ${chalk.magenta(m.tier)}${isDef}`);
    }
    console.log(chalk.gray('-----------------------------------------------------------------------------------\n'));
    return;
  }

  console.log(chalk.gray('---------------------------------------------------------------------------------------------'));
  console.log(`${chalk.bold('MODEL ID'.padEnd(32))} ${chalk.bold('PROVIDER'.padEnd(25))} ${chalk.bold('MAX TOKENS'.padEnd(15))} ${chalk.bold('THINKING')}`);
  console.log(chalk.gray('---------------------------------------------------------------------------------------------'));

  for (const [id, m] of Object.entries(models)) {
    const isDef = id === config.defaultModel ? chalk.green(' ★') : '';
    const prov = m.modelProvider || m.apiProvider || 'Google';
    const think = m.supportsThinking ? chalk.green('Yes') : chalk.gray('No');
    console.log(`${chalk.cyan(id.padEnd(32))}${isDef} ${prov.padEnd(25)} ${String(m.maxTokens).padEnd(15)} ${think}`);
  }
  console.log(chalk.gray('---------------------------------------------------------------------------------------------\n'));
}
