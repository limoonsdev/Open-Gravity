"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.InteractiveTui = void 0;
const readline_1 = __importDefault(require("readline"));
const chalk_1 = __importDefault(require("chalk"));
const discovery_1 = require("../engines/discovery");
const antigravity_core_1 = require("../engines/antigravity-core");
const router_1 = require("../engines/router");
const ide_config_1 = require("../engines/ide-config");
const model_selector_1 = require("./model-selector");
const logger_1 = require("../utils/logger");
const config_1 = require("../utils/config");
class InteractiveTui {
    rl = null;
    port;
    host;
    defaultModel;
    isRunning = false;
    isSelectingModel = false;
    constructor(options) {
        this.port = options.port;
        this.host = options.host;
        this.defaultModel = options.defaultModel;
    }
    async start(account, pid, activePort) {
        this.isRunning = true;
        this.drawHeader(account, pid, activePort);
        this.createReadline();
        // Intercept logs so they don't break current user input line
        logger_1.logger.on('log', (entry) => {
            if (!this.isRunning || !this.rl || this.isSelectingModel)
                return;
            const isPolling = entry.message.includes('/status') || entry.message.includes('/health');
            if (isPolling)
                return;
            readline_1.default.clearLine(process.stdout, 0);
            readline_1.default.cursorTo(process.stdout, 0);
            let tag = '';
            if (entry.level === 'request')
                tag = chalk_1.default.magenta('REQ');
            else if (entry.level === 'success')
                tag = chalk_1.default.green('OK ');
            else if (entry.level === 'error')
                tag = chalk_1.default.red('ERR');
            else if (entry.level === 'warn')
                tag = chalk_1.default.yellow('WRN');
            else
                tag = chalk_1.default.blue('INF');
            console.log(`${chalk_1.default.gray(`[${entry.timestamp}]`)} ${tag} ${entry.message}`);
            this.rl.prompt(true);
        });
    }
    createReadline() {
        this.rl = readline_1.default.createInterface({
            input: process.stdin,
            output: process.stdout,
            prompt: chalk_1.default.cyan('og > '),
        });
        this.rl.prompt();
        this.rl.on('line', async (line) => {
            if (this.isSelectingModel)
                return;
            const input = line.trim();
            if (!input) {
                this.rl?.prompt();
                return;
            }
            await this.handleCommand(input);
            if (this.isRunning && !this.isSelectingModel) {
                this.rl?.prompt();
            }
        });
        this.rl.on('close', () => {
            if (!this.isSelectingModel) {
                this.shutdown();
            }
        });
    }
    drawHeader(account, pid, activePort) {
        const currentDef = config_1.configManager.get().defaultModel;
        console.log('');
        console.log(`  ${chalk_1.default.bold.cyan('Open Gravity')} ${chalk_1.default.gray('v1.0.0')} — ${chalk_1.default.white('Universal Antigravity AI Bridge')}`);
        console.log('');
        console.log(`  ${chalk_1.default.bold('➜ Endpoints:')}`);
        console.log(`    • Claude Code / Anthropic : ${chalk_1.default.magenta.bold(`http://${this.host}:${this.port}`)}`);
        console.log(`    • OpenAI / Codex / Cursor : ${chalk_1.default.yellow.bold(`http://${this.host}:${this.port}/v1`)}`);
        console.log('');
        console.log(`  ${chalk_1.default.bold('➜ Session:')}`);
        if (account) {
            const quotaPct = account.quotaRemainingPercent;
            let resetStr = '';
            if (account.quotaResetTime) {
                try {
                    const d = new Date(account.quotaResetTime);
                    resetStr = ` (Resets at ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`;
                }
                catch { }
            }
            const quotaColor = quotaPct > 50 ? chalk_1.default.green : (quotaPct > 10 ? chalk_1.default.yellow : chalk_1.default.red);
            console.log(`    • Account:      ${chalk_1.default.white.bold(account.name)} ${chalk_1.default.gray(`(${account.email})`)}`);
            console.log(`    • Plan:         ${chalk_1.default.hex('#a855f7')(account.planName)} ${chalk_1.default.green('✔')}`);
            console.log(`    • Model Quota:  ${quotaColor(`${quotaPct}% remaining`)}${chalk_1.default.gray(resetStr)}`);
        }
        else {
            console.log(`    • Account:      ${chalk_1.default.gray('Detecting Antigravity session...')}`);
        }
        const conn = pid ? chalk_1.default.green(`Connected (PID ${pid}, Port ${activePort})`) : chalk_1.default.yellow('Offline');
        console.log(`    • Antigravity:  ${conn}`);
        console.log(`    • Default:      ${chalk_1.default.cyan(currentDef)}`);
        console.log('');
        console.log(`  ${chalk_1.default.gray('Hotkeys/Commands:')} ${chalk_1.default.cyan('models')} (${chalk_1.default.bold('m')})  ${chalk_1.default.cyan('configure')} (${chalk_1.default.bold('c')})  ${chalk_1.default.cyan('status')} (${chalk_1.default.bold('s')})  ${chalk_1.default.cyan('doctor')} (${chalk_1.default.bold('d')})  ${chalk_1.default.cyan('clear')} (${chalk_1.default.bold('cls')})  ${chalk_1.default.cyan('quit')} (${chalk_1.default.bold('q')})`);
        console.log(chalk_1.default.gray('  --------------------------------------------------------------------------------'));
        console.log('');
    }
    async handleCommand(cmd) {
        const parts = cmd.split(' ');
        const main = parts[0].toLowerCase();
        switch (main) {
            case 'm':
            case 'model':
            case 'models':
            case 'use':
                this.isSelectingModel = true;
                if (this.rl) {
                    this.rl.close();
                    this.rl = null;
                }
                const selector = new model_selector_1.ModelSelector(() => {
                    this.isSelectingModel = false;
                    this.createReadline();
                });
                await selector.start();
                break;
            case 'c':
            case 'config':
            case 'configure':
                console.log(chalk_1.default.cyan('\n[TUI] Running automatic IDE configurator...'));
                const results = ide_config_1.IdeConfigurator.configureAll(process.cwd());
                for (const r of results) {
                    console.log(`  ${r.success ? chalk_1.default.green('✔') : chalk_1.default.red('✖')} ${chalk_1.default.bold(r.ide.padEnd(12))} ${r.message}`);
                }
                console.log(chalk_1.default.green('✔ Configuration updated on disk.\n'));
                break;
            case 's':
            case 'status':
                console.log(chalk_1.default.cyan('\n[TUI] Live Status & Quota Refresh:'));
                const instance = await discovery_1.AntigravityDiscovery.discover(true);
                const account = await antigravity_core_1.antigravityCore.getUserAccountDetails();
                const stats = router_1.requestRouter.getStats();
                if (account) {
                    console.log(`  • User:     ${account.name} (${account.email})`);
                    console.log(`  • Plan:     ${account.planName}`);
                    console.log(`  • Quota:    ${account.quotaRemainingPercent}% remaining`);
                }
                console.log(`  • Core:     ${instance ? chalk_1.default.green(`Online (PID ${instance.pid}, Port ${instance.port})`) : chalk_1.default.yellow('Offline')}`);
                console.log(`  • Traffic:  ${stats.totalRequests} total requests (${stats.activeRequests} active), last latency: ${stats.lastLatencyMs}ms\n`);
                break;
            case 'd':
            case 'doc':
            case 'doctor':
                console.log(chalk_1.default.cyan('\n[TUI] Quick Diagnostic:'));
                const inst = await discovery_1.AntigravityDiscovery.discover(true);
                console.log(`  • Daemon: ${inst ? chalk_1.default.green('✔ Detected') : chalk_1.default.red('✖ Not running')}`);
                if (inst) {
                    try {
                        await antigravity_core_1.antigravityCore.rpcCall('GetCapabilities');
                        console.log(`  • RPC:    ${chalk_1.default.green('✔ Connected (CSRF validated)')}`);
                    }
                    catch (e) {
                        console.log(`  • RPC:    ${chalk_1.default.red('✖ Error: ' + e.message)}`);
                    }
                }
                console.log('');
                break;
            case 'cls':
            case 'clear':
                console.clear();
                const instCurrent = await discovery_1.AntigravityDiscovery.discover();
                const accCurrent = await antigravity_core_1.antigravityCore.getUserAccountDetails();
                this.drawHeader(accCurrent, instCurrent?.pid, instCurrent?.port);
                break;
            case 'help':
            case 'h':
            case '?':
                console.log(chalk_1.default.cyan('\n[TUI] Available Commands:'));
                console.log(`  • ${chalk_1.default.bold('models')}    (${chalk_1.default.bold('m')}): Interactive arrow-key model selector & 1-token health ping`);
                console.log(`  • ${chalk_1.default.bold('configure')} (${chalk_1.default.bold('c')}): Auto-configure Cursor, Continue, Aider, Claude Code`);
                console.log(`  • ${chalk_1.default.bold('status')}    (${chalk_1.default.bold('s')}): Refresh live Google account info & model quota`);
                console.log(`  • ${chalk_1.default.bold('doctor')}    (${chalk_1.default.bold('d')}): Test Antigravity connection & RPC`);
                console.log(`  • ${chalk_1.default.bold('clear')}     (${chalk_1.default.bold('cls')}): Clear screen and redraw banner`);
                console.log(`  • ${chalk_1.default.bold('quit')}      (${chalk_1.default.bold('q')}): Stop server and exit\n`);
                break;
            case 'q':
            case 'quit':
            case 'exit':
                this.shutdown();
                break;
            default:
                console.log(chalk_1.default.yellow(`Unknown command: '${cmd}'. Type 'help' or 'h' for list of commands.`));
                break;
        }
    }
    shutdown() {
        this.isRunning = false;
        console.log(chalk_1.default.gray('\nStopping Open Gravity server...'));
        if (this.rl) {
            this.rl.close();
        }
        process.exit(0);
    }
}
exports.InteractiveTui = InteractiveTui;
//# sourceMappingURL=tui.js.map