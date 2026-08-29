"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
const chalk_1 = __importDefault(require("chalk"));
const events_1 = __importDefault(require("events"));
class BridgeLogger extends events_1.default {
    logs = [];
    maxLogs = 200;
    isMuted = false;
    setMuted(muted) {
        this.isMuted = muted;
    }
    addLog(level, message, meta) {
        const entry = {
            id: Math.random().toString(36).substring(2, 9),
            timestamp: new Date().toISOString().split('T')[1].split('.')[0],
            level,
            message,
            meta,
        };
        this.logs.push(entry);
        if (this.logs.length > this.maxLogs) {
            this.logs.shift();
        }
        this.emit('log', entry);
        if (this.isMuted)
            return;
        const timeStr = chalk_1.default.gray(`[${entry.timestamp}]`);
        switch (level) {
            case 'info':
                console.log(`${timeStr} ${chalk_1.default.blue('ℹ')} ${message}`);
                break;
            case 'success':
                console.log(`${timeStr} ${chalk_1.default.green('✔')} ${chalk_1.default.green(message)}`);
                break;
            case 'warn':
                console.log(`${timeStr} ${chalk_1.default.yellow('⚠')} ${chalk_1.default.yellow(message)}`);
                break;
            case 'error':
                console.log(`${timeStr} ${chalk_1.default.red('✖')} ${chalk_1.default.red(message)}`);
                if (meta?.stack)
                    console.error(chalk_1.default.gray(meta.stack));
                break;
            case 'request':
                console.log(`${timeStr} ${chalk_1.default.magenta('⚡')} ${message}`);
                break;
            case 'debug':
                if (process.env.DEBUG) {
                    console.log(`${timeStr} ${chalk_1.default.gray('⚙')} ${chalk_1.default.gray(message)}`);
                }
                break;
        }
    }
    info(msg, meta) {
        this.addLog('info', msg, meta);
    }
    success(msg, meta) {
        this.addLog('success', msg, meta);
    }
    warn(msg, meta) {
        this.addLog('warn', msg, meta);
    }
    error(msg, meta) {
        this.addLog('error', msg, meta);
    }
    request(msg, meta) {
        this.addLog('request', msg, meta);
    }
    debug(msg, meta) {
        this.addLog('debug', msg, meta);
    }
    getRecentLogs() {
        return [...this.logs];
    }
}
exports.logger = new BridgeLogger();
//# sourceMappingURL=logger.js.map