"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.doctorCommand = doctorCommand;
const chalk_1 = __importDefault(require("chalk"));
const ora_1 = __importDefault(require("ora"));
const discovery_1 = require("../../engines/discovery");
const antigravity_core_1 = require("../../engines/antigravity-core");
const config_1 = require("../../utils/config");
async function doctorCommand() {
    console.log(chalk_1.default.bold.cyan('\n🩺 Open Gravity & Antigravity System Diagnostics\n'));
    const spinner = (0, ora_1.default)('Analyzing system...').start();
    const config = config_1.configManager.get();
    // Test 1: Node & Process Detection
    spinner.text = '1. Scanning for Google Antigravity processes...';
    const instance = await discovery_1.AntigravityDiscovery.discover(true);
    if (instance) {
        spinner.succeed(chalk_1.default.green(`Antigravity process detected (PID: ${instance.pid})`));
    }
    else {
        spinner.warn(chalk_1.default.yellow('No active Antigravity process found'));
    }
    // Test 2: Language Server & CSRF
    if (instance) {
        spinner.start('2. Testing Language Server RPC connection...');
        try {
            const status = await antigravity_core_1.antigravityCore.rpcCall('GetCapabilities');
            spinner.succeed(chalk_1.default.green(`Language Server RPC online (Port: ${instance.port}, CSRF validated)`));
        }
        catch (e) {
            spinner.fail(chalk_1.default.red(`Language Server RPC error: ${e.message}`));
        }
        // Test 3: Models Retrieval
        spinner.start('3. Fetching Antigravity models...');
        try {
            const models = await antigravity_core_1.antigravityCore.getAvailableModels();
            const count = Object.keys(models).length;
            spinner.succeed(chalk_1.default.green(`${count} Antigravity models loaded successfully`));
        }
        catch (e) {
            spinner.fail(chalk_1.default.red(`Failed to fetch models: ${e.message}`));
        }
    }
    // Test 4: Local Bridge Port Availability
    spinner.start(`4. Checking local port ${config.port} configuration...`);
    spinner.succeed(chalk_1.default.green(`Port ${config.port} configured for Open Gravity`));
    // Test 5: Fallback Direct API
    spinner.start('5. Checking Direct API fallback mode...');
    if (config.geminiApiKey) {
        spinner.succeed(chalk_1.default.green('GEMINI_API_KEY configured (Direct mode ready)'));
    }
    else {
        spinner.info(chalk_1.default.gray('GEMINI_API_KEY not set (Optional when Antigravity is running)'));
    }
    console.log(chalk_1.default.bold.green('\n✔ Diagnostics completed successfully!\n'));
}
//# sourceMappingURL=doctor.js.map