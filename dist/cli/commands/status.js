"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.statusCommand = statusCommand;
const chalk_1 = __importDefault(require("chalk"));
const boxen_1 = __importDefault(require("boxen"));
const discovery_1 = require("../../engines/discovery");
const antigravity_core_1 = require("../../engines/antigravity-core");
const config_1 = require("../../utils/config");
async function statusCommand() {
    console.log(chalk_1.default.bold.cyan('\n🔍 Checking Open Gravity & Google Antigravity status...\n'));
    const instance = await discovery_1.AntigravityDiscovery.discover(true);
    const config = config_1.configManager.get();
    let details = '';
    if (instance) {
        const account = await antigravity_core_1.antigravityCore.getUserAccountDetails();
        details += `${chalk_1.default.bold.green('✔ Google Antigravity : ACTIVE & CONNECTED')}\n\n`;
        if (account) {
            const quotaPct = account.quotaRemainingPercent;
            const barTotal = 15;
            const filled = Math.round((quotaPct / 100) * barTotal);
            const bar = '█'.repeat(Math.max(0, filled)) + '░'.repeat(Math.max(0, barTotal - filled));
            const quotaColor = quotaPct > 50 ? chalk_1.default.green : (quotaPct > 20 ? chalk_1.default.yellow : chalk_1.default.red);
            let resetStr = '';
            if (account.quotaResetTime) {
                try {
                    const d = new Date(account.quotaResetTime);
                    resetStr = ` (Reset at ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`;
                }
                catch { }
            }
            details += `  ${chalk_1.default.gray('•')} ${chalk_1.default.bold('Google Account   :')} ${chalk_1.default.white.bold(account.name)} ${chalk_1.default.gray(`(${account.email})`)}\n`;
            details += `  ${chalk_1.default.gray('•')} ${chalk_1.default.bold('Subscription Plan:')} ${chalk_1.default.hex('#a855f7').bold(account.planName)} ${chalk_1.default.green('✔')}\n`;
            details += `  ${chalk_1.default.gray('•')} ${chalk_1.default.bold('Quota Remaining  :')} ${quotaColor.bold(`${quotaPct}%`)} ${chalk_1.default.gray(`[${quotaColor(bar)}]`)}${chalk_1.default.gray(resetStr)}\n`;
        }
        details += `  ${chalk_1.default.gray('•')} ${chalk_1.default.bold('Process ID (PID) :')} ${chalk_1.default.yellow(instance.pid)}\n`;
        details += `  ${chalk_1.default.gray('•')} ${chalk_1.default.bold('Active Port      :')} ${chalk_1.default.cyan(instance.port)}\n`;
        details += `  ${chalk_1.default.gray('•')} ${chalk_1.default.bold('CSRF Token       :')} ${chalk_1.default.gray(instance.csrfToken.substring(0, 8) + '...')}\n`;
    }
    else {
        details += `${chalk_1.default.bold.yellow('⚠ Antigravity Language Server : OFFLINE')}\n\n`;
        details += `  Google Antigravity is not detected running.\n`;
        details += `  👉 ${chalk_1.default.bold.white('Tip:')} Keep Google Antigravity open in the background\n`;
        details += `     to automatically leverage your subscription and all 28+ models with zero API keys!\n`;
    }
    details += `\n${chalk_1.default.bold.blue('⚙ Open Gravity Configuration :')}\n`;
    details += `  ${chalk_1.default.gray('•')} ${chalk_1.default.bold('Local Port       :')} ${config.port}\n`;
    details += `  ${chalk_1.default.gray('•')} ${chalk_1.default.bold('Default Model    :')} ${chalk_1.default.green(config.defaultModel)}\n`;
    details += `  ${chalk_1.default.gray('•')} ${chalk_1.default.bold('Claude Code URL  :')} ${chalk_1.default.magenta(`http://${config.host}:${config.port}`)}\n`;
    details += `  ${chalk_1.default.gray('•')} ${chalk_1.default.bold('OpenAI/Codex URL :')} ${chalk_1.default.yellow(`http://${config.host}:${config.port}/v1`)}\n`;
    details += `  ${chalk_1.default.gray('•')} ${chalk_1.default.bold('Web Dashboard    :')} ${chalk_1.default.cyan(`http://${config.host}:${config.port}/dashboard`)}\n`;
    console.log((0, boxen_1.default)(details, {
        padding: 1,
        margin: 0,
        borderStyle: 'round',
        borderColor: instance ? 'green' : 'yellow',
    }));
}
//# sourceMappingURL=status.js.map