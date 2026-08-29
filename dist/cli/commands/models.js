"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.modelsCommand = modelsCommand;
const chalk_1 = __importDefault(require("chalk"));
const antigravity_core_1 = require("../../engines/antigravity-core");
const config_1 = require("../../utils/config");
async function modelsCommand() {
    console.log(chalk_1.default.bold.cyan('\n📦 Available Antigravity & Open Gravity Models:\n'));
    const models = await antigravity_core_1.antigravityCore.getAvailableModels();
    const config = config_1.configManager.get();
    if (Object.keys(models).length === 0) {
        console.log(chalk_1.default.yellow('Antigravity is not connected. Here are the standard default models:'));
        const defaultModels = [
            { id: 'gemini-3.7-flash-high', name: 'Gemini 3.7 Flash High (Recommended)', tier: 'flash', max: '1,000,000' },
            { id: 'gemini-3.7-flash-medium', name: 'Gemini 3.7 Flash Medium', tier: 'flash', max: '1,000,000' },
            { id: 'gemini-3.7-flash-low', name: 'Gemini 3.7 Flash Low', tier: 'flash_lite', max: '1,000,000' },
            { id: 'gemini-pro-agent', name: 'Gemini Pro Agent (Deep Reasoning)', tier: 'pro', max: '2,000,000' },
            { id: 'claude-sonnet-4-6', name: 'Claude Sonnet (Via Antigravity Bridge)', tier: 'pro', max: '200,000' },
            { id: 'claude-opus-4-6-thinking', name: 'Claude Opus Thinking', tier: 'pro', max: '200,000' },
            { id: 'gpt-oss-120b-medium', name: 'GPT-OSS 120B Medium', tier: 'pro', max: '131,072' },
        ];
        console.log(chalk_1.default.gray('-----------------------------------------------------------------------------------'));
        console.log(`${chalk_1.default.bold('MODEL ID'.padEnd(30))} ${chalk_1.default.bold('DISPLAY NAME'.padEnd(35))} ${chalk_1.default.bold('TIER')}`);
        console.log(chalk_1.default.gray('-----------------------------------------------------------------------------------'));
        for (const m of defaultModels) {
            const isDef = m.id === config.defaultModel ? chalk_1.default.green(' (DEFAULT)') : '';
            console.log(`${chalk_1.default.cyan(m.id.padEnd(30))} ${m.name.padEnd(35)} ${chalk_1.default.magenta(m.tier)}${isDef}`);
        }
        console.log(chalk_1.default.gray('-----------------------------------------------------------------------------------\n'));
        return;
    }
    console.log(chalk_1.default.gray('---------------------------------------------------------------------------------------------'));
    console.log(`${chalk_1.default.bold('MODEL ID'.padEnd(32))} ${chalk_1.default.bold('PROVIDER'.padEnd(25))} ${chalk_1.default.bold('MAX TOKENS'.padEnd(15))} ${chalk_1.default.bold('THINKING')}`);
    console.log(chalk_1.default.gray('---------------------------------------------------------------------------------------------'));
    for (const [id, m] of Object.entries(models)) {
        const isDef = id === config.defaultModel ? chalk_1.default.green(' ★') : '';
        const prov = m.modelProvider || m.apiProvider || 'Google';
        const think = m.supportsThinking ? chalk_1.default.green('Yes') : chalk_1.default.gray('No');
        console.log(`${chalk_1.default.cyan(id.padEnd(32))}${isDef} ${prov.padEnd(25)} ${String(m.maxTokens).padEnd(15)} ${think}`);
    }
    console.log(chalk_1.default.gray('---------------------------------------------------------------------------------------------\n'));
}
//# sourceMappingURL=models.js.map