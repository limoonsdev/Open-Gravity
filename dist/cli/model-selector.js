"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ModelSelector = void 0;
const readline_1 = __importDefault(require("readline"));
const chalk_1 = __importDefault(require("chalk"));
const antigravity_core_1 = require("../engines/antigravity-core");
const config_1 = require("../utils/config");
class ModelSelector {
    models = [];
    selectedIndex = 0;
    isRunning = false;
    onCloseCallback;
    constructor(onClose) {
        this.onCloseCallback = onClose;
    }
    async start() {
        this.isRunning = true;
        console.log(chalk_1.default.cyan('\n[TUI] Loading models & checking quotas...'));
        this.models = await antigravity_core_1.antigravityCore.getCleanModels();
        const currentDefault = config_1.configManager.get().defaultModel;
        const foundIdx = this.models.findIndex(m => m.id === currentDefault);
        if (foundIdx !== -1) {
            this.selectedIndex = foundIdx;
        }
        this.render();
        this.setupKeypress();
    }
    render() {
        console.clear();
        console.log('');
        console.log(`  ${chalk_1.default.bold.cyan('Open Gravity')} — ${chalk_1.default.bold('Interactive Model Selector & Health Check')}`);
        console.log(`  ${chalk_1.default.gray('Use ↑ / ↓ arrows to navigate • Enter to select • [t] to test 1-token ping • [q/Esc] to exit')}`);
        console.log(chalk_1.default.gray('  -----------------------------------------------------------------------------------------'));
        const currentDefault = config_1.configManager.get().defaultModel;
        this.models.forEach((m, idx) => {
            const isCursor = idx === this.selectedIndex;
            const isDefault = m.id === currentDefault;
            const cursorChar = isCursor ? chalk_1.default.cyan.bold('➜ ') : '  ';
            const defaultBadge = isDefault ? chalk_1.default.green.bold(' [ACTIVE]') : '';
            // Quota styling
            let quotaStr = '';
            if (m.quotaRemainingPercent !== undefined) {
                const qColor = m.quotaRemainingPercent > 50 ? chalk_1.default.green : (m.quotaRemainingPercent > 10 ? chalk_1.default.yellow : chalk_1.default.red);
                quotaStr = qColor(`${m.quotaRemainingPercent}% quota`.padEnd(11));
            }
            else {
                quotaStr = chalk_1.default.gray('unlimited  ');
            }
            // Ping status
            let pingStr = '';
            if (m.status === 'online') {
                pingStr = chalk_1.default.green(`✔ ${m.latencyMs}ms`);
            }
            else if (m.status === 'offline') {
                pingStr = chalk_1.default.red('✖ Offline');
            }
            else if (m.status === 'quota_exceeded') {
                pingStr = chalk_1.default.yellow('⚠ Quota Exceeded');
            }
            else {
                pingStr = chalk_1.default.gray('○ Untested');
            }
            const idDisplay = isCursor ? chalk_1.default.bold.cyan(m.id.padEnd(28)) : m.id.padEnd(28);
            const nameDisplay = chalk_1.default.gray(m.displayName.padEnd(26));
            const provider = chalk_1.default.hex(m.modelProvider === 'Anthropic' ? '#a855f7' : '#38bdf8')(m.modelProvider?.padEnd(10) || 'Google    ');
            console.log(`${cursorChar}${idDisplay} ${provider} ${nameDisplay} ${quotaStr} ${pingStr}${defaultBadge}`);
        });
        console.log(chalk_1.default.gray('  -----------------------------------------------------------------------------------------'));
        const selected = this.models[this.selectedIndex];
        if (selected) {
            console.log(`  ${chalk_1.default.bold('Selected:')} ${chalk_1.default.cyan(selected.id)} | Max Tokens: ${selected.maxTokens.toLocaleString()} | Provider: ${selected.modelProvider}`);
        }
        console.log('');
    }
    setupKeypress() {
        readline_1.default.emitKeypressEvents(process.stdin);
        if (process.stdin.isTTY) {
            process.stdin.setRawMode(true);
        }
        const onKey = async (str, key) => {
            if (!this.isRunning)
                return;
            if (key.name === 'up' || str === 'k') {
                this.selectedIndex = (this.selectedIndex - 1 + this.models.length) % this.models.length;
                this.render();
            }
            else if (key.name === 'down' || str === 'j') {
                this.selectedIndex = (this.selectedIndex + 1) % this.models.length;
                this.render();
            }
            else if (key.name === 'return') {
                const chosen = this.models[this.selectedIndex];
                if (chosen) {
                    config_1.configManager.update({ defaultModel: chosen.id });
                    this.cleanup(onKey);
                    console.log(chalk_1.default.green(`\n✔ Switched active default model to: ${chalk_1.default.bold(chosen.id)}`));
                    this.onCloseCallback();
                }
            }
            else if (str === 't') {
                const chosen = this.models[this.selectedIndex];
                if (chosen) {
                    chosen.status = 'untested';
                    this.render();
                    console.log(chalk_1.default.yellow(`  Sending 1-token probe request to ${chosen.id}...`));
                    const probe = await antigravity_core_1.antigravityCore.pingModel(chosen.id);
                    if (probe.success) {
                        chosen.status = 'online';
                        chosen.latencyMs = probe.latencyMs;
                    }
                    else {
                        chosen.status = 'offline';
                    }
                    this.render();
                }
            }
            else if (key.name === 'escape' || str === 'q' || (key.ctrl && key.name === 'c')) {
                this.cleanup(onKey);
                this.onCloseCallback();
            }
        };
        process.stdin.on('keypress', onKey);
    }
    cleanup(onKey) {
        this.isRunning = false;
        process.stdin.removeListener('keypress', onKey);
        if (process.stdin.isTTY) {
            process.stdin.setRawMode(false);
        }
    }
}
exports.ModelSelector = ModelSelector;
//# sourceMappingURL=model-selector.js.map