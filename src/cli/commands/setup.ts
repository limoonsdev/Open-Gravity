import chalk from 'chalk';
import boxen from 'boxen';
import { configManager } from '../../utils/config';

export function setupCommand(target?: string) {
  const config = configManager.get();
  const baseUrl = `http://${config.host}:${config.port}`;
  const openaiUrl = `http://${config.host}:${config.port}/v1`;

  console.log(chalk.bold.cyan('\n🛠️ Open Gravity AI Agent Setup Assistant\n'));

  const claudeSnippet = `
${chalk.bold.magenta('🟣 CLAUDE CODE CLI (`claude`) :')}
${chalk.gray('Configure Claude Code to route all requests to your Antigravity models:')}

${chalk.bold.white('• Windows PowerShell :')}
  ${chalk.green(`$env:ANTHROPIC_BASE_URL = "${baseUrl}"`)}
  ${chalk.green(`$env:ANTHROPIC_API_KEY = "gravity-bridge"`)}
  ${chalk.cyan('claude')}

${chalk.bold.white('• Linux / macOS / Git Bash :')}
  ${chalk.green(`export ANTHROPIC_BASE_URL="${baseUrl}"`)}
  ${chalk.green(`export ANTHROPIC_API_KEY="gravity-bridge"`)}
  ${chalk.cyan('claude')}
`;

  const codexSnippet = `
${chalk.bold.green('🟢 CODEX CLI / OPENAI COMPATIBLE TOOLS :')}

${chalk.bold.white('• Windows PowerShell :')}
  ${chalk.green(`$env:OPENAI_BASE_URL = "${openaiUrl}"`)}
  ${chalk.green(`$env:OPENAI_API_KEY = "gravity-bridge"`)}

${chalk.bold.white('• Linux / macOS / Git Bash :')}
  ${chalk.green(`export OPENAI_BASE_URL="${openaiUrl}"`)}
  ${chalk.green(`export OPENAI_API_KEY="gravity-bridge"`)}
`;

  const aiderSnippet = `
${chalk.bold.yellow('⚡ AIDER CLI :')}

${chalk.bold.white('• Run Aider with Gemini 3.7 Flash High :')}
  ${chalk.cyan(`aider --openai-api-base ${openaiUrl} --openai-api-key gravity-bridge --model openai/gemini-3.7-flash-high`)}

${chalk.bold.white('• Or with Anthropic provider / Claude Sonnet :')}
  ${chalk.cyan(`aider --anthropic-api-base ${baseUrl} --anthropic-api-key gravity-bridge --model anthropic/claude-sonnet-4-6`)}
`;

  const cursorSnippet = `
${chalk.bold.blue('💻 CURSOR IDE & CONTINUE.DEV :')}

  1. Open Cursor > ${chalk.bold('Settings')} > ${chalk.bold('Models')}
  2. Enable ${chalk.bold('OpenAI API Key')}
  3. Set Override OpenAI Base URL: ${chalk.green(openaiUrl)}
  4. Enter API Key: ${chalk.green('gravity-bridge')}
  5. Add Models: ${chalk.yellow('gemini-3.7-flash-high')}, ${chalk.yellow('claude-sonnet-4-6')}
`;

  if (!target || target === 'claude' || target === 'all') {
    console.log(boxen(claudeSnippet, { padding: 1, margin: 0, borderStyle: 'round', borderColor: 'magenta' }));
    console.log('');
  }

  if (!target || target === 'codex' || target === 'all') {
    console.log(boxen(codexSnippet, { padding: 1, margin: 0, borderStyle: 'round', borderColor: 'green' }));
    console.log('');
  }

  if (!target || target === 'aider' || target === 'all') {
    console.log(boxen(aiderSnippet, { padding: 1, margin: 0, borderStyle: 'round', borderColor: 'yellow' }));
    console.log('');
  }

  if (!target || target === 'cursor' || target === 'all') {
    console.log(boxen(cursorSnippet, { padding: 1, margin: 0, borderStyle: 'round', borderColor: 'blue' }));
    console.log('');
  }
}
