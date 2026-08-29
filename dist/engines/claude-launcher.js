"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClaudeLauncher = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const child_process_1 = require("child_process");
const chalk_1 = __importDefault(require("chalk"));
const config_1 = require("../utils/config");
class ClaudeLauncher {
    static bypassLoginAndPrepareConfig() {
        const home = os_1.default.homedir();
        const claudeJsonPath = path_1.default.join(home, '.claude.json');
        try {
            let config = {};
            if (fs_1.default.existsSync(claudeJsonPath)) {
                try {
                    config = JSON.parse(fs_1.default.readFileSync(claudeJsonPath, 'utf-8'));
                }
                catch {
                    config = {};
                }
            }
            // Complete login bypass & onboarding skip payload
            config.hasCompletedOnboarding = true;
            config.autoUpdates = false;
            config.primaryApiKey = 'sk-ant-api03-gravity-bridge-bypass-key-1234567890';
            // Trust current working directory if exists
            const cwd = process.cwd();
            if (!config.projects)
                config.projects = {};
            if (!config.projects[cwd]) {
                config.projects[cwd] = {
                    allowedTools: [],
                    mcpContextUris: [],
                    enabledMcpjsonServers: [],
                    disabledMcpjsonServers: [],
                    hasTrustDialogAccepted: true,
                    hasClaudeMdExternalIncludesApproved: true,
                    hasClaudeMdExternalIncludesWarningShown: true,
                };
            }
            else {
                config.projects[cwd].hasTrustDialogAccepted = true;
                config.projects[cwd].hasClaudeMdExternalIncludesApproved = true;
            }
            fs_1.default.writeFileSync(claudeJsonPath, JSON.stringify(config, null, 2), 'utf-8');
            return claudeJsonPath;
        }
        catch (e) {
            return '';
        }
    }
    static async launchClaude(extraArgs = []) {
        const config = config_1.configManager.get();
        const port = config.port;
        const host = config.host;
        const baseUrl = `http://${host}:${port}`;
        const bypassApiKey = 'sk-ant-api03-gravity-bridge-bypass-key-1234567890';
        console.log(chalk_1.default.cyan('\n🚀 [Open Gravity] Preparing Claude Code with Login Bypass...'));
        // 1. Prepare ~/.claude.json bypass
        this.bypassLoginAndPrepareConfig();
        console.log(chalk_1.default.green('✔ Authentication bypass injected into ~/.claude.json'));
        // 2. Prepare environment variables
        const env = {
            ...process.env,
            ANTHROPIC_BASE_URL: baseUrl,
            ANTHROPIC_API_KEY: bypassApiKey,
            CLAUDE_BASE_URL: baseUrl,
            DISABLE_AUTOUPDATES: '1',
            NODE_TLS_REJECT_UNAUTHORIZED: '0',
        };
        console.log(chalk_1.default.green(`✔ Endpoint routed to: ${chalk_1.default.bold(baseUrl)} (Antigravity Bridge)`));
        console.log(chalk_1.default.gray('  Launching Claude Code in interactive terminal...\n'));
        // 3. Find Claude command
        const isWin = process.platform === 'win32';
        // Command runner
        let cmd = 'claude';
        let args = extraArgs;
        // Check if claude exists in PATH, otherwise use npx @anthropic-ai/claude-code
        const child = isWin
            ? (0, child_process_1.spawn)('cmd.exe', ['/c', 'claude', ...args], { env, stdio: 'inherit' })
            : (0, child_process_1.spawn)('claude', args, { env, stdio: 'inherit' });
        child.on('error', () => {
            console.log(chalk_1.default.yellow('  `claude` command not in PATH, falling back to `npx @anthropic-ai/claude-code`...'));
            const fallback = isWin
                ? (0, child_process_1.spawn)('cmd.exe', ['/c', 'npx', '--yes', '@anthropic-ai/claude-code', ...args], { env, stdio: 'inherit' })
                : (0, child_process_1.spawn)('npx', ['--yes', '@anthropic-ai/claude-code', ...args], { env, stdio: 'inherit' });
            fallback.on('close', (code) => {
                console.log(chalk_1.default.gray(`\n[Claude Code exited with code ${code ?? 0}]`));
            });
        });
        child.on('close', (code) => {
            if (code !== null) {
                console.log(chalk_1.default.gray(`\n[Claude Code exited with code ${code}]`));
            }
        });
    }
}
exports.ClaudeLauncher = ClaudeLauncher;
//# sourceMappingURL=claude-launcher.js.map