"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.printBanner = printBanner;
const chalk_1 = __importDefault(require("chalk"));
function printBanner(options) {
    console.log('');
    console.log(`  ${chalk_1.default.bold.cyan('Open Gravity')} ${chalk_1.default.gray('v1.0.0')}`);
    console.log('');
    console.log(`  ${chalk_1.default.green('➜')}  ${chalk_1.default.bold('Local Proxy:')}     ${chalk_1.default.cyan(`http://${options.host}:${options.port}`)}`);
    console.log(`  ${chalk_1.default.green('➜')}  ${chalk_1.default.bold('Claude Code URL:')} ${chalk_1.default.magenta(`http://${options.host}:${options.port}`)}`);
    console.log(`  ${chalk_1.default.green('➜')}  ${chalk_1.default.bold('OpenAI Base URL:')} ${chalk_1.default.yellow(`http://${options.host}:${options.port}/v1`)}`);
    console.log(`  ${chalk_1.default.green('➜')}  ${chalk_1.default.bold('Web Dashboard:')}   ${chalk_1.default.blue(`http://${options.host}:${options.port}/dashboard`)}`);
    console.log('');
    if (options.account) {
        const quotaPct = options.account.quotaRemainingPercent;
        let resetStr = '';
        if (options.account.quotaResetTime) {
            try {
                const d = new Date(options.account.quotaResetTime);
                resetStr = ` (Resets at ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`;
            }
            catch { }
        }
        const quotaColor = quotaPct > 50 ? chalk_1.default.green : (quotaPct > 20 ? chalk_1.default.yellow : chalk_1.default.red);
        console.log(`  ${chalk_1.default.gray('•')} ${chalk_1.default.bold('Account:')}      ${options.account.name} ${chalk_1.default.gray(`(${options.account.email})`)}`);
        console.log(`  ${chalk_1.default.gray('•')} ${chalk_1.default.bold('Plan:')}         ${chalk_1.default.hex('#a855f7')(options.account.planName)} ${chalk_1.default.green('✔')}`);
        console.log(`  ${chalk_1.default.gray('•')} ${chalk_1.default.bold('Model Quota:')}   ${quotaColor(`${quotaPct}% remaining`)}${chalk_1.default.gray(resetStr)}`);
    }
    const connText = options.antigravityConnected
        ? chalk_1.default.green(`Connected (PID ${options.pid}, Port ${options.activePort})`)
        : chalk_1.default.yellow('Offline (Direct mode fallback)');
    console.log(`  ${chalk_1.default.gray('•')} ${chalk_1.default.bold('Antigravity:')}   ${connText}`);
    console.log(`  ${chalk_1.default.gray('•')} ${chalk_1.default.bold('Default Model:')} ${chalk_1.default.cyan(options.defaultModel)}`);
    console.log('');
    console.log(chalk_1.default.gray('  Ready for incoming requests. Press Ctrl+C to stop.'));
    console.log('');
}
//# sourceMappingURL=banner.js.map