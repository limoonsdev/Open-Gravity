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
const config_1 = require("../utils/config");
class ClaudeLauncher {
    static findClaudeExecutable() {
        const home = os_1.default.homedir();
        const localAppData = process.env.LOCALAPPDATA || path_1.default.join(home, 'AppData', 'Local');
        const candidates = [
            path_1.default.join(home, '.local', 'bin', 'claude.exe'),
            path_1.default.join(home, '.claude', 'bin', 'claude.exe'),
            path_1.default.join(localAppData, 'Programs', 'claude', 'claude.exe'),
            path_1.default.join(localAppData, 'Programs', 'Claude', 'claude.exe'),
        ];
        for (const c of candidates) {
            if (fs_1.default.existsSync(c))
                return c;
        }
        const packagesDir = path_1.default.join(localAppData, 'Packages');
        if (fs_1.default.existsSync(packagesDir)) {
            try {
                const pkgs = fs_1.default.readdirSync(packagesDir).filter(p => p.startsWith('Claude_'));
                for (const pkg of pkgs) {
                    const codeDir = path_1.default.join(packagesDir, pkg, 'LocalCache', 'Roaming', 'Claude', 'claude-code');
                    if (fs_1.default.existsSync(codeDir)) {
                        const versions = fs_1.default.readdirSync(codeDir);
                        for (const v of versions) {
                            const exe = path_1.default.join(codeDir, v, 'claude.exe');
                            if (fs_1.default.existsSync(exe))
                                return exe;
                        }
                    }
                }
            }
            catch { }
        }
        return null;
    }
    static applyLoginBypass() {
        const claudeJsonPath = path_1.default.join(os_1.default.homedir(), '.claude.json');
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
            config.hasCompletedOnboarding = true;
            config.autoUpdates = false;
            config.primaryApiKey = 'sk-ant-api03-open-gravity-bypass';
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
        }
        catch { }
    }
    static async launchClaude(extraArgs = []) {
        const config = config_1.configManager.get();
        const baseUrl = `http://${config.host}:${config.port}`;
        const bypassApiKey = 'sk-ant-api03-open-gravity-bypass';
        this.applyLoginBypass();
        const env = {
            ...process.env,
            ANTHROPIC_BASE_URL: baseUrl,
            ANTHROPIC_API_KEY: bypassApiKey,
            CLAUDE_BASE_URL: baseUrl,
            DISABLE_AUTOUPDATES: '1',
            NODE_TLS_REJECT_UNAUTHORIZED: '0',
        };
        const exe = this.findClaudeExecutable();
        if (exe) {
            const child = (0, child_process_1.spawn)(exe, extraArgs, { env, stdio: 'inherit' });
            return new Promise((resolve) => {
                child.on('close', () => resolve());
            });
        }
        const isWin = process.platform === 'win32';
        return new Promise((resolve) => {
            const child = isWin
                ? (0, child_process_1.spawn)('cmd.exe', ['/c', 'claude', ...extraArgs], { env, stdio: 'inherit' })
                : (0, child_process_1.spawn)('claude', extraArgs, { env, stdio: 'inherit' });
            child.on('error', () => {
                const fallback = isWin
                    ? (0, child_process_1.spawn)('cmd.exe', ['/c', 'npx', '--yes', '@anthropic-ai/claude-code', ...extraArgs], { env, stdio: 'inherit' })
                    : (0, child_process_1.spawn)('npx', ['--yes', '@anthropic-ai/claude-code', ...extraArgs], { env, stdio: 'inherit' });
                fallback.on('close', () => resolve());
            });
            child.on('close', () => resolve());
        });
    }
}
exports.ClaudeLauncher = ClaudeLauncher;
//# sourceMappingURL=claude-launcher.js.map