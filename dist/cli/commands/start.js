"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startCommand = startCommand;
const http_1 = __importDefault(require("http"));
const open_1 = __importDefault(require("open"));
const chalk_1 = __importDefault(require("chalk"));
const net_1 = __importDefault(require("net"));
const readline_1 = __importDefault(require("readline"));
const app_1 = require("../../server/app");
const config_1 = require("../../utils/config");
const discovery_1 = require("../../engines/discovery");
const antigravity_core_1 = require("../../engines/antigravity-core");
const banner_1 = require("../banner");
const logger_1 = require("../../utils/logger");
async function isPortAvailable(port, host) {
    return new Promise((resolve) => {
        const tester = net_1.default.createServer()
            .once('error', () => resolve(false))
            .once('listening', () => {
            tester.once('close', () => resolve(true)).close();
        })
            .listen(port, host);
    });
}
async function findAvailablePort(startPort, host) {
    let p = startPort;
    for (let i = 0; i < 20; i++) {
        if (await isPortAvailable(p, host)) {
            return p;
        }
        p++;
    }
    return startPort;
}
async function startCommand(options) {
    const config = config_1.configManager.get();
    const host = options.host || config.host;
    let targetPort = options.port || config.port;
    if (options.model) {
        config_1.configManager.update({ defaultModel: options.model });
    }
    logger_1.logger.info('Starting Open Gravity...');
    // Auto-discover Antigravity
    const instance = await discovery_1.AntigravityDiscovery.discover(true);
    let accountDetails = null;
    if (instance) {
        logger_1.logger.success(`Antigravity Language Server detected (PID: ${instance.pid}, Port: ${instance.port})`);
        accountDetails = await antigravity_core_1.antigravityCore.getUserAccountDetails();
    }
    else {
        logger_1.logger.warn('Antigravity Language Server not detected. Make sure Antigravity is running to use your Pro subscription.');
    }
    // Check port availability and auto-fallback if needed
    const availablePort = await findAvailablePort(targetPort, host);
    if (availablePort !== targetPort) {
        logger_1.logger.info(`Port ${targetPort} is occupied, automatically bound to available port ${availablePort}`);
        targetPort = availablePort;
        config_1.configManager.update({ port: availablePort });
    }
    const app = (0, app_1.createBridgeApp)();
    const server = http_1.default.createServer(app);
    server.listen(targetPort, host, () => {
        (0, banner_1.printBanner)({
            port: targetPort,
            host,
            antigravityConnected: !!instance,
            activePort: instance?.port,
            pid: instance?.pid,
            defaultModel: config_1.configManager.get().defaultModel,
            account: accountDetails,
        });
        console.log(chalk_1.default.bold.green(`  🚀 Ready to receive agent requests!`));
        console.log(chalk_1.default.gray(`  (Press Ctrl+C to stop the server)\n`));
        if (options.open || config.openBrowserOnStart) {
            (0, open_1.default)(`http://${host}:${targetPort}/dashboard`).catch(() => { });
        }
    });
    server.on('error', (err) => {
        logger_1.logger.error(`Server Error: ${err.message}`);
        console.log('\nPress Enter to exit...');
        const rl = readline_1.default.createInterface({ input: process.stdin, output: process.stdout });
        rl.question('', () => process.exit(1));
    });
}
//# sourceMappingURL=start.js.map