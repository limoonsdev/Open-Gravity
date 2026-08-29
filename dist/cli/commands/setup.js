"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupCommand = setupCommand;
const chalk_1 = __importDefault(require("chalk"));
const boxen_1 = __importDefault(require("boxen"));
const config_1 = require("../../utils/config");
function setupCommand(target) {
    const config = config_1.configManager.get();
    const baseUrl = `http://${config.host}:${config.port}`;
    const openaiUrl = `http://${config.host}:${config.port}/v1`;
    console.log(chalk_1.default.bold.cyan('\n🛠️ Open Gravity AI Agent Setup Assistant\n'));
    const claudeSnippet = `
${chalk_1.default.bold.magenta('🟣 CLAUDE CODE CLI (`claude`) :')}
${chalk_1.default.gray('Configure Claude Code to route all requests to your Antigravity models:')}

${chalk_1.default.bold.white('• Windows PowerShell :')}
  ${chalk_1.default.green(`$env:ANTHROPIC_BASE_URL = "${baseUrl}"`)}
  ${chalk_1.default.green(`$env:ANTHROPIC_API_KEY = "gravity-bridge"`)}
  ${chalk_1.default.cyan('claude')}

${chalk_1.default.bold.white('• Linux / macOS / Git Bash :')}
  ${chalk_1.default.green(`export ANTHROPIC_BASE_URL="${baseUrl}"`)}
  ${chalk_1.default.green(`export ANTHROPIC_API_KEY="gravity-bridge"`)}
  ${chalk_1.default.cyan('claude')}
`;
    const codexSnippet = `
${chalk_1.default.bold.green('🟢 CODEX CLI / OPENAI COMPATIBLE TOOLS :')}

${chalk_1.default.bold.white('• Windows PowerShell :')}
  ${chalk_1.default.green(`$env:OPENAI_BASE_URL = "${openaiUrl}"`)}
  ${chalk_1.default.green(`$env:OPENAI_API_KEY = "gravity-bridge"`)}

${chalk_1.default.bold.white('• Linux / macOS / Git Bash :')}
  ${chalk_1.default.green(`export OPENAI_BASE_URL="${openaiUrl}"`)}
  ${chalk_1.default.green(`export OPENAI_API_KEY="gravity-bridge"`)}
`;
    const aiderSnippet = `
${chalk_1.default.bold.yellow('⚡ AIDER CLI :')}

${chalk_1.default.bold.white('• Run Aider with Gemini 3.7 Flash High :')}
  ${chalk_1.default.cyan(`aider --openai-api-base ${openaiUrl} --openai-api-key gravity-bridge --model openai/gemini-3.7-flash-high`)}

${chalk_1.default.bold.white('• Or with Anthropic provider / Claude Sonnet :')}
  ${chalk_1.default.cyan(`aider --anthropic-api-base ${baseUrl} --anthropic-api-key gravity-bridge --model anthropic/claude-sonnet-4-6`)}
`;
    const cursorSnippet = `
${chalk_1.default.bold.blue('💻 CURSOR IDE & CONTINUE.DEV :')}

  1. Open Cursor > ${chalk_1.default.bold('Settings')} > ${chalk_1.default.bold('Models')}
  2. Enable ${chalk_1.default.bold('OpenAI API Key')}
  3. Set Override OpenAI Base URL: ${chalk_1.default.green(openaiUrl)}
  4. Enter API Key: ${chalk_1.default.green('gravity-bridge')}
  5. Add Models: ${chalk_1.default.yellow('gemini-3.7-flash-high')}, ${chalk_1.default.yellow('claude-sonnet-4-6')}
`;
    if (!target || target === 'claude' || target === 'all') {
        console.log((0, boxen_1.default)(claudeSnippet, { padding: 1, margin: 0, borderStyle: 'round', borderColor: 'magenta' }));
        console.log('');
    }
    if (!target || target === 'codex' || target === 'all') {
        console.log((0, boxen_1.default)(codexSnippet, { padding: 1, margin: 0, borderStyle: 'round', borderColor: 'green' }));
        console.log('');
    }
    if (!target || target === 'aider' || target === 'all') {
        console.log((0, boxen_1.default)(aiderSnippet, { padding: 1, margin: 0, borderStyle: 'round', borderColor: 'yellow' }));
        console.log('');
    }
    if (!target || target === 'cursor' || target === 'all') {
        console.log((0, boxen_1.default)(cursorSnippet, { padding: 1, margin: 0, borderStyle: 'round', borderColor: 'blue' }));
        console.log('');
    }
}
//# sourceMappingURL=setup.js.map